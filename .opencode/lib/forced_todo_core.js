// Core of the forced_todo orchestrator: state machine, prompts, pruning, and
// the plugin factory. Lives OUTSIDE .opencode/plugins/ on purpose — OpenCode's
// plugin loader calls every export of a plugins/ file as a plugin factory, so
// a file there may export only the factory (see plugins/forced_todo.js). This
// module is free to export pure helpers for unit tests.
import { createRequire } from "module"
import path from "path"
import { fileURLToPath } from "url"

const require = createRequire(import.meta.url)
const fs = require("fs")
const crypto = require("crypto")

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = path.resolve(__dirname, "..", "skills")

// Automatic re-prompts per session between forced_todo calls. When a phase
// stalls (model replies but never calls the tool), the idle handler re-prompts
// this many times, then injects ONE escalation prompt demanding a
// progress/ask/abort call, then goes quiet until the next tool call or user
// message. Counter resets on every forced_todo call.
const MAX_IDLE_CONTINUATIONS = 3

// Shared state with the forced_todo tool. The tool reads verifyTypesBySession at
// progress time to auto-verify n.phase tasks without an LLM round-trip. Shape:
//   Map<sessionID, Map<frameId, Map<phaseLookupKey, verifyType>>>
// Frame-keyed because skills can call other skills — each stacked roadmap frame
// is a different skill with its own phase markers.
const SHARED = (globalThis.__forced_todo_state__ ||= {
  verifyTypesBySession: new Map()
})

// sessionID -> stack of roadmap frames (top of array = active frame).
const sessionStacks = new Map()
const idleContinuationCount = new Map()
// sessionID -> Map<"frame::phaseId", {summary, label}>. Summaries outlive their
// frames: when the last frame pops (roadmap complete), the live stack can no
// longer supply summaries, but the persisted history is still un-pruned — every
// post-completion request would ship the full conversation. This map keeps
// pruning working after completion. Cleared only on session.deleted.
const retainedSummaries = new Map()

function getStack(sessionID) {
  return sessionStacks.get(sessionID) || []
}

function setStack(sessionID, stack) {
  sessionStacks.set(sessionID, stack)
}

function activeFrame(sessionID) {
  const s = getStack(sessionID)
  return s.length ? s[s.length - 1] : null
}

function clearSession(sessionID) {
  sessionStacks.delete(sessionID)
  idleContinuationCount.delete(sessionID)
  retainedSummaries.delete(sessionID)
  SHARED.verifyTypesBySession.delete(sessionID)
}

// Record a progress summary against the pre-reconcile active frame so pruning
// still has it after the frame pops. Called on every progress; the latest call
// wins, so a verified phase ends up with its final summary. Exported for tests.
export function retainSummary(sessionID, stack, summary) {
  if (!stack || !stack.length || !summary) return
  const top = stack[stack.length - 1]
  if (!top.current_phase_id) return
  const bySession = retainedSummaries.get(sessionID) || new Map()
  const label = stack.length > 1 ? `${top.skill_name} › ${top.current_phase_id}` : top.current_phase_id
  bySession.set(`${top.frame}::${top.current_phase_id}`, { summary, label })
  retainedSummaries.set(sessionID, bySession)
}

export function getRetainedSummaries(sessionID) {
  return retainedSummaries.get(sessionID) || new Map()
}

function loadSkillContent(skillName) {
  try {
    const skillPath = path.join(SKILLS_DIR, skillName, "SKILL.md")
    if (fs.existsSync(skillPath)) return fs.readFileSync(skillPath, "utf-8")
  } catch (_e) {}
  return null
}

