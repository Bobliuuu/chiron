# Normal-skill → E-skill conversion guide

Reference loaded by `eskill-maker` during a conversion roadmap. Phase 0 reads this end-to-end. Phases 1, 2, 3, and 7 cite specific sections by number.

The conversion roadmap is:

```
["Read Source", "Capture Intent", "Decompose into Phases", "Draft SKILL.md",
 "Draft Verifications", "Semantic Review", "Lint", "Smoke Test", "Iterate"]
```

Phase 9 (Optimize Description) is default-skipped for conversions — see §6 below for why.

---

## §1. Extraction checklist

Pull the following from the source SKILL.md and bundled directories. Save to `<workspace>/source-extract.md` using the EXACT section headings shown in Phase 0's body. The `## Description (verbatim)` heading is parsed by `lint_eskill.py --source-extract`; do not rename it, do not wrap the description in quotes or a yaml block, do not add a prefix like "Description:" before the text.

| Source field | Section heading in source-extract.md | Notes |
|--------------|--------------------------------------|-------|
| Frontmatter `name` | (in `## Frontmatter (other fields)` yaml block) | New skill name MAY differ; flag in summary if user wants a rename |
| Frontmatter `description` | `## Description (verbatim)` | Preserved exactly, plain text under the heading. Phase 3 inherits. Do NOT reword. Lint enforces equality byte-for-byte |
| Frontmatter `allowed-tools` | (in `## Frontmatter (other fields)` yaml block) | Carries to new frontmatter unchanged |
| Frontmatter other keys (`license`, `compatibility`, etc.) | (in `## Frontmatter (other fields)` yaml block) | Carry through 1:1 |
| Body: numbered steps | `## Workflow steps` (ordered) | Each line is a phase candidate |
| Body: section headings (H2/H3) | `## Section structure` | Hint at phase boundaries; merging cues |
| Body: "When to use" / "When not to use" / "Use This Skill" | `## Trigger context` | Feeds Phase 1 trigger-phrase output |
| Body: examples / sample prompts / "Basic Usage" | `## Documented triggers` | Feeds Phase 7 smoke prompt |
| Bundled `references/`, `scripts/`, `assets/`, `agents/` | `## Bundled asset inventory` | Filenames + sizes; copied 1:1 in Phase 3 |

If the source has no numbered steps but does have section headings that read like a workflow ("Scan", "Categorize", "Translate", "Format"), treat those headings as the workflow and record them in the `## Workflow steps` section in heading order.

---

## §2. Convert-vs-keep decision

Apply this rubric in Phase 0 before extracting. Stop the roadmap if the source should stay normal.

**Convert when** all of the following hold:

- Source has 3+ distinct steps with natural verification points between them
- Source produces a durable artifact (document, code, data file, structured output)
- AT LEAST ONE of: (a) source benefits from `ask` flow (user input gates a downstream step), or (b) source has authorship-bias risk (research, judgment, review), or (c) source has a "draft → critique → revise" pattern that would benefit from `extend`

**Keep as normal skill when** any of the following hold:

- Source is "answer one question" / "run one script" / "do one lookup"
- Source is reference-card style (lookup table, cheat sheet, glossary) with no workflow
- Source is purely declarative ("when X, do Y") with no multi-step process
- Source produces ephemeral conversational output, not a durable artifact

Borderline cases: prefer keeping. Conversion is reversible by re-authoring; over-converting wastes the user's time and produces an E-skill strictly worse than the original.

If the verdict is KEEP, record the rationale in source-extract.md and recommend the user via `forced_todo ask` that the roadmap abort. Do not proceed to Phase 1.

---

## §3. Mapping source-extract to intent.md

Phase 1 (Capture Intent) normally interviews. During conversion, source-extract.md provides most fields. Phase 1 maps as follows:

| Phase 1 question | Source from extract | Action |
|------------------|---------------------|--------|
| What workflow does this skill capture? | "Workflow steps" + "Section structure" | Inherit; expand into a 1-2 paragraph summary |
| When should the skill trigger? | "Trigger context" + "Documented triggers" | Inherit; copy 3-5 trigger phrases verbatim |
| What's the output? | Last "Workflow steps" entry + "Description (verbatim)" | Inherit; one-line shape (document / code / data / conversation) |
| Input files / dependencies / scripts? | "Bundled assets" inventory | Inherit verbatim |
| Natural verification checkpoints? | **Almost always missing in source.** | Ask via `forced_todo ask` |
| Iteration likely? | **Almost always implicit in source.** | Ask via `forced_todo ask` |

