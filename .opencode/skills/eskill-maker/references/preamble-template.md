# E-skill SKILL.md preamble template

Every E-skill SKILL.md needs a roughly identical opening — frontmatter + a few non-phase prose sections that teach the model the contract before any phase begins. Copy this template, fill the `<<<...>>>` placeholders, and the result satisfies the contract's "model contract" requirements (see contract-summary.md §"The model's contract").

Use `###` for the prose sub-sections so they don't accidentally become phase boundaries (the runtime's `^##\s+` parser would otherwise treat them as phantom phases).

---

## The template

```markdown
---
name: <<<skill-name>>>
description: <<<one or two sentences: what this skill does AND when to use it. Include trigger phrases users might type even without naming the skill. "Pushy" framing is encouraged — Claude undertriggers skills by default.>>>
evolved: true
---

# <<<Human-readable Title>>>

<<<one-paragraph framing of what this skill produces and the rough flow>>>

### CRITICAL RULE: Stop after every `forced_todo` call

After any `forced_todo` call, **end your turn immediately**. No further tool calls. No further text. The orchestrator (a plugin) replies with the next instruction; if you keep generating, you'll skip past verify prompts and produce thin work.

**If `forced_todo` returns an error**, re-read the error, fix your call shape, and retry. Do NOT abandon the orchestrator and proceed without it — every later phase depends on the roadmap state the orchestrator owns. Common shape errors: `phases` passed as a stringified JSON literal instead of a native array (use `phases: ["A", "B"]`, not `phases: "[\"A\", \"B\"]"`); phase id case mismatch; missing `skill_name` on `roadmap`.

### FIRST STEP: Declare your roadmap

Call `forced_todo` with action `roadmap`, naming the phases you'll run. Phase ids MUST match the headings below exactly (after stripping the `Phase N:` prefix — e.g., `## Phase 2: Research` → id `Research`).

```
forced_todo roadmap \
  --skill_name "<<<skill-name>>>" \
  --phases [<<<phase ids in order>>>]
```

Pick a subset that matches the user's task. Examples:

- <<<example task shape 1>>> → all phases.
- <<<example task shape 2>>> → [<<<subset>>>].
- <<<example task shape 3>>> → [<<<single-phase subset>>>].

If the user signals speed over rigor ("quick draft", "rough pass"), add `mode: "quick"` to the roadmap call — the orchestrator lightens per-phase verification. Default is full rigor.

Then stop. The orchestrator sends the next instruction.

### How phases run

For each phase the orchestrator picks for you:

1. You receive a `[FORCED TODO] Act on phase: X` prompt with the phase content (and a recap of what earlier phases established). The prompt carries the authoritative summary-format spec — follow it.
2. You do the work.
3. You call `forced_todo progress --summary "<what you did>"` and stop.
4. If the phase needs verification, the orchestrator sends a verify prompt (also carrying the summary-format spec). Run the check (re-read or spawn a subagent), fix any gaps in the same turn, then call `forced_todo progress --summary "<final summary, including fixes>"` and stop.
5. The orchestrator advances to the next phase.

The "recap of what earlier phases established" is only each prior phase's short summary — once a phase verifies, the orchestrator prunes its full conversation. Any artifact a later phase needs to read must therefore live in a file on disk, not in the conversation. Phases that produce such an artifact say where they write it; phases that consume it say which file to read.

### Asking the user a question

Any time you need clarification, write the question text in your reply (so the user sees it) and call:

```
forced_todo ask --question "<the question text>"
```

Stop. The user will reply. On the next turn, continue acting on the current phase using their answer, then call `forced_todo progress` when done.

### Re-running phases after fixes (only inside an iterate-style phase)

If a verification phase surfaced real gaps, an iterate-style phase can append re-runs of earlier phases to the end of the roadmap:

```
forced_todo extend --phases [<<<phase ids to re-run, plus the iterate phase if more iteration may still be needed>>>]
```

Pass the original phase ids as written in the SKILL.md. Original verified phases stay verified; re-runs are net-new pending entries that inherit the original's content + rubric. Include the iterate phase itself in the list when continued iteration may still be needed — the loop runs only once otherwise.

(Skip this section if the skill has no iterate phase.)

---

## Phase 1: <<<First Phase Name>>>
<!-- <<<n|s|m>>>.phase: <<<label>>> -->

<<<phase content — the model will see this verbatim when acting on this phase. Instructions for DOING the work only: no success criteria, no check-your-work lists, no rubric previews — those live in verifications/<label>.md and arrive in the verify prompt>>>

## Phase 2: <<<Second Phase Name>>>
<!-- <<<n|s|m>>>.phase: <<<label>>> -->

<<<...>>>
```

---

## Notes on the template

- **`evolved: true`** in frontmatter is convention only — the runtime doesn't read it. Include it so human readers and any future filter can recognize E-skills at a glance.
- **The five `###` headings** (CRITICAL RULE, FIRST STEP, How phases run, Asking the user a question, Re-running phases after fixes) are at h3, not h2, **on purpose**. The runtime treats every `^##\s+` as a phase boundary; if you write these as h2 they'd become phantom phases (no marker → default `s.phase` with no rubric). Use h3 to keep them as documentation that lives between the title (h1) and the first phase (h2).
- **The "Re-running phases after fixes" section** can be omitted entirely if the skill has no iterate-style phase. Keeping it adds ~10 lines of preamble the model reads on every load — only worth it for skills that actually use `extend`.
- **The "FIRST STEP" examples** matter — they teach the model how to interpret the user's task into a phase subset. The bundled `examples/plan-architect/SKILL.md` examples are a good model: full task → all phases, narrow task → small subset, review-only → just the review phase.
- **Case sensitivity:** phase ids in the `forced_todo roadmap` examples must exactly match the heading text post-strip. If your headings are `## Phase 1: Confirm Understanding`, the example must say `["Confirm Understanding"]` — not `confirm understanding`.
- **Marker placement:** put the marker comment on the line immediately after the heading. The runtime accepts it anywhere inside the phase, but having it next to the heading makes diffs easy to read and matches the bundled plan-architect example's style.
- **No verification content in phase bodies.** An `s`/`m` phase body must contain only the instructions for doing the work. The grading criteria go in `verifications/<label>.md` — the runtime pastes them into the verify prompt after the act turn. A body that also tells the model to check its own work makes the verify turn look redundant; the model then narrates verification without calling `forced_todo progress` and the phase stalls. `lint_eskill.py` errors on these patterns.

---

## Worked example

See [examples/plan-architect/SKILL.md](examples/plan-architect/SKILL.md) — bundled inside this skill. Its preamble was written by hand and reads as the canonical reference. Compare to this template:

| Template section | plan-architect equivalent |
|---|---|
| Frontmatter | Lines 1-5 (name, description, `evolved: true`) |
| Title + framing paragraph | Lines 7-9 |
| CRITICAL RULE | Lines 11-13 — but plan-architect uses `##` instead of `###`. **plan-architect predates the phantom-phase rule and currently fails lint with INFO-level warnings on these.** New E-skills should use `###`. |
| FIRST STEP + roadmap example | Lines 15-31 |
| How phases run | Lines 33-43 |
| Asking the user a question | Lines 45-53 |
| Phase 1 onward | Lines 57+ |

Note plan-architect omits the extend section because none of its phases use it.