// Parse phases from SKILL.md. Markers:
//   <!-- n.phase[: label] -->  → no verification (auto-verified by tool)
//   <!-- s.phase[: label] -->  → self verification
//   <!-- m.phase[: label] -->  → subagent verification
// The trailing label (if present) is the lookup key for verifications/<label>.md.
export function parseSkillPhases(content) {
  const phaseContents = new Map()
  const verifyTypes = new Map()
  const phaseLabels = new Map()
  if (!content) return { phaseContents, verifyTypes, phaseLabels }

  const lines = content.split("\n")
  let currentPhase = null
  let currentLines = []
  let inCodeFence = false

  const finalize = () => {
    if (!currentPhase) return
    phaseContents.set(currentPhase, currentLines.join("\n").trim())
    currentLines = []
  }

  for (const line of lines) {
    if (/^```/.test(line)) {
      inCodeFence = !inCodeFence
      if (currentPhase) currentLines.push(line)
      continue
    }
    if (!inCodeFence) {
      const headingMatch = line.match(/^##\s+(.+?)\s*$/)
      if (headingMatch) {
        finalize()
        const header = headingMatch[1].trim()
        currentPhase = stripPhasePrefix(header)
        verifyTypes.set(currentPhase, "self") // default
        continue
      }
      if (currentPhase) {
        const markerMatch = line.match(/<!--\s*([nsm])\.phase\b\s*(?::\s*([^\s>]+))?\s*-->/)
        if (markerMatch) {
          const tag = markerMatch[1]
          const verifyType = tag === "n" ? "none" : tag === "s" ? "self" : "subagent"
          verifyTypes.set(currentPhase, verifyType)
          if (markerMatch[2]) phaseLabels.set(currentPhase, markerMatch[2].trim().toLowerCase())
          continue
        }
      }
    }
    if (!currentPhase) continue
    currentLines.push(line)
  }
  finalize()

  return { phaseContents, verifyTypes, phaseLabels }
}

function stripPhasePrefix(header) {
  return header.replace(/^Phase\s+\d+\s*[:.\-]\s*/i, "").trim()
}

function loadVerifyCriteria(skillName, label) {
  if (!skillName || !label) return null
  try {
    const p = path.join(SKILLS_DIR, skillName, "verifications", `${label}.md`)
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8").trim() || null
  } catch (_e) {}
  return null
}

// Strip a `#N` runtime-id suffix to recover the SKILL.md lookup key.
// `lint#2` → `lint`; `Research` → `Research`. Used so re-runs added by the
// `extend` action inherit the original phase's content + verify type + rubric.
function lookupKeyFor(runtimeId) {
  if (typeof runtimeId !== "string") return runtimeId
  const idx = runtimeId.lastIndexOf("#")
  if (idx === -1) return runtimeId
  const suffix = runtimeId.slice(idx + 1)
  if (!/^\d+$/.test(suffix)) return runtimeId
  return runtimeId.slice(0, idx)
}

// Speed-mode demotion (quick mode): one verification step lighter per marker.
// s→n kills the structural self-check round-trip; m→s keeps ONE cheap self-verify
// on judgment-heavy phases but never spawns a subagent. Runs at frame-build time
// so the SKILL.md is untouched and both the plugin's prompts and the tool's
// auto-verify (via the shared verify-types map) see the demoted type. Pure;
// exported for tests.
export function demoteVerifyType(verifyType, mode) {
  if (mode !== "quick") return verifyType
  if (verifyType === "self") return "none"
  if (verifyType === "subagent") return "self"
  return verifyType
}

// Build a fresh plugin-side frame from a SKILL.md. Called when the footer shows
// a frame id the plugin hasn't seen yet (a `roadmap` push).
function buildFrame(footerFrame) {
  const skillContent = footerFrame.skill_name ? loadSkillContent(footerFrame.skill_name) : null
  const { phaseContents, verifyTypes, phaseLabels } = parseSkillPhases(skillContent)
  const mode = footerFrame.mode === "quick" ? "quick" : "full"
  for (const [phaseId, vt] of verifyTypes) {
    verifyTypes.set(phaseId, demoteVerifyType(vt, mode))
  }
  const verifyCriteria = new Map()
  if (footerFrame.skill_name) {
    for (const [phaseId, label] of phaseLabels) {
      const c = loadVerifyCriteria(footerFrame.skill_name, label)
      if (c) verifyCriteria.set(phaseId, c)
    }
  }
  return {
    frame: footerFrame.frame,
    skill_name: footerFrame.skill_name,
    mode,
    phases: footerFrame.phases.map(p => ({ id: p.id, status: p.status, summary: "" })),
    current_phase_id: footerFrame.current_phase_id,
    awaiting_user_reply: footerFrame.awaiting_user_reply || false,
    phase_contents: phaseContents,
    verify_types: verifyTypes,
    verify_criteria: verifyCriteria,
    phase_labels: phaseLabels,
    phase_summaries: new Map(),
    child_summaries: []
  }
}

// ---------- stack reconciliation ----------

function parseFtFooter(output) {
  if (typeof output !== "string") return null
  const m = output.match(/<!--FT:(.+?)-->/)
  if (!m) return null
  try { return JSON.parse(m[1]) } catch (_e) { return null }
}

function ftFrames(ft) {
  if (Array.isArray(ft?.stack)) return ft.stack
  return []
}

// Collapse a popped child frame into a single summary block its parent inherits.
function collapseFrame(frame) {
  const parts = []
  for (const p of frame.phases) {
    const sum = frame.phase_summaries.get(p.id) || p.summary
    if (sum) parts.push(`${p.id}: ${sum}`)
  }
  for (const c of frame.child_summaries) {
    parts.push(`↳ ${c.skill}: ${c.summary}`)
  }
  return parts.join(" | ")
}

// Reconcile the plugin's stack with the tool's footer: apply pushes (new frames),
// status syncs (existing frames), and pops (frames the footer no longer lists →
// collapse into the parent). Pure over (stack, ft, args); exported for tests.
// Returns the (possibly new) stack array.
export function reconcileStack(stack, ft, args, hooks = {}) {
  const make = hooks.buildFrame || buildFrame
  const setVerify = hooks.setVerifyTypes || (() => {})
  const clearVerify = hooks.clearVerifyTypes || (() => {})

  const footerFrames = ftFrames(ft)
  const footerIds = new Set(footerFrames.map(f => f.frame))
  const pluginById = new Map(stack.map(f => [f.frame, f]))
  const action = ft.action

  // 1. Capture the just-progressed phase summary against the pre-reconcile
  //    active frame (the model always acts on the deepest frame). Do this before
  //    pops so a child's final-phase summary is recorded even as it's removed.
  if (action === "progress" && args && args.summary) {
    const preActive = stack.length ? stack[stack.length - 1] : null
    if (preActive && preActive.current_phase_id) {
      const ph = preActive.phases.find(p => p.id === preActive.current_phase_id)
      if (ph) {
        ph.summary = args.summary
        const ff = footerFrames.find(f => f.frame === preActive.frame)
        const newStatus = ff ? (ff.phases.find(p => p.id === ph.id)?.status) : "verified"
        if (newStatus) ph.status = newStatus
        if (ph.status === "verified") preActive.phase_summaries.set(ph.id, args.summary)
      }
    }
  }

  // 2. Pushes: footer frames the plugin hasn't seen → build + append.
  for (const ff of footerFrames) {
    if (!pluginById.has(ff.frame)) {
      const frame = make(ff)
      stack.push(frame)
      pluginById.set(ff.frame, frame)
      setVerify(ff.frame, frame.verify_types)
    }
  }

  // 3. Sync statuses / current / awaiting for surviving frames; append any
  //    extend-added phases (present in footer, absent in plugin frame).
  for (const ff of footerFrames) {
    const frame = pluginById.get(ff.frame)
    if (!frame) continue
    const existingIds = new Set(frame.phases.map(p => p.id))
    for (const fp of ff.phases) {
      if (!existingIds.has(fp.id)) {
        frame.phases.push({ id: fp.id, status: fp.status, summary: "" })
      } else {
        const ph = frame.phases.find(p => p.id === fp.id)
        if (ph) ph.status = fp.status
      }
    }
    frame.current_phase_id = ff.current_phase_id
    frame.awaiting_user_reply = ff.awaiting_user_reply || false
  }

  // 4. Pops: plugin frames the footer no longer lists → collapse into parent,
  //    remove (deepest first so a child collapses before its parent does).
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]
    if (footerIds.has(frame.frame)) continue
    const parent = stack[i - 1]
    if (parent) {
      parent.child_summaries.push({
        skill: frame.skill_name,
        frame: frame.frame,
        summary: collapseFrame(frame) || "(no summary)"
      })
    }
    clearVerify(frame.frame)
    stack.splice(i, 1)
  }

  return stack
}

// ---------- pruning ----------

function isForcedTodoPromptMessage(msg) {
  if (msg?.info?.role !== "user") return false
  const parts = Array.isArray(msg.parts) ? msg.parts : []
  for (const p of parts) {
    if (p?.type === "text" && typeof p.text === "string" && p.text.startsWith("[FORCED TODO]")) return true
  }
  return false
}

// Walk forced_todo footers. Push a prune range whenever any phase (in any stacked
// frame) transitions to "verified", covering [phaseStartIdx .. msgIdx). Phase
// starts are tracked per FRAME-NAMESPACED id (`<frame>::<phaseId>`), not by bare
// phase id — so two stacked skills that both have a "Research" phase don't
// collide, and intermediate phases prune correctly when the pointer has moved on.
export function buildPhaseRanges(messages) {
  const ranges = []
  const phaseStart = new Map()  // "frame::id" -> first message index where current
  let prevStatuses = null

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg?.info?.role !== "assistant") continue
    const parts = Array.isArray(msg.parts) ? msg.parts : []

    for (const part of parts) {
      if (part?.type !== "tool" || part.tool !== "forced_todo") continue
      if (part.state?.status !== "completed") continue

      const ft = parseFtFooter(part.state?.output)
      if (!ft) continue
      const frames = ftFrames(ft)
      if (frames.length === 0) continue

      const newStatuses = new Map()
      for (const frame of frames) {
        for (const p of frame.phases || []) {
          newStatuses.set(`${frame.frame}::${p.id}`, {
            status: p.status, frame: frame.frame, bareId: p.id, skill: frame.skill_name
          })
        }
        if (frame.current_phase_id) {
          const key = `${frame.frame}::${frame.current_phase_id}`
          if (!phaseStart.has(key)) phaseStart.set(key, i + 1)
        }
      }

      if (prevStatuses) {
        for (const [key, info] of newStatuses) {
          const prev = prevStatuses.get(key)?.status
          if (prev !== "verified" && info.status === "verified") {
            const startIdx = phaseStart.get(key)
            if (startIdx !== undefined && startIdx <= i) {
              ranges.push({ nsId: key, frame: info.frame, bareId: info.bareId, skill: info.skill, startIdx, endIdx: i })
            }
          }
        }
      }
      prevStatuses = newStatuses
    }
  }
  return ranges
}

