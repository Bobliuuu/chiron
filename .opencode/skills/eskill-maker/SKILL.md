---
name: eskill-maker
description: Build new Evolved Skills (E-skills) from scratch, convert normal skills to E-skills, edit existing E-skills (add/remove/rewrite phases, change the workflow), or improve existing E-skills. Use when the user wants to create a new skill that runs phase-by-phase with verification, asks for help authoring an E-skill, mentions converting a workflow into a structured skill, wants to modify an E-skill they already have, or wants to lint/review/smoke-test an E-skill they've drafted. Triggers on phrases like "make me a skill for X", "turn this workflow into a skill", "convert this skill to an E-skill", "edit my E-skill", "add a phase to X", "change how X works", "review my E-skill", "test my new skill", or any request to create or modify a phased skill that uses forced_todo.
evolved: true
---

# E-Skill Maker

An Evolved Skill for producing other E-skills that satisfy the E-skill contract (see `references/contract-summary.md` for the in-skill canonical version). Workflow: interview the user to capture intent, decompose the workflow into phases with marker choices, draft the SKILL.md and verification rubrics, review semantically with a subagent, lint mechanically, smoke-test end-to-end via `erun_eval.py`, then iterate on any gaps. Optionally optimizes the description and packages the result.

### CRITICAL RULE: Stop after every `forced_todo` call

After any `forced_todo` call, **end your turn immediately**. No further tool calls. No further text. The orchestrator (a plugin) replies with the next instruction; if you keep generating, you'll skip past verify prompts and produce thin work.

**If `forced_todo` returns an error**, re-read the error, fix your call shape, and retry. Do NOT abandon the orchestrator and proceed without it — every later phase depends on the roadmap state the orchestrator owns. Common shape errors: `phases` passed as a stringified JSON literal instead of a native array (use `phases: ["A", "B"]`, not `phases: "[\"A\", \"B\"]"`); phase id case mismatch; missing `skill_name` on `roadmap`.

### RUN MODES: interactive vs. smoke-driven

eskill-maker is invoked in one of two ways. Detection + behavior differs.

**Interactive mode (most common):** the user invokes eskill-maker by chat in their IDE. Your cwd is the project root (the directory containing `.opencode/`). There is NO pre-set workspace directory; you must establish one yourself in Phase 1 via `forced_todo ask` (see below). The user-supplied skill name typically lands in `.opencode/skills/<skill-name>/`, which is what you want — opencode discovers skills from the project's `.opencode/skills/` and the new skill becomes available to subsequent invocations.

**Smoke-driven mode:** eskill-maker itself is being run end-to-end via `erun_eval.py` against a pre-set workspace at `eskilldata/<skill>/smoke-test-N/outputs/`. Your cwd IS that workspace. Phase 1 should pick that workspace path automatically (recognize it via the `eskilldata/<skill>/smoke-test-N/outputs/` cwd shape).

**You decide once in Phase 1.** The workspace path you establish there is the durable artifact directory for THIS run — every later phase that references `<workspace>` MUST use the path Phase 1's progress-summary recorded. Do not re-resolve `<workspace>` per phase; that causes path drift across phases.

### Workspace continuity

Phase 1's progress-summary MUST include a top-line bullet of the form:

```
Workspace: <absolute or project-relative path>
```

Every phase that mentions `<workspace>` resolves it to that recorded path by reading the cumulative summary header. Do NOT invent a fresh `<workspace>` per phase; doing so produces path drift (intent.md in one folder, decomposition.md in another, etc.).

If you reach a phase and cannot find a `Workspace:` bullet in the cumulative summary, treat that as a missing-precondition bug — stop, call `forced_todo ask` to surface the gap to the user, and resume only once it's set.

### FIRST STEP: Declare your roadmap

Call `forced_todo` with action `roadmap`, naming the phases you'll run. Phase ids MUST match the headings below exactly (after stripping the `Phase N:` prefix — e.g., `## Phase 2: Decompose into Phases` → id `Decompose into Phases`).

```
forced_todo roadmap \
  --skill_name "eskill-maker" \
  --phases ["Capture Intent", "Decompose into Phases", "Draft SKILL.md", "Draft Verifications", "Semantic Review", "Lint", "Smoke Test", "Iterate"]
```

Pick a subset that matches the user's task:

- **"Build a new E-skill for X" / "Make me a skill that does Y"** → all eight core phases (Capture Intent through Iterate), optionally append `Optimize Description` and `Package`. **Smoke Test is ALWAYS in the roadmap** — Phase 7's body decides full vs. stub vs. skip-with-rationale at runtime; the phase itself is never omitted at roadmap-declaration time.
- **"Convert this normal skill to an E-skill"** → `["Read Source", "Capture Intent", "Decompose into Phases", "Draft SKILL.md", "Draft Verifications", "Semantic Review", "Lint", "Smoke Test", "Iterate"]`. Phase 0 (Read Source) extracts the source skill's structure, frontmatter, and bundled assets into `<workspace>/source-extract.md`; later phases branch on that file's existence to inherit instead of re-author. See `references/conversion-guide.md`.
- **"Edit/modify my existing E-skill" (add/remove/rewrite phases, change the workflow, tweak rubrics)** → `["Read Source", "Capture Intent", "Draft SKILL.md", "Draft Verifications", "Semantic Review", "Lint", "Smoke Test", "Iterate"]`. Insert `Decompose into Phases` after `Capture Intent` only when the change adds, removes, or reorders phases; skip it for content-only edits. Phase 0 detects the source is already an E-skill (`evolved: true` in its frontmatter) and records `**EDIT**` under `## Mode` in `source-extract.md`; later phases then edit the source folder in place instead of authoring a new skill.
- **"Review/lint/smoke-test my draft E-skill"** → `["Semantic Review", "Lint", "Smoke Test", "Iterate"]`. Skip the authoring phases when the SKILL.md and rubrics already exist.
- **"Just optimize my E-skill's description"** → `["Optimize Description"]`.
- **"Just package my E-skill"** → `["Package"]`.

If the user signals speed over rigor ("quick draft", "rough pass", "don't be thorough"), add `mode: "quick"` to the roadmap call — the orchestrator lightens per-phase verification. Default is full rigor; don't infer quick from urgency alone.