The two missing fields (verification checkpoints, iteration shape) are the only ones Phase 1 should `ask` about during a conversion. Everything else is inherited. Save the resulting intent to `<workspace>/intent.md` using the same template Phase 1's interview path uses, with a top-line note: `# Captured Intent (converted from <source path>)`.

---

## §4. Steps-to-phases mapping rules

Default mapping: **one source step → one phase**. The source author already chose a granularity that worked; trust it unless you have a clear reason to split or merge.

**Split when:**

- A single step both *produces an artifact* and *critiques it* — split into a `s.phase` write phase and an `m.phase` review phase.
- A single step has both a script invocation and a judgment call — split into `n.phase` (script) and `m.phase` (judgment) so the script's exit code is the verdict for one and a subagent rubric is the verdict for the other.
- A single step combines user-input gating with downstream work — split: gate becomes a `forced_todo ask` early in a `n.phase`; the work becomes its own phase.
- A single step is described in 200+ words with multiple sub-bullets — almost always actually two phases the author wrote as one.

**Merge when:**

- Two adjacent steps share an artifact (step 2 writes draft, step 3 polishes it) — merge into one `s.phase`.
- A step is purely "set up" (mkdir, cp template, init config) and the next step does the substance — merge.
- A "filter" or "exclude" step that just tags items without producing an independent artifact — merge into the producing step.

**Anti-pattern:** decomposing into more phases than the source has steps when there is no split-rationale. Source has 3 steps, decomposition has 7 phases — the model is inventing structure. If the source truly needed more phases, the source author would have written them.

---

## §5. Marker decision tree

Look at each source step's nature. Apply in order:

```
Source step says:                                   → Marker
"Run X script and report exit code"                 → n.phase
"Confirm with user / get sign-off / pick option"    → n.phase (with forced_todo ask)
"List / enumerate / count / scan"                   → n.phase
"Categorize by <fixed taxonomy>"                    → s.phase (rubric: each item categorized, no skipped items)
"Write a document with sections A, B, C"            → s.phase
"Generate code following these patterns"            → s.phase
"Format / structure / serialize"                    → s.phase
"Critique / review / evaluate / judge"              → m.phase
"Research and analyze tradeoffs"                    → m.phase
"Decide between options" (open-ended)               → m.phase
"Translate technical → user-friendly"               → m.phase (judgment-heavy; quality varies)
```

Tiebreaker: when the source says "do X", look at what verifies X.
- If the verifier is a script's exit code: `n.phase`.
- If the verifier is a checklist the author can self-grade: `s.phase`.
- If the verifier is "this looks right" subjective judgment: `m.phase`.

When genuinely in doubt between `s` and `m` for a judgment-heavy phase, pick `m` — authorship bias is real. But doubt is not a license to verify everything: each `s` costs 1 extra LLM turn and each `m` costs 2 (one a whole subagent session). If the phase's output doesn't need grading at all, the answer is `n`, not "m to be safe".

**Strip rule — verification prose moves out of the body.** Normal skills routinely embed their check steps in the instructions ("verify that every finding has a severity", "double-check the output has all five sections", a closing "Quality checklist"). During conversion that text must NOT be compressed into the phase body — it becomes the `verifications/<label>.md` rubric for that phase (usually most of the rubric is already written for you; reshape it into numbered checks + PASS/FAIL). The phase body keeps only the doing-instructions. Leaving check prose in the body makes the model verify during act and treat the runtime's verify turn as redundant — the phase then stalls without a `progress` call. `lint_eskill.py` errors on these patterns in `s`/`m` phase bodies.

---

## §6. Description inheritance

Source descriptions have been triggering correctly in production. They've been written (or already optimized via `run_loop.py`) against real prompts the user has actually typed. **Do not re-author from scratch.**

**Rule:** the new E-skill's frontmatter `description` field MUST byte-for-byte equal the text under `## Description (verbatim)` in `source-extract.md`. No rewording. No paraphrase. No "Triggers: ..." prefix. No restructuring of sentences. No prepending or appending content.

**Lint enforcement:** Phase 6 runs `lint_eskill.py --source-extract <workspace>/source-extract.md <new-skill-path>`. The lint script extracts the source description from the `## Description (verbatim)` heading and compares it byte-for-byte against the new SKILL.md frontmatter `description`. Mismatch = `ERROR: Description mismatch ...` and lint exit 1. The Phase 6 verify rubric requires lint exit 0 — a description rewrite blocks the entire roadmap until fixed.