function generateSyntheticId(prefix, seed) {
  const hash = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16)
  return `${prefix}_${hash}`
}

function findLastUserMessage(messages, beforeIdx) {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.info?.role === "user") return m
  }
  return null
}

function createSyntheticSummaryMessage(baseUserMsg, summaryText, seed) {
  const baseInfo = baseUserMsg.info
  const messageId = generateSyntheticId("msg_es_summary", seed)
  const partId = generateSyntheticId("prt_es_summary", seed)
  const now = Date.now()
  const info = { id: messageId, sessionID: baseInfo.sessionID, role: "user", time: { created: now } }
  if (baseInfo.agent !== undefined) info.agent = baseInfo.agent
  if (baseInfo.model !== undefined) info.model = baseInfo.model
  if (baseInfo.variant !== undefined) info.variant = baseInfo.variant
  return {
    info,
    parts: [{ id: partId, sessionID: baseInfo.sessionID, messageID: messageId, type: "text", text: summaryText }]
  }
}

// `combined`: Map<"frame::id", { summary, label }>. Drops assistant + [FORCED
// TODO] messages inside each verified range and injects one synthetic summary.
function applyPruning(messages, ranges, combined) {
  if (ranges.length === 0) return 0
  const dropMsgIds = new Set()
  const anchorMap = new Map()

  for (const range of ranges) {
    const entry = combined.get(range.nsId)
    if (!entry) continue
    const anchorMsg = messages[range.endIdx]
    const anchorId = anchorMsg?.info?.id
    if (!anchorId) continue
    for (let i = range.startIdx; i < range.endIdx; i++) {
      const m = messages[i]
      const mid = m?.info?.id
      if (!mid) continue
      if (m.info.role === "assistant" || isForcedTodoPromptMessage(m)) dropMsgIds.add(mid)
    }
    anchorMap.set(anchorId, { entry, nsId: range.nsId })
  }

  if (dropMsgIds.size === 0 && anchorMap.size === 0) return 0

  const result = []
  let injected = 0
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const mid = msg?.info?.id
    const anchorEntry = mid ? anchorMap.get(mid) : null
    if (anchorEntry) {
      const seed = `${anchorEntry.nsId}:${mid}`
      const expectedId = generateSyntheticId("msg_es_summary", seed)
      const already = result.length > 0 && result[result.length - 1]?.info?.id === expectedId
      if (!already) {
        const baseUser = findLastUserMessage(messages, i)
        if (baseUser) {
          const text = `[Pruned phase "${anchorEntry.entry.label}"]\n\n${anchorEntry.entry.summary}`
          result.push(createSyntheticSummaryMessage(baseUser, text, seed))
          injected++
        }
      }
    }
    if (mid && dropMsgIds.has(mid)) continue
    result.push(msg)
  }

  messages.length = 0
  messages.push(...result)
  return injected
}