Then stop. The orchestrator sends the next instruction.

### How phases run

For each phase the orchestrator picks for you:

1. You receive a `[FORCED TODO] Act on phase: X` prompt with the phase content (and a recap of what earlier phases established). The prompt carries the authoritative summary-format spec — follow it.
2. You do the work.
3. You call `forced_todo progress --summary "<what you did>"` and stop.
4. If the phase needs verification, the orchestrator sends a verify prompt (also carrying the summary-format spec). Run the check (re-read your work or spawn a subagent), fix any gaps in the same turn, then call `forced_todo progress --summary "<final summary, including fixes>"` and stop.
5. The orchestrator advances to the next phase.

Summaries are durable — they become the cumulative context header for every later phase. Thin summaries break downstream phases (Phase 3 needs decisions from Phase 2; Phase 8 needs gap-info from Phases 5/6/7). Don't shortchange them.

### Asking the user a question

Any time you need clarification, write the question text in your reply (so the user sees it) and call:

```
forced_todo ask --question "<the question text>"
```

Stop. The user will reply. On the next turn, continue acting on the current phase using their answer, then call `forced_todo progress` when done.

### Re-running phases after fixes (only inside the Iterate phase)

If verification phases (Semantic Review / Lint / Smoke Test) surface real gaps, the Iterate phase appends re-runs of those phases to the end of the roadmap:

```
forced_todo extend --phases ["Semantic Review", "Lint", "Smoke Test", "Iterate"]
```

Pass the original phase ids as written in the SKILL.md. Original verified phases stay verified; re-runs inherit the original's content + rubric. Include `Iterate` itself in the list when continued iteration may still be needed — the loop runs only once otherwise.

---

## Phase 0: Read Source
<!-- n.phase: read-source -->

Included when converting an existing normal skill into an E-skill OR when editing an existing E-skill. Skip this phase entirely for fresh-skill builds — it is not in the default roadmap.

**STEP 0 — Establish workspace.** Same decision tree as Phase 1's STEP 0 (see preamble's "Workspace continuity" rule). If you are running interactively, you MUST `forced_todo ask` for the workspace path before reading the source — do not infer it from the user's initial message. Default-suggested: `eskilldata/<new-skill-name>/` (relative to your project root — wherever `.opencode/` lives). Record the chosen path; Phase 1's STEP 0 will reuse it.

If the user did not name a source skill path, ask for it with `forced_todo ask` before doing anything else.

Steps:

1. Read `<source>/SKILL.md`. Note the frontmatter (`name`, `description`, `allowed-tools`, any other keys), the body sections, any numbered steps, "When to use" / "When not to use" / examples blocks, and any bundled-asset references in the prose.
2. **Determine the mode.** If the source frontmatter contains `evolved: true`, this run is an EDIT of an existing E-skill, not a conversion — record `**EDIT**` under `## Mode` in the extract; otherwise record `**CONVERT**`. In EDIT mode: skip steps 4-6 below (the convert-vs-keep and single-vs-split rubrics don't apply — write `N/A (edit mode)` under both verdict headings), do NOT read the conversion guide, and additionally extract into the template's `## Phase table` section the source's phase list — one row per `## Phase N:` heading with its phase id, marker (`n`/`s`/`m`), and label — plus a `verifications/` file inventory.
3. List bundled assets at the source directory: `<source>/references/`, `<source>/scripts/`, `<source>/assets/`, `<source>/agents/`. Record file names and sizes.
4. (CONVERT mode only) Read `references/conversion-guide.md` end-to-end. The guide drives every later branch; later phases will reference specific sections (§3, §4, §5, §6, §7, §8) by number.
5. (CONVERT mode only) Apply the §2 ("Convert-vs-keep decision") rubric. If the source is one-shot / reference-card / declarative-only, recommend the user keep it as a normal skill and stop the roadmap here via `forced_todo ask` (let the user confirm the abort).
6. (CONVERT mode only) Apply the §1 ("Extraction checklist") rubric. If the source bundles multiple sub-workflows, ask the user via `forced_todo ask` which one to convert (or whether to split into multiple E-skills, in which case the user should re-invoke per workflow).
7. Save `<workspace>/source-extract.md` with the EXACT section headings below, in this order. Phase 3 and the lint script parse these headings — do NOT rename or restructure them.

```markdown
# Source Extraction

## Mode
**CONVERT** | **EDIT**

## Source path
<absolute path to source skill folder>

## Description (verbatim)
<paste the source frontmatter `description` field exactly as it appears, no quotes around it, no prefix, no reformatting>

## Frontmatter (other fields)
```yaml
name: <source name>
allowed-tools: ...
<any other frontmatter keys, but NOT description>
```

## Workflow steps
1. <source step 1>
2. <source step 2>
...

## Section structure
- <H2/H3 headings of source body>

## Trigger context
- <bullets from "When to use" / "Use This Skill" / similar>

## Documented triggers
- "<example prompt 1>"
- "<example prompt 2>"

## Bundled asset inventory
- <file>: <size>
(or "No bundled assets found." if none)

## Phase table
(EDIT mode only; otherwise "N/A (convert mode)")
| # | Phase id | Marker | Label |
|---|----------|--------|-------|

verifications/ inventory:
- <file>

## Convert-vs-keep verdict
**CONVERT** | **KEEP**

Rationale:
- <bullets>

## Single-vs-split verdict
**SINGLE** | **SPLIT**
```

Critical: the description must be copied verbatim under the `## Description (verbatim)` heading with NO quotes, NO prefix, NO reformatting. Phase 3 inherits it directly into the new frontmatter; the Phase 6 lint script parses this heading and compares byte-for-byte.

When done, call `forced_todo progress --summary "<MUST start with 'Workspace: <path>' bullet (so Phase 1+ can find artifacts), then bullets: mode (CONVERT or EDIT), source path, step count extracted (or phase count in EDIT mode), bundled assets inventory, convert-vs-keep verdict, single-vs-split verdict (both N/A in EDIT mode)>"`.

## Phase 1: Capture Intent
<!-- n.phase: intent -->

**STEP 0 — Establish the workspace path. Do this BEFORE any other Phase 1 work.**

The workspace is the directory where `intent.md`, `decomposition.md`, (optionally `source-extract.md` for conversions), and any other in-flight artifacts live for THIS run. Every later phase that references `<workspace>` will read the path you record here.

Decision tree:

1. **If your cwd matches `eskilldata/<skill>/smoke-test-N/outputs/` (smoke-driven mode under `erun_eval.py`):** the workspace is your cwd. No question needed. Record it and proceed.
2. **If you are running interactively (cwd is the project root, no pre-set workspace): you MUST call `forced_todo ask` for the workspace path.** Not optional. Do NOT infer or assume a workspace from the user's initial message, however detailed that message is — the ask is what gives the user their one chance to override the default and puts the choice in the audit trail. Ask:

   > Where should I save this run's working artifacts (intent.md, decomposition.md)? Suggested: `eskilldata/<skill-name>/` (relative to your project root — wherever `.opencode/` lives). Reply "default" to accept, or paste an alternative path.

   Wait for the user's reply, then create the directory if it doesn't exist. The suggested path is project-relative; resolve to absolute at invocation time (e.g., `realpath eskilldata/<skill-name>/`) rather than baking in any user's home directory.
3. **If a prior phase already recorded a `Workspace:` bullet in the cumulative summary header** (e.g., Phase 0 / Read Source ran first in a conversion): reuse that path verbatim. Do NOT pick a different one.

Once established, the path is durable for the entire run. Phase 1's progress-summary MUST include `Workspace: <path>` as the first bullet (per the preamble's "Workspace continuity" rule).