**No exceptions.** Earlier drafts of this guide allowed a single appended clause like `... runs phase-by-phase with verification.` That exception is removed: it weakened the rule enough that conversions began drifting in practice (the model would treat "single short clause" as license to restructure the whole description). If the user wants the description to signal phased workflow, run Phase 9 (Optimize Description) AFTER the conversion stabilizes — that flow has its own eval set to defend against trigger regressions.

**Phase 9 (Optimize Description) — default-skip for conversions.** Re-optimization risks losing trigger coverage on phrases the user has not yet thought to test in their eval set. Run Phase 9 on a converted skill only when the user explicitly asks AND the conversion has stabilized in real use (Smoke Test passing, Iterate clean, the user has tried it on real prompts).

---

## §7. Asset preservation

In Phase 3, after writing the new SKILL.md, copy bundled directories from the source into the new skill folder. Do this BEFORE finishing Phase 3 — the lint phase checks for them.

Order matters; copy in this order:

1. `<source>/references/` → `<new-skill>/references/` (verbatim)
   - If you need to add conversion-derived material (e.g., a Phase 1 question template), namespace it under `<new-skill>/references/converted/` so it's distinguishable from inherited content.
2. `<source>/scripts/` → `<new-skill>/scripts/` (verbatim)
   - Phase bodies in the new SKILL.md must invoke them at the same relative path the source used. If the source said `scripts/foo.py`, the new phase must also say `scripts/foo.py` (or specify `.opencode/skills/<new-skill>/scripts/foo.py` for absolute clarity from the project root).
3. `<source>/assets/` → `<new-skill>/assets/` (verbatim)
4. `<source>/agents/` → `<new-skill>/agents/` (verbatim)
   - If any source agent file is referenced from a phase, the phase body must spawn it via the Task tool with the right config. Note the agent reference in the phase summary so future readers can trace it.

If the source body cross-references a file (e.g. "see `references/owasp-checklist.md`"), the relative path works unchanged in the new location after the copy.

**Sanity check after copying:** the new skill folder should contain at least the same number of files in each subdirectory as the source. If you see fewer, you missed some.

---

## §8. Worked example: converting a hypothetical `security-review` skill

Source extraction (excerpt from `source-extract.md`):

```yaml
source: ~/.claude/plugins/.../security-review/SKILL.md
name: security-review
description (verbatim): Complete a security review of the pending changes on the current branch.
allowed-tools: Read, Grep, Bash

workflow steps:
1. List staged + unstaged changes via git
2. Run static analysis tools available in the repo
3. Read each changed file, looking for OWASP-top-10 patterns
4. Categorize findings by severity
5. Produce a summary report with file:line refs

bundled assets:
- references/owasp-checklist.md (3 KB)
- scripts/run-static-analysis.sh (1 KB)

documented triggers:
- "review my branch for security"
- "/security-review"
- "security audit this diff"

convert-vs-keep verdict: CONVERT
  rationale: 5 distinct steps, durable artifact (report), judgment-heavy review
  step (3) with authorship-bias risk, natural verification at "categorize findings"
```

Decomposition that falls out of §4 + §5:

| # | Phase | Marker | Why this marker |
|---|-------|--------|-----------------|
| 0 | Read Source | n.phase: read-source | Conversion-only; produces source-extract.md |
| 1 | Capture Intent | n.phase: intent | Mostly mechanical given source-extract; ask only iteration shape |
| 2 | Enumerate Changes | n.phase: enumerate | Source step 1; script-driven (`git diff`) |
| 3 | Run Static Analysis | n.phase: static | Source step 2; script's exit IS the verdict |
| 4 | Manual Review | m.phase: review | Source step 3; judgment-heavy, authorship bias |
| 5 | Categorize Findings | s.phase: categorize | Source step 4; structural rubric (severity + cwe + file:line per finding) |
| 6 | Write Report | s.phase: write | Source step 5; sections rubric |
| 7 | Iterate | m.phase: iterate | Re-runs Manual Review when categorize/write surface new gaps |

Marker mix: 4n / 2s / 2m. Description inherited verbatim. `references/owasp-checklist.md` and `scripts/run-static-analysis.sh` copied 1:1. Phase 4 reads the OWASP checklist by relative path — works unchanged.

Smoke prompt for Phase 7: pick `"review my branch for security"` directly from the documented triggers list. Round-trip preservation: same trigger should produce an equivalent report.

---

## §8b. Real worked example: changelog-generator (this run)