// Build the combined frame::id → {summary,label} map from the live stack.
function combinedSummaries(stack) {
  const combined = new Map()
  const multi = stack.length > 1
  for (const frame of stack) {
    for (const [pid, sum] of frame.phase_summaries) {
      const label = multi ? `${frame.skill_name} › ${pid}` : pid
      combined.set(`${frame.frame}::${pid}`, { summary: sum, label })
    }
  }
  return combined
}

// ---------- prompts ----------

const STOP = "End your turn now."

const SUMMARY_FORMAT = [
  `Summary format — 1–4 short bullets covering, as applicable to this phase:`,
  `- decisions made (with the chosen value)`,
  `- facts established (with source if external)`,
  `- artifacts produced (with file paths)`,
  `- open items handed to later phases`,
  ``,
  `Summaries are durable — they become the cumulative context header for every later phase. Thin summaries break downstream phases.`
].join("\n")

// Walk the WHOLE stack bottom→top (ancestors + active). Each frame contributes
// its verified-phase summaries plus any collapsed sub-skill (child) summaries.
// This is how context flows DOWN to a called skill and how a finished skill's
// outcome stays visible to its caller. Read-only — built fresh each prompt, never
// copied into a frame's own state.
export function formatContextHeader(stack) {
  const lines = []
  const multi = stack.length > 1
  for (const frame of stack) {
    const prefix = multi ? `[${frame.skill_name}] ` : ""
    for (const p of frame.phases) {
      if (p.status === "verified" && p.summary) lines.push(`- **${prefix}${p.id}**: ${p.summary}`)
    }
    for (const c of frame.child_summaries || []) {
      lines.push(`- **${prefix}↳ completed sub-skill ${c.skill}**: ${c.summary}`)
    }
  }
  if (lines.length === 0) return ""
  return `Context from earlier phases:\n${lines.join("\n")}\n\n`
}

