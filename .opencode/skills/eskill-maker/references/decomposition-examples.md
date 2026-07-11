# Phase decomposition — worked examples

Concrete decompositions for a few different E-skill shapes. Use these as few-shot guidance when running Phase 2 (Decompose into Phases) of `eskill-maker`. Each example shows the captured intent, the phase breakdown the model proposed, and the rationale tying each marker choice to the phase's job.

The goal of decomposition is to find the right phase granularity:

- **Too fat** — one phase doing research + decisions + writing → can't verify the parts independently, summary loses signal.
- **Too thin** — every micro-step its own phase → noise in the roadmap, summaries become trivial, model spends turns on phase boilerplate.
- **Right** — one phase per *transition that produces a durable, namable artifact*. The summary should always be able to say "I produced X" or "I decided Y" without ambiguity.

---

## Example 1: plan-architect (5 phases, mixed markers)

### Captured intent

> Create detailed implementation plans for features, refactors, or system changes. The plan should include research, alternatives analysis, decision capture, the actual plan document, and a final user review. Triggers on phrases like "I need to add X", "how should I approach Y", "refactor the auth system".

### Decomposition

| # | Phase id                          | Marker         | Why this marker                                                                                       |
|---|-----------------------------------|----------------|-------------------------------------------------------------------------------------------------------|
| 1 | Confirm Understanding             | `n.phase: confirm`   | Output is a captured spec the user signs off conversationally; no machine verification helps.    |
| 2 | Research                          | `m.phase: research`  | High variance in what counts as "good" research. Subagent rubric (cost-benefit, ≥2 alternatives, source attribution) is the only honest check. |
| 3 | Present Options and Get Decisions | `m.phase: options`   | Subagent verifies that decisions are actually captured (not "we'll consider it later") and that user-affecting choices got user input. |
| 4 | Write the Implementation Plan     | `s.phase: write`     | Self-verify against a structural rubric (required sections, file paths with line numbers, risks table filled). Mechanical enough that the model re-reading its own work catches misses. |
| 5 | Review and Iterate                | `m.phase: review`    | Subagent confirms the four review questions were asked, user feedback is captured, no silent scope expansion. |

### What this teaches

- **n.phase for capture-and-confirm work.** When the output IS the conversation, machine verification adds nothing.
- **m.phase for judgment-heavy work.** Research, decisions, integration handoffs — anywhere a fresh-eyes reviewer catches what the author missed.
- **s.phase for structural work.** When the rubric is mostly "did you include all the required sections", self-verify is sufficient.
- **One phase per durable artifact.** Each phase produces something namable: a captured spec, a research dossier, a decision log, a plan document, a sign-off.

---

## Example 2: eskill-maker itself (10 phases, conditional last 2)

### Captured intent

> Produce E-skills that satisfy the eskill-contract. Workflow: interview the user, decompose into phases, draft SKILL.md and verifications, lint, semantic review, smoke test, optionally iterate, optionally optimize description, optionally package.

### Decomposition

| #  | Phase id           | Marker                  | Why this marker                                                                                       |
|----|--------------------|-------------------------|-------------------------------------------------------------------------------------------------------|
| 1  | Capture Intent     | `n.phase: intent`             | Heavy on `ask`; output is a captured spec.                                                          |
| 2  | Decompose          | `m.phase: decompose`          | Cost of a bad decomposition compounds across every later phase. Blind subagent catches granularity errors and wrong marker picks. |
| 3  | Draft SKILL.md     | `s.phase: draft-skill`        | Self-verify against the contract (preamble present, marker per phase, summary format taught).        |
| 4  | Draft Verifications| `s.phase: draft-rubrics`      | Self-verify against a rubric-shape rubric (each file is checklist + PASS/FAIL, m.phase rubrics are self-contained). |
| 5  | Semantic Review    | `n.phase: review-semantic`    | Verification IS the act here. Phase spawns a subagent against the rubric, fixes gaps, loops until PASS (max 3) or surfaces via `ask`. An `m.phase` here would duplicate the subagent spawn — same rubric, same model, two passes for one verdict. |
| 6  | Lint               | `n.phase: lint`               | Script-driven (deterministic). Exit code IS the verdict. Phase body owns the fix loop (max 5) and the "don't call progress until exit 0" rule, so an `s.phase` verify round-trip would add nothing past the act-prose. |
| 7  | Smoke Test         | `n.phase: smoke`              | Script-driven via `erun_eval.py`; exit code IS the verdict, no LLM judgment needed.                  |
| 8  | Iterate            | `s.phase: iterate`            | Decides which phases to re-run via `extend`; self-verify against the gap evidence already in context. An `m.phase` spent a whole subagent session confirming no-op decisions — the evidence (three verification summaries) is all in the header, so fresh eyes add cost, not accuracy. |
| 9  | Optimize Description (optional) | `n.phase: optimize` | Wraps `run_loop.py`; deterministic outcome.                                                        |
| 10 | Package (optional) | `n.phase: package`            | Wraps `package_skill.py`; deterministic outcome.                                                    |

