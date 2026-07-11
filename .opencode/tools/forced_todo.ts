import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import fs from "fs"
import path from "path"

// Guarded so the module imports cleanly outside opencode (e.g. unit tests, where
// `__dirname` isn't defined under plain ESM). In opencode this reads normally.
let DESCRIPTION = ""
try {
  DESCRIPTION = fs.readFileSync(path.join(__dirname, "forced_todo.txt"), "utf-8")
} catch (_e) {
  DESCRIPTION = "forced_todo: phased-skill orchestrator tool (description file unavailable)."
}

type PhaseStatus = "pending" | "acted" | "verified"

interface Phase {
  id: string
  status: PhaseStatus
  summary: string
}

// One roadmap frame. Skills can call other skills: each `roadmap` call mid-run
// pushes a new frame onto the session's stack (a call stack). The active frame
// is the top of the stack; progress/ask/extend operate on it; completing it (or
// `abort`) pops back to the caller. `frame` is a stable per-session id (`f1`,
// `f2`, ...) used to namespace phases so two frames with the same phase-id text
// (e.g. both have a "Research" phase) don't collide in the plugin's pruning map.
// Speed mode, chosen per roadmap. "full" runs markers as authored; "quick"
// demotes them at runtime (s→n, m→s — the plugin owns the mapping). The mode
// only travels through state + footer here; all demotion logic is plugin-side.
type SpeedMode = "full" | "quick"

interface State {
  skill_name: string | null
  frame: string
  mode: SpeedMode
  phases: Phase[]
  current_phase_id: string | null
  awaiting_user_reply: boolean
  pending_question: string | null
}

// Cap nesting so a skill-invokes-skill cycle (A → B → A → …) can't run away.
const MAX_STACK_DEPTH = 5

// sessionID -> stack of frames (top of array = active frame).
const stateMap = new Map<string, State[]>()
// sessionID -> last frame number issued, for monotonic `fN` ids.
const frameSeqMap = new Map<string, number>()

function getStack(sessionID: string): State[] {
  return stateMap.get(sessionID) || []
}

function activeFrame(sessionID: string): State | undefined {
  const s = getStack(sessionID)
  return s.length ? s[s.length - 1] : undefined
}

function nextFrameId(sessionID: string): string {
  const n = (frameSeqMap.get(sessionID) || 0) + 1
  frameSeqMap.set(sessionID, n)
  return `f${n}`
}

// Strip a `#N` runtime-id suffix to recover the SKILL.md lookup key.
// `lint#2` → `lint`; `Research` → `Research`; `weird#name` (non-numeric suffix) → unchanged.
function lookupKeyFor(runtimeId: string): string {
  const idx = runtimeId.lastIndexOf("#")
  if (idx === -1) return runtimeId
  const suffix = runtimeId.slice(idx + 1)
  if (!/^\d+$/.test(suffix)) return runtimeId
  return runtimeId.slice(0, idx)
}

// Read verify-types map populated by the plugin via globalThis. Keyed by
// session → frame → lookup key, so each stacked skill resolves its own markers
// and re-runs (`<key>#N`) inherit the original phase's verify type.
function getVerifyType(sessionID: string, frame: string, phaseId: string): string | null {
  if (!sessionID || !frame || !phaseId) return null
  const shared = (globalThis as any).__forced_todo_state__
  const m = shared?.verifyTypesBySession?.get(sessionID)?.get(frame)
  if (!m) return null
  return m.get(lookupKeyFor(phaseId)) || null
}

function advanceCurrent(state: State): void {
  const next = state.phases.find(p => p.status === "pending")
  state.current_phase_id = next ? next.id : null
}

// Generate the next runtime id for a re-run of `lookupKey` within one frame.
// First re-run after the original is `<key>#2`, then `#3`, etc.
function nextRuntimeId(state: State, lookupKey: string): string {
  let maxN = 0
  let exists = false
  for (const p of state.phases) {
    if (lookupKeyFor(p.id) !== lookupKey) continue
    exists = true
    if (p.id === lookupKey) {
      maxN = Math.max(maxN, 1)
    } else {
      const n = parseInt(p.id.slice(lookupKey.length + 1), 10)
      if (!Number.isNaN(n)) maxN = Math.max(maxN, n)
    }
  }
  if (!exists) return lookupKey
  return `${lookupKey}#${maxN + 1}`
}

// The footer carries the WHOLE stack so the plugin can detect pushes (a frame it
// hasn't seen) and pops (a frame it has that's now gone) by diffing, then mirror
// the state machine and route pruning/prompts to the active frame.
function ftFooter(sessionID: string, action: string): string {
  const stack = getStack(sessionID)
  const top = stack.length ? stack[stack.length - 1] : null
  const payload = {
    action,
    active_frame: top ? top.frame : null,
    skill_name: top ? top.skill_name : null,
    current_phase_id: top ? top.current_phase_id : null,
    awaiting_user_reply: top ? top.awaiting_user_reply : false,
    stack: stack.map(f => ({
      frame: f.frame,
      skill_name: f.skill_name,
      mode: f.mode,
      current_phase_id: f.current_phase_id,
      awaiting_user_reply: f.awaiting_user_reply,
      phases: f.phases.map(p => ({ id: p.id, status: p.status }))
    }))
  }
  return `<!--FT:${JSON.stringify(payload)}-->`
}