function buildActPrompt(stack, phaseId, phaseContent) {
  return [
    `[FORCED TODO] Act on phase: ${phaseId}`,
    ``,
    formatContextHeader(stack) + `Phase content:`,
    phaseContent,
    ``,
    `When done, call:  forced_todo progress --summary "<your summary>"`,
    ``,
    SUMMARY_FORMAT,
    ``,
    STOP
  ].join("\n")
}

function buildVerifySelfPrompt(phaseId, phaseContent, verifyCriteria) {
  const rubric = verifyCriteria
    ? `### Verification criteria\n\n${verifyCriteria}`
    : `(No explicit verification criteria — verify against the phase content above.)`
  return [
    `[FORCED TODO] Self-verify phase: ${phaseId}`,
    ``,
    `MUST end this turn with a forced_todo progress call. Writing verification narrative without calling the tool will re-trigger this verify prompt indefinitely.`,
    ``,
    `--- Phase content ---`,
    phaseContent,
    `--- End phase content ---`,
    ``,
    rubric,
    ``,
    `Re-read your work. If gaps exist, fix them in this turn.`,
    `When the work satisfies the criteria, call:  forced_todo progress --summary "<final summary including any fixes>"`,
    ``,
    SUMMARY_FORMAT,
    ``,
    `MUST call forced_todo progress to mark this phase verified. Do not end your turn without it.`,
    STOP
  ].join("\n")
}