### What this teaches

- **`n.phase` for script-driven phases AND for "verification IS the act" phases.** Lint, Smoke Test, Optimize, Package are script-driven. Semantic Review uses `n.phase` because the act is "spawn subagent → fix → loop" — putting `m.phase` on top would duplicate the subagent spawn for the same rubric verdict.
- **Use `s.phase` / `m.phase` only when act ≠ verify.** Decompose, Draft SKILL, Draft Verifications, Iterate all produce one artifact in act and check it in verify — the work is genuinely different. When act already loops against a rubric (Semantic Review) or a script (Lint), the verify round-trip adds nothing and burns cycles.
- **Bounded loops belong in act-body prose.** Phase 5 caps at 3 subagent spawns; Phase 6 caps at 5 lint re-runs. Both surface to `forced_todo ask` on cap. Without the cap, an `n.phase` loop-until-pass can run forever.
- **Optional phases via roadmap subset.** The model decides at roadmap time whether to include 9 and 10. SKILL.md should give explicit examples.
- **`extend` as a first-class capability.** Phase 8 (iterate) doesn't try to be the do-it-all phase — it just decides what to re-run and the runtime handles the rest.

---

## Example 3: a hypothetical mcp-builder (4 phases, all judgement-heavy)

### Captured intent

> Build an MCP server from scratch. Workflow: research MCP design + framework choice, scaffold the project, implement tools, write evaluation tests. The user is technical (knows what MCP is, expects rigor) and the output is a working server, not a plan.

### Decomposition

| # | Phase id         | Marker                 | Why this marker                                                                                                  |
|---|------------------|------------------------|------------------------------------------------------------------------------------------------------------------|
| 1 | Research and Plan| `m.phase: planning`    | MCP design choices have long-term consequences; subagent verifies that protocol versions, framework, and tool boundaries were all evaluated. |
| 2 | Set Up Project   | `s.phase: scaffold`    | Mostly mechanical — directory layout, package.json, tsconfig, lockfile. Self-verify against a checklist suffices. |
| 3 | Implement Tools  | `m.phase: implement`   | The biggest phase. Subagent verifies each tool has correct schema, error handling, edge cases tested in code.    |
| 4 | Write Evaluations| `m.phase: evaluations` | Subagent verifies eval prompts cover happy path + 2+ failure modes per tool, expectations are testable, not "should work". |

### What this teaches

- **Not every skill needs an `n.phase`.** When every phase produces something machine-verifiable in some way, every phase can have a real rubric.
- **Phase count scales with task complexity, not template.** plan-architect needed 5 because of the present-options-and-get-decisions handshake; this skill needs 4 because there's no user-decision phase (the user already decided to build an MCP server).
- **No iterate phase here.** The output is code; if smoke testing finds bugs, the user iterates by re-running the skill on a fresh request, not by extending the current roadmap. Iterate phases are most valuable when the artifact is a single document the skill can revise in place.

---

## Example 4: changelog-generator (CONVERTED skill, 4 phases + iterate)