---

If `<workspace>/source-extract.md` exists and records `**EDIT**` under `## Mode`: do NOT run the fresh-build interview and do NOT follow the conversion guide. Instead capture a change spec. Ask the user via `forced_todo ask` (unless their initial message already states all of this precisely): exactly what should change, which phases are affected, whether the phase structure changes (add/remove/reorder — this decides whether `Decompose into Phases` belongs in the roadmap), whether the frontmatter `description` changes, and what must stay untouched. Save `<workspace>/intent.md` with a `## Change spec` section: bulleted change list, affected phase ids (matched against the extract's `## Phase table`), structure-change yes/no, description-change yes/no, and an untouched-invariants list. Then skip the rest of this phase's interview content.

Otherwise, if `<workspace>/source-extract.md` exists (CONVERT mode), follow `references/conversion-guide.md` §3 ("Mapping source-extract to intent.md") instead of running the interview. The guide specifies which intent fields are inherited from the extract and which still need a `forced_todo ask`.

Otherwise (fresh-skill build): interview the user to capture a clear, concrete spec for the E-skill they want. The output of this phase is what every later phase plans against.

Ask (or extract from the conversation if the user already said it):

1. **What workflow does this skill capture?** Walk through the steps a person would follow without the skill — what do they do, in what order, what tools/decisions are involved? Be concrete: "research libraries, compare two, pick one, write code, write tests" not "build something".
2. **When should the skill trigger?** What user phrases or contexts should invoke it? Aim for 3-5 example trigger phrases.
3. **What's the output?** A single document? Working code? Data extraction? A conversation that ends with a decision? Knowing the artifact shape drives later marker choices.
4. **Are there input files, external dependencies, or scripts to bundle?** If the skill needs reference files, scripts, or templates, list them now.
5. **Does the workflow have natural verification checkpoints?** "After research, the user should sign off on the approach." "After writing code, run the linter." These hint at where `s.phase`/`m.phase` markers belong.
6. **Is iteration likely?** Will verification probably surface gaps that need fixing and re-running? (Most skills that produce a single artifact: yes. One-shot extraction skills: maybe not.)

Save the captured spec to `<workspace>/intent.md`. Use a template like:

```markdown
# Captured Intent

## What the skill does
[1-2 paragraphs]

## Trigger phrases
- "..."
- "..."

## Output shape
[document / code / data / conversation]

## Inputs and bundled resources
- ...

## Natural verification checkpoints
- ...

## Iteration shape
[likely needed / probably one-shot]
```

If you find yourself making assumptions to fill gaps, use `forced_todo ask` to confirm with the user. Better to ask one clarifying question than write a 10-phase decomposition for the wrong skill.

When done, call `forced_todo progress --summary "<MUST start with 'Workspace: <path>' bullet, then bullets covering the captured intent: name of skill, primary artifact, key trigger phrases, any non-obvious constraints>"`. The Workspace bullet is the durable signal every later phase relies on; do not omit it.

## Phase 2: Decompose into Phases
<!-- m.phase: decompose -->

If `<workspace>/source-extract.md` records `**EDIT**` under `## Mode`: this phase is in the roadmap only because the change spec says the phase structure changes. Seed the decomposition from the extract's `## Phase table` — the table you produce lists the FULL post-edit phase list, with each row tagged ADDED / CHANGED / UNCHANGED / REMOVED in the Produces column's first word. Marker/label/rationale work applies only to ADDED and CHANGED rows; UNCHANGED rows inherit the source's marker and label verbatim. Skip the conversion-guide reading below.

Otherwise, if `<workspace>/source-extract.md` exists (CONVERT mode), the source's numbered steps are the seed for decomposition. Read `references/conversion-guide.md` §4 ("Steps-to-phases mapping rules") and §5 ("Marker decision tree") before proposing the decomposition table. Source steps map 1:1 to phases by default; merge tightly coupled steps and split steps that combine producing-an-artifact with critiquing-an-artifact.

Read `<workspace>/intent.md`. Then read `references/decomposition-examples.md` for three worked examples (plan-architect, eskill-maker itself, hypothetical mcp-builder) and the patterns/anti-patterns at the bottom.

Propose a phase decomposition. For each phase:

- **Phase id** — the name that will appear after `## Phase N: ` in the SKILL.md. Should read well as a verb-or-noun phrase ("Research", "Write the Implementation Plan"), not as a position ("Step 2", "Phase B").
- **Marker choice** — `n.phase` for capture-and-confirm or script-driven phases; `s.phase` for structural rubrics the author can grade by re-reading their own work; `m.phase` for judgment-heavy work where authorship bias is real. **Markers are a turn budget:** `n` adds 0 extra LLM turns, `s` adds 1, `m` adds 2 (one of them an entire subagent session). Default to `n` unless the phase's output genuinely needs grading; the "Rationale per marker choice" section must justify every `s`/`m` by saying why the lighter marker is insufficient. A skill that marks most phases `m` is usually buying rigor it doesn't need at 2 turns per phase.
- **Label** — kebab-case, no spaces, no `>`. Used as the filename for `verifications/<label>.md` if the marker is `s.phase` or `m.phase`. Should describe the phase's job ("research", "review-semantic"), not its position.
- **What this phase produces** — one durable, namable artifact. The summary should be able to say "I produced X" or "I decided Y" without ambiguity.

**Artifact persistence — every cross-phase data dependency goes through a file.** The orchestrator prunes a phase's full conversation once that phase verifies; the only thing a later phase inherits is each prior phase's 1-4 bullet progress *summary*. So any content a later phase must CONSUME — not merely be aware of — has to be written to a file (in the workspace, or the skill's output directory) by the producing phase and explicitly re-read by the consuming phase. The progress summary carries the file *path*, never the content. As you draw the decomposition, for every phase pair where a later phase uses what an earlier one produced, confirm the earlier phase persists it to a named file. A phase that "passes work forward" only through its summary is a bug — the work will be gone by the time the consumer runs.

Decisions to surface explicitly:

- Does the skill need an Iterate phase? (Use the `extend` action to re-run earlier phases.) Yes if verification could plausibly fail and require fixes; no if the artifacts are one-shot.
- Are any phases optional (selected only via roadmap subset)? Common examples: optimize description, package, advanced/conditional flows.
- Phase ordering: walk the list top-to-bottom and confirm each phase has what it needs from earlier phases.

Save the decomposition to `<workspace>/decomposition.md`:

```markdown
# Phase Decomposition

## Skill: <skill-name>

| # | Phase id | Marker | Label | Produces | Persisted to |
|---|----------|--------|-------|----------|--------------|
| 1 | ... | n.phase | ... | ... | <workspace>/<file> |
| 2 | ... | m.phase | ... | ... | ... |

## Cross-phase artifacts
- <producer phase> writes <artifact> to <path> → read by <consumer phase>
- (every later phase that consumes earlier content must have a row here; if there are none, state "no cross-phase file dependencies")

## Rationale per marker choice
- Phase N: chose <marker> because ...

## Optional phases
- Phase X is optional; included only when the user task is ...

## Iterate strategy
- [included with rationale, OR omitted with rationale]
```

When done, call `forced_todo progress --summary "<bullets: phase count, marker mix (n/s/m counts), key structural choices, whether iterate is included>"`.

## Phase 3: Draft SKILL.md
<!-- s.phase: draft-skill -->

If `<workspace>/source-extract.md` records `**EDIT**` under `## Mode`, this phase EDITS the source skill folder in place. HARD rules:

- **No new folder.** Work at the source path recorded in `source-extract.md`. Step 1 below (create the skill folder) does NOT apply.
- **Touch only what the change spec names.** Read `<workspace>/intent.md`'s `## Change spec`. Phases, preamble sections, and frontmatter fields outside the spec stay byte-for-byte untouched — make targeted edits, never a full-file rewrite.
- **Description changes only if the change spec says so.** The conversion description-inheritance rule below does NOT apply.
- **Phase ids stay stable** unless the spec renames them. Any rename or add/remove MUST also update the source SKILL.md's own FIRST STEP example roadmap subsets so they still match the headings exactly.
- **New/changed phases get marker comments** per the decomposition table (or, if `Decompose into Phases` was skipped, per the change spec).
- The conversion rules below (description inheritance, asset copying) apply to CONVERT mode only.

Otherwise, if `<workspace>/source-extract.md` exists (CONVERT mode), the following conversion rules are HARD requirements (not "consider this", not "if appropriate"):

- **Description inheritance — verbatim, byte-for-byte.** Copy the text under the `## Description (verbatim)` heading in `source-extract.md` directly into the new SKILL.md frontmatter `description` field. Do NOT reword. Do NOT prepend "Triggers:" or any other prefix. Do NOT shorten or paraphrase. Do NOT restructure the sentences. Phase 6 (Lint) will run `lint_eskill.py --source-extract <workspace>/source-extract.md <new-skill-path>`; mismatched descriptions fail lint. See `references/conversion-guide.md` §6 for rationale.
- **Asset preservation.** Copy `<source>/references/`, `<source>/scripts/`, `<source>/assets/`, `<source>/agents/` into the new skill folder verbatim per `references/conversion-guide.md` §7.
- **Phase content authoring.** Compress source step prose into self-contained phase content; rewrite any "the next step" / "step 2" cross-references to phase ids.

Read `<workspace>/decomposition.md` (always). Then **read `references/preamble-template.md`** — required for every fresh-build to copy the preamble structure verbatim.

The other reference files are loaded ON DEMAND, not preloaded — preloading bloats the single turn and triggers chat-client cutoffs:

- `references/contract-summary.md` — read only if you hit a structural question the preamble template doesn't answer (e.g., uncertain whether a phase needs a marker, or what the runtime does with `n.phase` vs `s.phase` vs `m.phase`).
- `references/decomposition-examples.md` — already read in Phase 2; do not re-read here unless the decomposition table is ambiguous.
- `references/conversion-guide.md` — read only when `<workspace>/source-extract.md` exists (convert path).

Steps:

1. **Create the skill folder** at `.opencode/skills/<skill-name>/`. The folder name MUST match the frontmatter `name` you'll write — anything else fails lint.
2. **Frontmatter:** fill in `name`, `description`, `evolved: true`. The description should be "pushy" — describe what AND when, including 2-3 trigger phrases the user might type without naming the skill explicitly. The model defaults to undertriggering skills; combat that. No angle brackets in the description — write `{category}` not `<category>` for placeholders (`lint_eskill.py` errors on `<`/`>`).
3. **Paste the preamble template** (the template's `<<<placeholders>>>` are filled with concrete values from the decomposition). The five preamble sections (CRITICAL RULE, FIRST STEP, How phases run, Asking the user a question, Re-running phases after fixes) MUST be at `###`, not `##` — at `##` they'd be parsed as phantom phases by the runtime. Skip the "Re-running phases after fixes" section entirely if the decomposition has no Iterate phase.
4. **FIRST STEP examples** — provide at least three example phase subsets matching common task shapes (full run, partial run, narrow scope). The examples teach the model how to map a user task to a roadmap call.
5. **Phase bodies** — one `## Phase N: <id>` per phase from the decomposition, each followed immediately by its marker comment. Body content is the model's instructional prose for that phase. Aim for 30-100 lines per phase. Make each phase self-contained: the model receives only this phase's content + a cumulative summary header from prior phases, so context the phase needs must be in the phase content (or in a `references/` file the phase explicitly tells the model to read). Self-contained means self-contained **for acting** — the grading key is not part of it (see step 8).
6. **Cross-phase data handoff goes through files.** The cumulative summary header carries only each prior phase's 1-4 bullet summary, and the orchestrator prunes a phase's full conversation once it verifies. So if a phase produces content a later phase must consume (research findings, an extracted spec, a draft, aggregated data), the producing phase's body MUST include a step that writes that content to a named file (workspace or output directory), and the consuming phase's body MUST include a step that reads that file. The progress summary passes the file path, never the content. Never author a phase that says "use the findings from the previous phase" with no file behind it — after the prune, those findings are gone. (Cross-check the `decomposition.md` "Cross-phase artifacts" list from Phase 2: every row there needs a write step in the producer phase body and a read step in the consumer phase body.)
7. **Critical constraints at phase edges.** Within each phase body, hard rules (must/must-not, security/safety, output paths) belong at the top or bottom — the same lost-in-the-middle problem we're combating at the skill level applies inside phases.
8. **No verification content in act bodies.** Success criteria, checklists for grading the finished work, and instructions for reacting to verification findings belong in `verifications/<label>.md` — the runtime delivers them to the model in the verify prompt, after acting. Never write them into an `s`/`m` phase body: a model that grades its own work during act treats the real verify turn as redundant, narrates instead of calling `forced_todo progress`, and the phase stalls. Do not preview the rubric in the body either ("the verifier will check X") — the act prompt carries the work, the verify prompt the check. `lint_eskill.py` errors on these patterns in `s`/`m` phase bodies.

When done acting (first progress call), call `forced_todo progress --summary "<bullets: SKILL.md path written, preamble sections included, phase count, any gotchas (e.g., paths the model must use, references it must read)>"`.

## Phase 4: Draft Verifications
<!-- s.phase: draft-rubrics -->

For each phase in the new SKILL.md whose marker is `s.phase` or `m.phase` and has a label, write the corresponding `verifications/<label>.md` file.

**EDIT mode** (when `<workspace>/source-extract.md` records `**EDIT**` under `## Mode`): write or update rubrics only for phases the change spec added or changed; leave every other rubric file byte-for-byte untouched. If a removed phase leaves an orphaned `verifications/<label>.md` no remaining phase references, delete it.

Reference: `references/examples/plan-architect/verifications/` (bundled inside this skill) has four canonical examples (`research.md`, `options.md`, `write.md`, `review.md`). Each is 25-40 lines, structured as: brief framing paragraph → "Check each, in order:" → numbered checks → "Return one of: PASS ... / FAIL ...".

Per file:

- **Numbered checks**, each describing what evidence makes it PASS and what makes it FAIL. Avoid "the work is good" — use specific, testable criteria like "every significant decision has a cost-benefit analysis with explicit costs, benefits, risks, and rationale".
- **PASS output spec** — what the summary must contain. Not just "PASS" but "PASS, followed by a one-paragraph summary of [specific information]". This drives the model toward summaries that carry the right information forward.
- **FAIL output spec** — actionable gaps. "Compare option Y against the chosen X using the same cost/benefit/risk frame" passes; "more research needed" fails.
- **`m.phase` rubrics MUST be self-contained.** A subagent receives only the verify prompt + the rubric body — no parent skill state, no other files. Re-read each `m.phase` rubric pretending you have nothing else; if it references "see the SKILL.md" or "check the prior phase", the subagent can't follow.
- **Fix-loop rubrics** (e.g., for `lint`-style phases that should keep re-running until a script passes) must say "PASS only when the most recent script invocation in this turn exited 0".

When done (first progress), call `forced_todo progress --summary "<bullets: which rubric files were created, which phases fall back to phase-content (no override), any rubric you intentionally left thin>"`.

## Phase 5: Semantic Review
<!-- n.phase: review-semantic -->

The lint script catches mechanical violations; this phase catches what lint can't — prose intent, structural soundness, contract-teaching quality. Authorship bias is real: the same model that wrote the skill reads its own work generously, so verification IS the act here. Spawn a subagent and let its verdict drive the outcome.

**Hard rules (at top):**
- Verification IS this phase's act. Do NOT also do a separate self-review beforehand — the subagent is the check.
- Max 3 subagent spawns per phase invocation. If you can't converge in 3, surface via `forced_todo ask`.

Procedure:

1. Spawn a subagent (Task tool) to run an independent semantic review. Pass it:
   - The path to the new skill folder.
   - The captured intent from Phase 1 (`<workspace>/intent.md`).
   - The rubric file path: `.opencode/skills/eskill-maker/verifications/review-semantic.md` (project-relative — the subagent's cwd is the project root, so a bare `verifications/...` path would not resolve; the subagent reads the file directly).
   - An explicit instruction to **read everything up front in one batch** (rubric + intent.md + the skill folder's SKILL.md and every `verifications/*.md`, in parallel where the tools allow) before starting the checks — not one file per turn. Reading serially multiplies the subagent's turn count for no accuracy gain.
2. Subagent returns PASS or FAIL.
3. If FAIL: address each gap in the SKILL.md or the rubric files in this same turn, then re-spawn for a **delta re-review**: pass the previous spawn's FAIL list and instruct the subagent to verify ONLY (a) the previously-failed checks and (b) any check whose subject a fix touched (name the edited files). Earlier PASS results stand; do not re-run the full rubric. Full-rubric review is for the first spawn only.
4. Loop until PASS or 3 spawns reached.
5. If 3 spawns reached without PASS: call `forced_todo ask` with the latest FAIL gaps and the user decides how to proceed (continue iterating manually, accept gaps, abort).

The subagent reads the rubric file directly — do NOT restate or summarize its checks here or in your prompt to the subagent. The rubric file is the single source of truth; a restated list silently drifts as the rubric evolves.

Call `forced_todo progress --summary "<bullets: final subagent verdict (PASS / FAIL-surfaced-to-user), spawn count, gaps surfaced and how addressed, standout strengths the subagent named>"`. This phase is `n.phase` — the progress call auto-verifies and the roadmap advances.

## Phase 6: Lint
<!-- n.phase: lint -->

**Hard rules (at top):**
- Do NOT call `forced_todo progress` until the most recent lint invocation in this turn exited 0. Lint exit code IS the verdict for this phase.
- Max 5 fix-and-re-run loops per phase invocation. If you can't converge in 5, surface via `forced_todo ask` with the latest `ERROR:` lines.

Run the lint script with the new skill folder as the path:

```bash
python .opencode/skills/eskill-maker/scripts/lint_eskill.py <skill-path>
```

**For conversions only (NOT edits):** also pass `--source-extract <workspace>/source-extract.md` to enforce description inheritance. In EDIT mode, omit the flag — an edit may legitimately change the description, and the byte-for-byte check would false-fail:

```bash
python .opencode/skills/eskill-maker/scripts/lint_eskill.py <skill-path> --source-extract <workspace>/source-extract.md
```

This adds one check: the new skill's frontmatter `description` must equal the source-extract's `## Description (verbatim)` field byte-for-byte. If you see `ERROR: Description mismatch ...`, edit the new SKILL.md frontmatter to copy the source description exactly (no rewording, no prefix), then re-run lint.

(Use the absolute or project-relative path to the script — your cwd may not have `scripts/` as a subdirectory.) Read the output.

If the script exits 0:
- Note the count of `INFO:` advisories (phantom-phase notes for non-`Phase N:` `##` headings — these don't fail lint and are usually intentional documentation).
- Call `forced_todo progress` with the summary spec below.

If the script exits non-zero:
- Read every `ERROR:` line. Common errors and fixes:
  - **Folder/name mismatch** → fix the frontmatter `name` to match the directory.
  - **Phase has no marker** → add `<!-- [nsm].phase: <label> -->` after the `## Phase N: ...` heading.
  - **Marker label has spaces** → replace spaces with hyphens (`refactor-auth`, not `refactor auth`).
  - **Override file empty** → fill it with rubric content, or delete it (runtime falls through to phase-content fallback).
  - **Duplicate phase id** → rename one of the duplicates.
  - **`Phase N:`-style heading inside a fenced code block** → demote to `### Phase N:` inside the fence, or change to a non-Phase-N heading.
- Apply fixes. Re-run lint.
- Iterate until exit 0 (max 5 loops). The smoke test will catch lint-passing skills that have real bugs anyway, so don't paper over genuine errors.

When done, call `forced_todo progress --summary "<bullets: final lint exit code (MUST be 0 — if not, you should have called ask instead), count of INFO advisories, fix-loops needed, categories of errors that surfaced>"`. This phase is `n.phase` — the progress call auto-verifies and the roadmap advances.

## Phase 7: Smoke Test
<!-- n.phase: smoke -->

**HARD RULE — Phase 7 must always be declared in the initial `roadmap` call.** Do NOT omit it during roadmap declaration on the theory that "the skill probably can't be smoke-tested anyway." The skip-vs-stub-vs-full decision belongs HERE, in this phase's body, not at roadmap-declaration time. Reasons:

- The skip decision is visible + auditable in the cumulative summary header (downstream phases see WHY the skill was not smoked).
- Phase 8 (Iterate) retains the option to `extend ["Smoke Test", "Iterate"]` if downstream gaps suggest the skip rationale was wrong, OR to add a Smoke Test re-run after fixing what made smoke impractical originally.
- Tooling (lint, future audits) sees a complete roadmap with all eight default phases, not a truncated one that needs interpretation.

**STEP 0 — When the orchestrator advances to this phase, decide: full smoke / stub-smoke / skip-with-rationale.**

**Smoke-running detection:** If your cwd matches `eskilldata/<skill>/smoke-test-N/outputs/` (you are running inside a smoke subprocess), stub or skip this phase immediately. Do NOT spawn a nested smoke run — recursive smoke is prohibited. Call `forced_todo progress --summary "Smoke stubbed: eskill-maker is running under smoke; recursive smoke calls are forbidden"` and proceed.

Otherwise, proceed with the decision tree:

Smoke runs `erun_eval.py` which spawns a fresh `opencode run` subprocess. Full smoke works cleanly for skills with deterministic, self-contained workflows. It causes problems for skills that:

1. **Are non-deterministic** (depend on web search, external APIs, timestamps, random data). Smoke runs may pass once and fail the next, or fail in a way that's not the skill's fault.
2. **Spawn their own subagents** with verify loops. The smoke subprocess's m.phase verifies + the skill's internal subagents = recursive opencode-in-opencode + multi-level subagent recursion. Heavy. Often times out. May hit recursion limits.
3. **Require network access or external services** that the smoke subprocess may not have.
4. **Have "loop until pass" patterns** with no iteration cap. Subagent never converges → smoke subprocess never exits → erun_eval times out.

If any of (1)-(4) apply to the skill produced in Phase 3, **do NOT run a full E2E smoke**. Pick one of these alternatives:

- **A. Stub-smoke** — write a minimal eval prompt that exercises only the skill's orchestration (Phase 1 / Phase 2 setup), not the full workflow. Smoke proves the roadmap fires and `forced_todo` plumbing works; it doesn't try to validate the workflow output. Eval-prompt example: *"Use the `<skill-name>` skill. For Phase 1, save a placeholder intent.md with just the workspace path and the trigger phrases. Stop after Phase 1's progress call."* This is a partial roadmap subset (set in your `--eval-prompt`). Run `erun_eval.py` against this stub prompt; it should pass. Record exit code in the progress summary.
- **B. Skip-with-rationale** — DO NOT run `erun_eval.py`. Call `forced_todo progress --summary "Smoke skipped: <skill-name> is non-deterministic / network-bound / spawns recursive subagents. Risk: <specific risk>. Manual user verification recommended via the trigger phrases in intent.md."`. Phase 7 is `n.phase` so the progress call auto-verifies. Phase 8 will see the skip and not try to re-extend Smoke Test reflexively (per Phase 8's body).

The phase REMAINS declared in the roadmap regardless of which alternative you pick. Don't try to be clever and remove it from the roadmap — that breaks Phase 8's ability to extend with Smoke Test if circumstances change.

**If the skill IS amenable to a full smoke**, proceed with the standard run:

Run the new skill end-to-end via `erun_eval.py`:

```bash
python .opencode/skills/eskill-maker/scripts/erun_eval.py \
  --skill .opencode/skills/<skill-name> \
  --workspace eskilldata/<skill-name>/ \
  --eval-prompt "<a representative prompt that triggers this skill>"
```

erun_eval.py will create `smoke-test-N/outputs/` under the workspace dir, copy the skill's `.opencode/` into it, and run the subprocess there. The subprocess is isolated from the project root's full skill library.

If `<workspace>/source-extract.md` exists in CONVERT mode, follow `references/conversion-guide.md` §8 (worked example) for smoke-prompt construction — prefer a prompt taken from the source skill's documented example triggers (recorded in `source-extract.md`). Round-trip preservation (same triggers should produce equivalent outcomes) is the strongest smoke signal for a conversion.

In EDIT mode, aim the eval prompt at the changed phase(s): pick a prompt (or explicit roadmap subset in the prompt) that actually reaches the phases the change spec touched. A full run that never exercises the edit proves nothing; the STEP 0 stub/skip decision tree above still applies.

**Critical eval-prompt guidance** (these traps cost real time during development):

- **Bias toward the new skill explicitly.** Skill selection is non-deterministic when multiple skills' descriptions match. Phrase the prompt as "Use the `<skill-name>` skill to ..." or "I want to use `<skill-name>` for ...". Bare task phrasing might pick a sibling skill.
- **Don't write to `/tmp` or other external paths.** OpenCode's permission system auto-rejects writes outside the workspace. Tell the model to write to a relative path (lands in the model's cwd, which is the workspace's `outputs/`) or to an absolute path inside the workspace.
- **Outputs go inside `smoke-test-N/outputs/` alongside trace/report.** The skill's artifact files (brief.md, etc.) land alongside trace.jsonl and grading.json in the same directory.

If `erun_eval.py` exits 0: the skill ran end-to-end, all phases reached `verified`, and the trace shows clean orchestration. Read the report and the trace to spot-check that the skill actually did what it should.

If `erun_eval.py` exits non-zero: read the report at `<smoke-test-dir>/outputs/report.json` for the orchestration verdict. Common failure modes:
- `all_phases_verified=false` with low transitions count → the model didn't follow through on the roadmap. Probably needs preamble strengthening or clearer phase content.
- `clean_termination=false` with `awaiting_user_reply=true` → the skill called `ask` and the script's intervention didn't unblock it. Either the ask is genuinely impossible to auto-resolve, or the prompt-for-assumption isn't working.
- `excessive_asks=true` (>5 asks per run) → the skill needs too much clarification; tighten phase content or add more guidance.
- Plain timeout → the model got stuck. Read the trace to see where.

The verify rubric for this phase is the script's exit code. There's no separate `verifications/smoke.md` — `n.phase` markers don't use override files. PASS = exit 0; FAIL = anything else.

When done, call `forced_todo progress --summary "<bullets: erun_eval exit code, smoke dir used, phase transition counts, any orchestration anomalies, the eval prompt used>"`.

## Phase 8: Iterate
<!-- s.phase: iterate -->

Read the prior phase summaries (Semantic Review, Lint, Smoke Test) from the cumulative context header. Identify any unresolved gaps.

Three possible outcomes:

**A. No real gaps.** All three verifications passed cleanly. The skill is ready. Call `forced_todo progress --summary "no further iteration needed; all verifications passed; skill is ready"` and DO NOT call `extend`. Iterate verifies and the roadmap completes (advancing to optional Optimize Description / Package phases if they were included in the original roadmap).

**B. Gaps exist; fixable in one round.** Apply fixes to the skill files in this same turn, then call:
```
forced_todo extend --phases ["<phases to re-run>", "Iterate"]
```
Choose the re-run list based on what changed:
- Fixed prose/structural issues → at minimum `Semantic Review`, plus anything that depends on it (`Lint`, `Smoke Test`).
- Fixed mechanical issues → at minimum `Lint`, plus anything that depends on lint (`Smoke Test`).
- Fixed orchestration issues → `Smoke Test` (and probably `Iterate` again if you suspect more iterations may be needed).
Always include `Iterate` if there's any chance the re-runs surface new gaps.

**C. Gaps exist; you don't yet know how to fix.** Use `forced_todo ask` to surface the question to the user. Don't extend without a fix in hand.

The order in the extend list matters — must be dependency-correct: Semantic Review before Lint before Smoke Test.

When acting is done, call `forced_todo progress --summary "<MUST start with one bullet stating WHY you're extending (or why not), since the user sees only summaries and 're-running phases' looks like a bug without rationale. Example: 'Extending [Semantic Review, Lint, Smoke Test, Iterate] because Phase 5 semantic review surfaced a gap in Phase 3's description quality; fixed in this turn, re-running to confirm.' Then bullets: gaps identified, fixes applied (with file paths), extend list issued (or 'no extend; skill ready'), whether iterate is set to fire again>"`.

If you decided to skip Smoke Test (per Phase 7's STEP 0) and a downstream gap surfaces that COULD have been caught by smoke: do NOT add Smoke Test back into the extend list reflexively. Re-state the rationale for skipping; if the rationale no longer holds, surface that to the user via `forced_todo ask` before changing course.

## Phase 9: Optimize Description
<!-- n.phase: optimize -->

(Optional. Include in the roadmap only if the user explicitly asks to optimize, or if iterate completed without surfacing description-quality concerns and the user wants the polish.)

**Default-skip for conversions and edits.** If `<workspace>/source-extract.md` exists, the source description has been triggering correctly in production; re-optimizing risks regressing on phrases the user has not yet thought to test. Exception: in EDIT mode where the change spec itself changed the description, optimization is reasonable if the user asks. Otherwise run this phase on a converted or edited skill only when the user explicitly asks AND the skill has stabilized in real use. See `references/conversion-guide.md` §6 for the rationale.

Run the existing skill-creator description optimizer:

```bash
python .opencode/skills/eskill-maker/scripts/run_loop.py \
  --skill-path .opencode/skills/<skill-name> \
  --eval-set <path-to-trigger-eval-set.json> \
  --max-iterations 5
```

Before running, the user needs a trigger eval set — ~20 query+expected-trigger pairs. If they don't have one, generate it and review with the user before kicking off the optimization:

- 8-10 **should-trigger** queries: varied phrasings, at least half NOT naming the skill explicitly (paraphrases, task descriptions, indirect asks).
- 8-10 **should-not-trigger** queries: near-misses inside the skill's domain (adjacent tasks a sibling skill should handle, or one-shot requests too small for the skill).

Save the set as JSON per [references/schemas.md](references/schemas.md) and confirm the mix with the user — a set of only easy positives inflates the score without improving real triggering.

When done, call `forced_todo progress --summary "<bullets: best description chosen, before/after triggering scores, applied to SKILL.md frontmatter>"`.

## Phase 10: Package
<!-- n.phase: package -->

(Optional. Include in the roadmap only if the user wants the skill bundled as a `.skill` file for distribution.)

Run:

```bash
python .opencode/skills/eskill-maker/scripts/package_skill.py .opencode/skills/<skill-name>
```

The script bundles the skill folder into a `.skill` archive. Verify it includes `verifications/` and `references/` subdirectories alongside `SKILL.md` — the package script handles standard subdirectories but it's worth checking the resulting archive's file list.

When done, call `forced_todo progress --summary "<bullets: package path, archive contents verified, any directories that needed manual inclusion>"`.

---

### Output format

When the user asks for a new E-skill, the deliverable is a complete `.opencode/skills/<skill-name>/` folder containing:
- `SKILL.md` — frontmatter + preamble + phases.
- `verifications/<label>.md` — one per labeled `s.phase` / `m.phase`.
- `references/` — optional reference material the skill's phases load on demand.
- `assets/`, `scripts/` — optional, free-form.
- A passing smoke test report at `eskilldata/<skill-name>/smoke-test-N/` (next sequential N).

If Phase 9 ran, the frontmatter description has been optimized. If Phase 10 ran, a `.skill` archive exists at the path the package script reported.

### When to push back

The skill should trigger liberally for any "make a skill" / "build a skill" / "review my skill" request, but push back when:

- **The user's workflow is one-shot.** If there's no plausible decomposition into 3+ phases (the workflow is "do this single thing"), an E-skill adds overhead without benefit. Suggest a normal skill via `skill-creator` instead.
- **The user wants to skip Phase 1 (Capture Intent) on a vague request.** A 2-minute clarifying conversation prevents 30 minutes of wasted decomposition on the wrong target. Use `ask`.
- **An "edit" that rewrites most phases is a rebuild.** If the change spec touches the majority of the source E-skill's phases or replaces its core workflow, the edit path's touch-only-what's-named discipline stops protecting anything. Recommend running the full fresh-build roadmap instead (using the existing skill as reference), and let the user confirm via `ask`.
- **The user asks to skip Smoke Test on a non-trivial skill.** The smoke test is what catches the orchestration bugs lint and semantic review can't. Push back unless the skill is so simple that a smoke run won't tell you anything, OR it falls under Phase 7's STEP 0 skip criteria (non-deterministic / network-bound / recursive-subagents). In those cases, smoke is genuinely impractical and a stub-smoke or skip-with-rationale is the right answer.
- **The user wants you to run E-skill phases in parallel or out of order.** The orchestrator runs them in order via `roadmap` and `extend`; respect that. Don't try to be clever with subagents that pre-compute later phases.
- **The skill the user is asking for is non-deterministic, network-bound, or spawns its own subagents in a loop.** Don't refuse — but flag at Phase 1 (Capture Intent) that Phase 7 (Smoke Test) will fall back to stub-smoke or skip-with-rationale (per Phase 7's STEP 0). The user should know up-front that smoke evidence will be partial.
- **The skill design has a "loop until pass" verify pattern with no iteration cap.** Every produced skill that uses this pattern MUST also specify a max-iteration count and a `forced_todo ask` user-escalation fallback. Phase 5 (Semantic Review) checks for this. Don't draft a skill that infinite-loops.

In general, it's better to ask one clarifying question than to produce a 10-phase E-skill for the wrong workflow.

### References

- [references/contract-summary.md](references/contract-summary.md) — condensed E-skill contract (what the runtime expects of every E-skill). Read in Phases 3 and 4.
- [references/preamble-template.md](references/preamble-template.md) — boilerplate every E-skill SKILL.md should open with, with `<<<placeholders>>>` to fill. Read in Phase 3.
- [references/decomposition-examples.md](references/decomposition-examples.md) — three worked phase decompositions plus patterns/anti-patterns. Read in Phase 2.
- [references/conversion-guide.md](references/conversion-guide.md) — extraction checklist, mapping rules, marker decision tree, and worked example for converting a normal skill to an E-skill. Read in Phase 0; consulted from Phases 1, 2, 3, 7.
- [references/schemas.md](references/schemas.md) — JSON shapes for evals, grading, benchmarks, etc. Inherited from skill-creator; useful when the user wants quantitative evals.
- `references/examples/plan-architect/` — canonical example of a working E-skill, bundled inside this skill. Read its `SKILL.md` and `verifications/*.md` when you need a concrete reference.