function buildVerifySubagentPrompt(phaseId, phaseContent, verifyCriteria) {
  const rubric = verifyCriteria
    ? `### Verification criteria\n\n${verifyCriteria}`
    : `(No explicit verification criteria — derive from phase content above.)`
  return [
    `[FORCED TODO] Subagent-verify phase: ${phaseId}`,
    ``,
    `MUST end this turn with a forced_todo progress call. Writing verification narrative without calling the tool will re-trigger this verify prompt indefinitely.`,
    ``,
    `Spawn a subagent (Task tool) to independently verify your work. Give it the criteria + pointers to your output. Ask for PASS/FAIL with reasoning.`,
    ``,
    `--- Phase content ---`,
    phaseContent,
    `--- End phase content ---`,
    ``,
    rubric,
    ``,
    `If the subagent fails, address the gaps and re-run verification before marking done.`,
    `Once it passes, call:  forced_todo progress --summary "<final summary + subagent verdict>"`,
    ``,
    SUMMARY_FORMAT,
    ``,
    `MUST call forced_todo progress to mark this phase verified. Do not end your turn without it.`,
    STOP
  ].join("\n")
}

// The always-on system-prompt block naming the active phase and what's expected.
// Escalates in the verify state ("acted"): that's where P1 stalls happen — the
// model writes verification prose but never calls the tool. Returns null when no
// banner applies (empty stack / active frame done / phase missing). Pure over
// (stack); exported for tests.
export function buildEnforcementBanner(stack) {
  if (!stack || !stack.length) return null
  const active = stack[stack.length - 1]
  if (!active.current_phase_id) return null  // active frame done

  const phase = active.phases.find(p => p.id === active.current_phase_id)
  if (!phase) return null

  const lines = [`=== FORCED TODO ENFORCEMENT ===`]
  if (stack.length > 1) {
    const chain = stack.map(f => f.skill_name).join(" → ")
    lines.push(`Skill call stack (depth ${stack.length}): ${chain}. You are working the deepest skill; it returns to its caller when complete.`)
  }
  if (active.awaiting_user_reply) {
    lines.push(
      `Waiting for the user's reply. After they answer, continue acting on phase "${phase.id}" using their input.`,
      `Call forced_todo progress --summary "<your summary>" when the phase work is done.`
    )
  } else if (phase.status === "acted") {
    lines.push(
      `Active phase: "${phase.id}" (acted — VERIFY turn) in skill "${active.skill_name}".`,
      `The work is claimed done; this turn is the verification. Run the check from the verify prompt, fix any gaps, then you MUST call forced_todo progress to mark the phase verified.`,
      `Verification narrative without the progress call does NOT advance the phase — the verify prompt will re-fire. End the turn with the tool call.`
    )
  } else {
    lines.push(
      `Active phase: "${phase.id}" (${phase.status}) in skill "${active.skill_name}".`,
      `After the orchestrator's prompt, finish the work, then call forced_todo progress.`,
      `If you need clarification, write the question in your reply, then call forced_todo ask.`
    )
  }
  lines.push(`=== END ENFORCEMENT ===`)
  return lines.join("\n")
}

// What the idle handler should do at a given continuation count: re-inject the
// phase prompt, escalate once, or stay quiet. Pure over (count); exported for tests.
export function idleAction(count) {
  if (count < MAX_IDLE_CONTINUATIONS) return "reprompt"
  if (count === MAX_IDLE_CONTINUATIONS) return "escalate"
  return "stop"
}