**Note: this example was produced by running `eskill-maker` against an existing normal skill.** The source SKILL.md is bundled at `references/examples/changelog-generator-source.md` for reference. When the captured intent file says "converted from: ..." in its header (Phase 1's branch), apply the convert-path patterns from `references/conversion-guide.md` §4 + §5 instead of decomposing from scratch.

### Captured intent (excerpt)

> Scans Git history for commits within a time period or between versions, categorizes them into logical groups (features, improvements, bug fixes, breaking changes, security), translates technical commit messages into customer-friendly language, and formats them into a clean, structured changelog. The workflow follows: scan → categorize → translate → format. Two phases involve judgment-heavy decisions (categorization correctness, translation quality) that benefit from self-review or iteration.

The intent file's header reads `# Captured Intent (converted from .../changelog-generator)` — that header is the trigger to apply convert-path rules.

### Decomposition

| # | Phase id                   | Marker                   | Why this marker                                                                                                       |
|---|----------------------------|--------------------------|-----------------------------------------------------------------------------------------------------------------------|
| 1 | Scan Git History           | `n.phase: scan-git`      | "Run X script and report exit code" — `git log` output is machine-readable; only judgment is filter scope, gated via `ask` |
| 2 | Categorize Changes         | `s.phase: categorize`    | "Categorize by fixed taxonomy" — the rubric is a checklist (each commit has a category, no uncategorized items)        |
| 3 | Translate to User-Friendly | `m.phase: translate`     | "Translate technical → user-friendly" — explicitly called out in §5 as judgment-heavy with authorship bias risk        |
| 4 | Format Changelog           | `s.phase: format`        | "Write a document with sections A, B, C" — structural rubric (required sections, formatting consistency)               |
| 5 | Iterate                    | `m.phase: review-iterate`| Translation has authorship bias risk; if translate or format verification surfaces gaps, extend to re-run them         |

Marker mix: 1n / 2s / 2m. Description inherited verbatim from source (no rewording, no "Triggers:" prefix). Source had no bundled assets so §7 was vacuously satisfied. Smoke prompt for Phase 7 was lifted directly from the source's "How to Use" section.

### What this teaches

- **One-to-one source step → phase mapping is the default.** The source `changelog-generator` has 6 numbered steps in its "What This Skill Does" section. The decomposition consolidated these into 4 substantive phases by merging the natural pairs (filter+scan, format+follows-best-practices) per `conversion-guide.md` §4. Each substantive phase still produces one durable artifact.
- **Marker choice falls out of source verbs.** The §5 decision tree maps the source's own language directly: "scans" → `n.phase`, "categorizes" → `s.phase`, "translates" → `m.phase`, "formats" → `s.phase`. The model didn't have to invent rationale; the source already told it.
- **Iterate is appropriate when judgment phases dominate.** Two of four substantive phases are `m.phase`. If review surfaces a problem, re-running translate/format via `extend` is the natural loop. A pure-`n.phase` workflow rarely needs Iterate.
- **Description inheritance preserves tested triggering.** The source description has been hitting real prompts ("create release notes for version X", etc.); the converted skill carries those triggers forward unchanged. Phase 9 (Optimize Description) is default-skipped per `conversion-guide.md` §6.

---

## Common patterns and anti-patterns

### Patterns to apply

- **First phase is almost always n.phase: confirm-style.** Capture intent, get user sign-off, no machine verification.
- **A "draft" phase is usually s.phase.** The author has a structural rubric they can re-read against.
- **A "research" or "review" phase is usually m.phase.** Authorship bias is real; subagents catch it.
- **A "test" or "lint" phase is usually n.phase.** Script-driven verdicts are deterministic.
- **An "iterate" phase is m.phase.** Deciding what to re-run via `extend` is judgment.

### Anti-patterns to avoid

- **One mega-phase.** "Research + Decide + Write" as one phase loses the verify boundary between deciding and writing. Split it.
- **A verify-only phase.** Don't add a "Final Review" phase that just re-reads everything. Use `s.phase` or `m.phase` markers on the phases that need verification — the verify is built into each phase, not a separate one.
- **Forgetting `extend`.** Skills that need iteration but don't have an iterate phase end up requiring the user to manually re-run.
- **Forgetting `ask`.** Skills that don't teach the model when/how to use `ask` get the model writing questions in plain text without pausing the orchestrator — plugin re-prompts during what should be a wait.
- **Using `n.phase` on subjective work.** "Write the user-facing summary" should not be `n.phase` — there's no rubric, but there's plenty for a subagent to check (tone, completeness, accuracy). Default to `m.phase` when in doubt.
- **Re-authoring source structure during conversion.** The source author chose granularity that worked. Trust 1:1 mapping (one source step → one phase) unless `conversion-guide.md` §4 split-rationale applies. Decomposing a 6-step source into 9 phases means the model is inventing complexity that wasn't asked for; decomposing into 2 phases means the model is collapsing distinctions the source author drew on purpose. Apply the §4 split/merge rules honestly, not aspirationally.
- **Re-authoring the description during conversion.** Source descriptions have been triggering correctly in production. `conversion-guide.md` §6 requires verbatim inheritance and `lint_eskill.py --source-extract` enforces it. Adding "Triggers:" or "phase-by-phase" to the description regresses the carefully-tuned triggering.