interface DispatchResult {
  ok: boolean
  message: string
}

// Pure reducer over the module's session stores. Exported for unit tests; the
// opencode `tool()` wrapper below calls it and adds the UI metadata + footer.
export function dispatch(sessionID: string, args: any): DispatchResult {
  // Defend against clients that pass `phases` as stringified JSON rather than a
  // native array. Without this guard the duplicate-check loop iterates the
  // string char-by-char and surfaces a confusing "duplicate phase id: <char>"
  // error the model cannot recover from. Strict reject so it's fixed at source.
  if (args.phases !== undefined && !Array.isArray(args.phases)) {
    return {
      ok: false,
      message:
        `Error: phases must be a JSON array of strings, got ${typeof args.phases}. ` +
        `Pass phases: ["A", "B"] not phases: "[\\"A\\", \\"B\\"]".`
    }
  }

  switch (args.action) {
    case "roadmap": {
      if (!args.phases || args.phases.length === 0) {
        return { ok: false, message: "Error: roadmap requires phases (string[])." }
      }
      if (args.mode !== undefined && args.mode !== "full" && args.mode !== "quick") {
        return { ok: false, message: `Error: mode must be "full" or "quick", got '${args.mode}'.` }
      }
      const seen = new Set<string>()
      for (const id of args.phases) {
        if (seen.has(id)) return { ok: false, message: `Error: duplicate phase id in roadmap: ${id}` }
        seen.add(id)
      }
      const stack = getStack(sessionID)
      // Pop any completed top frames first (the plugin normally auto-pops, but a
      // fresh roadmap on a finished session should start a clean root).
      while (stack.length && stack[stack.length - 1].current_phase_id === null) stack.pop()
      if (stack.length >= MAX_STACK_DEPTH) {
        return {
          ok: false,
          message:
            `Error: roadmap stack depth limit (${MAX_STACK_DEPTH}) reached. ` +
            `Finish or 'abort' the active skill before nesting another.`
        }
      }
      const state: State = {
        skill_name: args.skill_name || null,
        frame: nextFrameId(sessionID),
        mode: args.mode === "quick" ? "quick" : "full",
        phases: args.phases.map((id: string) => ({ id, status: "pending" as PhaseStatus, summary: "" })),
        current_phase_id: args.phases[0],
        awaiting_user_reply: false,
        pending_question: null
      }
      stack.push(state)
      stateMap.set(sessionID, stack)
      const depthNote = stack.length > 1 ? ` (nested at depth ${stack.length})` : ""
      const modeNote = state.mode === "quick" ? " (quick mode: reduced verification)" : ""
      return { ok: true, message: `roadmap recorded${depthNote}${modeNote} — orchestrator will resume.` }
    }

    case "progress": {
      const top = activeFrame(sessionID)
      if (!top) return { ok: false, message: "Error: no active roadmap. Call action=roadmap first." }
      if (!top.current_phase_id) return { ok: false, message: "Error: roadmap is complete; nothing to progress." }
      if (typeof args.summary !== "string" || !args.summary.trim()) {
        return { ok: false, message: `Error: progress requires a summary (non-empty string), got ${args.summary === undefined ? "nothing" : typeof args.summary}.` }
      }
      const phase = top.phases.find(p => p.id === top.current_phase_id)
      if (!phase) return { ok: false, message: `Error: current phase "${top.current_phase_id}" missing from roadmap.` }

      // A progress call ends any pending question — the model is unblocking.
      top.awaiting_user_reply = false
      top.pending_question = null

      const wasActed = phase.status === "acted"
      phase.summary = args.summary.trim()

      if (wasActed) {
        // Verify-progress: model has run self/subagent verification.
        phase.status = "verified"
        advanceCurrent(top)
      } else {
        const verifyType = getVerifyType(sessionID, top.frame, phase.id)
        if (verifyType === "none") {
          // n.phase: skip the verify round-trip entirely.
          phase.status = "verified"
          advanceCurrent(top)
        } else {
          phase.status = "acted"
        }
      }

      // Auto-pop: when the active frame finishes, return to the caller.
      let popped = false
      if (top.current_phase_id === null) {
        getStack(sessionID).pop()
        popped = true
      }
      if (popped) {
        const parent = activeFrame(sessionID)
        const note = parent ? `sub-skill complete, resuming "${parent.skill_name}".` : "roadmap complete."
        return { ok: true, message: `phase progress recorded — ${note} Orchestrator will resume.` }
      }
      return { ok: true, message: "phase progress recorded — orchestrator will resume." }
    }

    case "ask": {
      const top = activeFrame(sessionID)
      if (!top) return { ok: false, message: "Error: no active roadmap. Call action=roadmap first." }
      if (typeof args.question !== "string" || !args.question.trim()) {
        return { ok: false, message: `Error: ask requires a question (non-empty string), got ${args.question === undefined ? "nothing" : typeof args.question}.` }
      }
      top.awaiting_user_reply = true
      top.pending_question = args.question.trim()
      return { ok: true, message: "question recorded — waiting for user reply." }
    }

    case "extend": {
      const top = activeFrame(sessionID)
      if (!top) return { ok: false, message: "Error: no active roadmap. Call action=roadmap first." }
      if (!args.phases || args.phases.length === 0) {
        return { ok: false, message: "Error: extend requires phases (string[]) — lookup keys to re-run." }
      }
      for (const key of args.phases) {
        if (key !== lookupKeyFor(key)) {
          return { ok: false, message: `Error: extend phases must be original ids as written in the SKILL.md; got '${key}'.` }
        }
        if (!key.trim()) return { ok: false, message: "Error: extend phase keys must be non-empty." }
      }

      const added: string[] = []
      for (const key of args.phases) {
        const runtimeId = nextRuntimeId(top, key)
        top.phases.push({ id: runtimeId, status: "pending", summary: "" })
        added.push(runtimeId)
      }

      // If the frame had been complete (current null), the first newly-added
      // phase becomes current. Otherwise leave current alone — caller is mid-phase.
      if (top.current_phase_id === null) {
        advanceCurrent(top)
      }
      return {
        ok: true,
        message: `roadmap extended with ${added.length} phase(s): ${added.join(", ")}.`
      }
    }

    case "abort": {
      const stack = getStack(sessionID)
      if (!stack.length) return { ok: false, message: "Error: no active roadmap to abort." }
      const aborted = stack.pop()!
      stateMap.set(sessionID, stack)
      const parent = activeFrame(sessionID)
      const note = parent ? ` Resumed "${parent.skill_name}".` : " Stack empty."
      return { ok: true, message: `aborted roadmap "${aborted.skill_name}" (${aborted.frame}).${note}` }
    }

    default:
      return { ok: false, message: `Error: Unknown action: ${args.action}` }
  }
}