// Final prompt after MAX_IDLE_CONTINUATIONS re-prompts went nowhere. Names the
// stuck phase and forces a decision through the tool: progress, ask, or abort.
export function buildStuckEscalationPrompt(stack, count) {
  const active = stack[stack.length - 1]
  const phase = active.phases.find(p => p.id === active.current_phase_id)
  const phaseId = phase ? phase.id : active.current_phase_id
  return [
    `[FORCED TODO] Stuck on phase: ${phaseId}`,
    ``,
    `The orchestrator has re-prompted ${count} times without a forced_todo call. This is the final automatic continuation — after this turn the orchestrator goes quiet and the user must intervene manually.`,
    ``,
    `You MUST end this turn with exactly one forced_todo call:`,
    `- Work (including any required verification) is done → forced_todo progress --summary "<summary>"`,
    `- Blocked on a decision → write the question in your reply, then forced_todo ask (e.g. "Phase ${phaseId} is stuck after ${count} attempts — force-advance or abort?")`,
    `- Run cannot continue → forced_todo abort`,
    ``,
    STOP
  ].join("\n")
}

// A phase whose content lookup came back empty is ALWAYS a bug — an id the
// SKILL.md doesn't define (roadmap typo, heading renamed, file changed on disk,
// or a stale skill copy). Emitting a blank act prompt just makes the model
// flounder and the idle loop re-inject it. Surface the mismatch instead, with
// the ids the plugin actually parsed, and force a decision. Exported for tests.
export function buildMissingContentPrompt(phase, active) {
  const known = [...active.phase_contents.keys()]
  return [
    `[FORCED TODO] Phase content missing: ${phase.id}`,
    ``,
    `The roadmap points at phase "${phase.id}" (lookup key "${lookupKeyFor(phase.id)}"), but the parsed SKILL.md for skill "${active.skill_name}" has no content under that id. This is an orchestration bug, not a task instruction — do NOT improvise the phase.`,
    ``,
    `Phase ids the orchestrator parsed from the SKILL.md:`,
    known.length ? known.map(k => `- ${k}`).join("\n") : `(none — the SKILL.md failed to load or has no phase headings)`,
    ``,
    `You MUST end this turn with exactly one forced_todo call:`,
    `- If the work this phase intended is already done: forced_todo progress --summary "<summary>"`,
    `- Otherwise: write a short explanation of the mismatch in your reply, then forced_todo ask (e.g. "Roadmap phase '${phase.id}' doesn't exist in the SKILL.md — skip it, or abort?")`,
    ``,
    STOP
  ].join("\n")
}

// Decide which [FORCED TODO] prompt the model should currently see, based on the
// ACTIVE frame (top of stack). Returns null if no prompt is appropriate (stack
// empty, active frame done, or awaiting user reply).
function getCurrentPromptText(stack) {
  if (!stack || stack.length === 0) return null
  const active = stack[stack.length - 1]
  if (active.awaiting_user_reply) return null
  if (!active.current_phase_id) return null

  const phase = active.phases.find(p => p.id === active.current_phase_id)
  if (!phase) return null

  // Re-runs added by `extend` carry runtime ids like `<key>#2`; resolve content
  // and verify metadata via `lookupKeyFor`. The runtime id stays in the prompt
  // so the model can see this is a re-run.
  const lookupKey = lookupKeyFor(phase.id)
  const phaseContent = active.phase_contents.get(lookupKey) || ""
  const verifyCriteria = active.verify_criteria.get(lookupKey) || null
  const verifyType = active.verify_types.get(lookupKey) || "self"

  if (!phaseContent.trim() && (phase.status === "pending" || phase.status === "acted")) {
    return buildMissingContentPrompt(phase, active)
  }

  if (phase.status === "pending") {
    return buildActPrompt(stack, phase.id, phaseContent)
  }
  if (phase.status === "acted") {
    if (verifyType === "subagent") {
      return buildVerifySubagentPrompt(phase.id, phaseContent, verifyCriteria)
    }
    return buildVerifySelfPrompt(phase.id, phaseContent, verifyCriteria)
    // n.phase tasks never sit in "acted" — tool auto-verifies on first progress.
  }
  return null
}

// True if a [FORCED TODO] prompt with the same first line already appears in the
// last `lookback` messages — used to avoid double-injection by messages.transform.
function isPromptInRecent(messages, desiredHead, lookback = 8) {
  const start = Math.max(0, messages.length - lookback)
  for (let i = messages.length - 1; i >= start; i--) {
    const m = messages[i]
    if (m?.info?.role !== "user") continue
    const parts = Array.isArray(m.parts) ? m.parts : []
    for (const p of parts) {
      if (p?.type === "text" && p.text && p.text.startsWith(desiredHead)) return true
    }
  }
  return false
}