The §8 walk-through above is hypothetical — useful for showing the rubric on a skill that has bundled assets to copy. The example below is real: it was produced by running `eskill-maker` against a normal skill in this project, and every artifact named below exists on disk.

**Source:** bundled at `references/examples/changelog-generator-source.md` inside this skill (single-file, no bundled assets in the original). All 9 phases of an earlier conversion run reached `verified`; lint passed with `--source-extract`.

**source-extract.md (relevant excerpts):**

```yaml
## Source path
<project-root>/normal_skills/awesome_skills/changelog-generator

## Description (verbatim)
Automatically creates user-facing changelogs from git commits by analyzing
commit history, categorizing changes, and transforming technical commits
into clear, customer-friendly release notes. Turns hours of manual
changelog writing into minutes of automated generation.

## Workflow steps
1. Scans Git History
2. Categorizes Changes
3. Translates Technical → User-Friendly
4. Formats Professionally
5. Filters Noise
6. Follows Best Practices

## Bundled asset inventory
No bundled assets found.

## Convert-vs-keep verdict
**CONVERT**
```

**Decomposition that actually fell out:**

| # | Phase | Marker | Source step(s) it covers |
|---|-------|--------|--------------------------|
| 1 | Scan Git History | `n.phase: scan-git` | Source step 1; merged with the implicit "filter scope" gating |
| 2 | Categorize Changes | `s.phase: categorize` | Source step 2 |
| 3 | Translate to User-Friendly | `m.phase: translate` | Source step 3 |
| 4 | Format Changelog | `s.phase: format` | Source steps 4 + 6 (merged: format + best-practices) |
| 5 | Iterate | `m.phase: review-iterate` | New phase, not in source — added because m.phase work dominates |

Merge rationale per §4: source steps 5 ("Filters Noise") and 1 ("Scans") share an artifact (the commit list); source steps 4 and 6 both shape the final document. Both merges follow the §4 "share an artifact" rule. No splits applied — none of the source steps combined produce-and-critique or script-and-judgment work that would justify splitting.

Marker decisions per §5:
- "Scans" → `n.phase` (machine-readable output, exit-code verdict)
- "Categorizes by fixed taxonomy" → `s.phase` (checklist rubric)
- "Translates technical → user-friendly" → `m.phase` (the §5 tree calls this exact phrase out as judgment-heavy)
- "Formats" → `s.phase` (sections rubric)

**Description inheritance:** the new SKILL.md's frontmatter `description` is byte-for-byte equal to source-extract.md's `## Description (verbatim)`. Lint enforced this via `--source-extract`. A previous run of this conversion (without the lint flag) had rewritten the description as `"Transform git commits into user-facing changelogs. Triggers: ..."` — that regression is exactly what §6 + the lint flag now prevent.

**Asset preservation:** vacuous — source had no bundled assets. The new skill folder contains `SKILL.md` + `verifications/` only. For sources with bundled directories, see §7 + the hypothetical security-review walk-through in §8.

**Smoke prompt:** Phase 7 used `"Generate changelog for all commits from the past week"` taken verbatim from the source's "How to Use" → "Basic Usage" examples list. The converted skill produced a real `CHANGELOG.md` artifact from a synthetic commit list. Round-trip preservation confirmed.

**Cross-reference:** `references/decomposition-examples.md` Example 4 walks the same conversion through the few-shot template Phase 2 reads.

---

## §9. Anti-patterns specific to conversion

- **Re-authoring the description.** Loses tested triggering. Inherit verbatim per §6.
- **Decomposing into more phases than the source has steps without a §4 split-rationale.** The model is inventing structure that wasn't there. Trust source granularity.
- **Dropping bundled assets.** A skill with 5 reference files and 2 scripts gets converted to a skill with 0 of each. Always run the §7 asset-inventory check.
- **Assigning `m.phase` to every step "to be safe".** Each `m.phase` costs a subagent invocation per phase. Use the §5 decision tree honestly — most workflow steps are not judgment-heavy.
- **Skipping the §2 convert-vs-keep check.** Some skills shouldn't be converted; pushing them through anyway produces an E-skill strictly worse than the original.
- **Re-running Phase 9 (Optimize Description) by default.** Default-skip per §6. The source description has been tested in production; re-optimizing risks regressing triggers on untested phrases.
- **Treating an existing skill's structure as wrong.** If a source step seems "off", ask the user before refactoring it during conversion. The user picked the source skill; conversion is faithful translation, not redesign.