// Test-only handle: lets unit tests reset and inspect the session stores without
// going through the opencode tool wrapper.
export const __test = {
  reset(sessionID?: string) {
    if (sessionID) {
      stateMap.delete(sessionID)
      frameSeqMap.delete(sessionID)
    } else {
      stateMap.clear()
      frameSeqMap.clear()
    }
  },
  stack: (sessionID: string) => getStack(sessionID),
  active: (sessionID: string) => activeFrame(sessionID),
  footer: (sessionID: string, action: string) => ftFooter(sessionID, action),
  setVerifyTypes(sessionID: string, frame: string, types: Record<string, string>) {
    const shared = ((globalThis as any).__forced_todo_state__ ||= { verifyTypesBySession: new Map() })
    const bySession = shared.verifyTypesBySession.get(sessionID) || new Map()
    bySession.set(frame, new Map(Object.entries(types)))
    shared.verifyTypesBySession.set(sessionID, bySession)
  }
}

function emitState(
  context: { metadata(input: { title?: string; metadata?: Record<string, any> }): void },
  sessionID: string,
  action: string,
  title: string
): void {
  const stack = getStack(sessionID)
  const top = stack.length ? stack[stack.length - 1] : null
  context.metadata({
    title,
    metadata: {
      action,
      depth: stack.length,
      mode: top?.mode ?? "full",
      skill_name: top?.skill_name ?? null,
      current_phase_id: top?.current_phase_id ?? null,
      awaiting_user_reply: top?.awaiting_user_reply ?? false,
      pending_question: top?.pending_question ?? null,
      stack: stack.map(f => ({ frame: f.frame, skill_name: f.skill_name, current_phase_id: f.current_phase_id })),
      phases: top ? top.phases.map(p => ({ id: p.id, status: p.status, summary: p.summary })) : [],
      todos: top
        ? top.phases.map(p => ({
            content: p.id,
            status: p.status === "verified" ? "completed" : p.status === "acted" ? "in_progress" : "pending",
            priority: p.id === top.current_phase_id ? "high" : "medium"
          }))
        : []
    }
  })
}

export default tool({
  description: DESCRIPTION,

  args: {
    action: z.enum(["roadmap", "progress", "ask", "extend", "abort"]),
    skill_name: z.string().optional(),
    mode: z.enum(["full", "quick"]).optional(),
    phases: z.array(z.string()).optional(),
    summary: z.string().optional(),
    question: z.string().optional()
  },

  async execute(args, context) {
    const sessionID = context.sessionID
    const result = dispatch(sessionID, args)
    if (!result.ok) return result.message

    const top = activeFrame(sessionID)
    const title =
      args.action === "roadmap"
        ? `forced_todo: roadmap (${top ? top.phases.length : 0} phases, depth ${getStack(sessionID).length})`
        : args.action === "progress"
        ? `forced_todo: progress — ${top?.current_phase_id ?? "complete"}`
        : args.action === "ask"
        ? `forced_todo: ask — ${top?.current_phase_id ?? "<no phase>"}`
        : args.action === "abort"
        ? `forced_todo: abort (depth ${getStack(sessionID).length})`
        : `forced_todo: extend`
    emitState(context, sessionID, args.action, title)
    return `${result.message}\n${ftFooter(sessionID, args.action)}`
  }
})