function appendSyntheticUserMessage(messages, text) {
  const baseUser = findLastUserMessage(messages, messages.length)
  if (!baseUser) return false
  const seed = `inject:${text.split("\n")[0]}:${messages.length}:${Date.now()}`
  messages.push(createSyntheticSummaryMessage(baseUser, text, seed))
  return true
}

// ---------- plugin ----------

export const forcedTodoPlugin = async (input) => {
  const client = input.client

  const setVerifyTypes = (sessionID) => (frame, types) => {
    const bySession = SHARED.verifyTypesBySession.get(sessionID) || new Map()
    bySession.set(frame, types)
    SHARED.verifyTypesBySession.set(sessionID, bySession)
  }
  const clearVerifyTypes = (sessionID) => (frame) => {
    SHARED.verifyTypesBySession.get(sessionID)?.delete(frame)
  }

  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const sessionID = event.properties?.sessionID
      if (!sessionID) return

      const stack = getStack(sessionID)
      if (!stack.length) return

      const promptText = getCurrentPromptText(stack)
      if (!promptText) return

      const count = idleContinuationCount.get(sessionID) || 0
      const action = idleAction(count)
      if (action === "stop") return
      idleContinuationCount.set(sessionID, count + 1)

      const text = action === "escalate" ? buildStuckEscalationPrompt(stack, count) : promptText

      await client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text }] }
      })
    },

    "tool.execute.after": async (toolInput, output) => {
      if (toolInput.tool !== "forced_todo") return
      const sessionID = toolInput.sessionID

      const text = typeof output === "string" ? output : (output?.output || "")
      const ft = parseFtFooter(text)
      if (!ft) return

      const args = toolInput.args || {}
      const stack = getStack(sessionID)

      // Retain BEFORE reconcile: the pre-pop stack still knows which frame/phase
      // this progress belongs to, even when it's the run's final progress.
      if (args.action === "progress" || ft.action === "progress") {
        retainSummary(sessionID, stack, args.summary)
      }

      reconcileStack(stack, ft, args, {
        setVerifyTypes: setVerifyTypes(sessionID),
        clearVerifyTypes: clearVerifyTypes(sessionID)
      })
      setStack(sessionID, stack)

      // Reset idle continuation counter on every tool call so the next idle can fire.
      idleContinuationCount.set(sessionID, 0)
    },

    "experimental.chat.messages.transform": async (input, output) => {
      const messages = Array.isArray(output?.messages) ? output.messages : null
      if (!messages || messages.length === 0) return
      const sessionID = input?.sessionID || messages[0]?.info?.sessionID
      if (!sessionID) return
      const stack = getStack(sessionID)
      const retained = getRetainedSummaries(sessionID)
      // Keep pruning even after the roadmap completes (stack empty) — otherwise
      // every post-completion request ships the full un-pruned history.
      if (!stack.length && retained.size === 0) return

      // 1. Prune verified phases first (frame-namespaced — see buildPhaseRanges).
      //    Live-stack summaries win over retained ones (same key, fresher data).
      const ranges = buildPhaseRanges(messages)
      if (ranges.length > 0) {
        const combined = new Map(retained)
        for (const [k, v] of combinedSummaries(stack)) combined.set(k, v)
        applyPruning(messages, ranges, combined)
      }
      if (!stack.length) return  // no roadmap active — nothing to tail-inject

      // 2. Ensure the right [FORCED TODO] prompt is at the tail. Catches cases
      //    where session.idle didn't fire — the next outgoing request still gets
      //    the act/verify prompt for whatever phase the active frame is on.
      const promptText = getCurrentPromptText(stack)
      if (!promptText) return
      const head = promptText.split("\n")[0]
      if (isPromptInRecent(messages, head)) return
      appendSyntheticUserMessage(messages, promptText)
    },

    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = input.sessionID
      if (!sessionID) return
      const banner = buildEnforcementBanner(getStack(sessionID))
      if (banner) output.system.push(banner)
    },

    "session.deleted": (sessionInput) => {
      clearSession(sessionInput.sessionID)
    }
  }
}
