# E-skill contract — condensed reference

Self-contained, in-skill canonical summary of what the runtime expects of an E-skill. Authors and `eskill-maker` use this when drafting. This file is the authoritative version anything inside `eskill-maker/` should read; keep it in sync when the runtime contract changes.

---

## File layout

```
.opencode/skills/<skill-name>/
  SKILL.md                  # required
  verifications/            # optional
    <label>.md              # one per labeled s.phase / m.phase phase
  references/               # optional, model loads on demand
  assets/, scripts/         # optional, free-form
```

- `<skill-name>` must match the directory and the value the model passes to `forced_todo roadmap` as `skill_name`.
- Frontmatter is required by the OpenCode skill loader (`name`, `description`); the orchestrator itself does not read it.

---

## SKILL.md body parser — the rules

Mirrors `forced_todo.js:parseSkillPhases`.

### Phase boundaries

- Every line matching `^##\s+` outside a fenced code block is a **phase boundary**.
- `#`, `###`, `####` are NOT phase boundaries — they're prose-level (h1 for title) or sub-sections inside a phase.
- Content before the first `##` is dropped (preamble — model sees it on initial SKILL.md load, but not re-injected later).
- `##` inside a fenced code block is silently treated as content (correct: code-block templates with example markdown are fine).

### Phase id derivation

Heading text after `## ` is run through `stripPhasePrefix` (case-insensitive):

```
## Phase 1: Setup     → id "Setup"
## Phase 1. Setup     → id "Setup"
## Phase 1 - Setup    → id "Setup"
## Setup              → id "Setup"
## 1. Setup           → id "1. Setup"  (no Phase keyword, no strip)
```

Phase ids the model passes to `forced_todo roadmap` MUST match these parsed ids exactly (case-sensitive after the prefix strip). A mismatch silently degrades to empty phase content — no error.

### Marker comments

```
<!--\s*([nsm])\.phase\b\s*(?::\s*([^\s>]+))?\s*-->
```

| Letter | Meaning             | Verify flow                                                  |
|--------|---------------------|--------------------------------------------------------------|
| `n`    | none                | Tool auto-verifies on first `progress`. **One** progress call. |
| `s`    | self                | Plugin sends a verify-self prompt; model re-reads its own work. **Two** progress calls. |
| `m`    | subagent (multi)    | Plugin sends a verify-subagent prompt; model spawns Task. **Two** progress calls. |

- Marker line MUST appear inside the phase (between this `##` and the next).
- Label after `:` is matched as `[^\s>]+`. **No spaces, no `>`.** A label with spaces fails the regex entirely → marker silently doesn't register → phase falls back to `s.phase` with no rubric.
- Labels are lowercased (`<!-- s.phase: Review -->` → file `verifications/review.md`).
- The marker line is stripped from the phase content the model sees.

### Phase content

Everything inside a phase except the marker line. Includes sub-headings, prose, lists, fenced code blocks, tables — anything markdown. The plugin trims leading/trailing whitespace; otherwise content is verbatim.

Each phase's act prompt the model sees:

```
[FORCED TODO] Act on phase: <phase id>

Context from earlier phases:
- <prior-id>: <prior-summary>
...

Phase content:
<exact phase content as parsed, marker stripped>

When done, call:  forced_todo progress --summary "<your summary>"
End your turn now.
```

**Treat each phase's content as self-contained.** Earlier phases' full content is pruned; only summaries persist. Critical constraints belong at phase edges (top or bottom) — middle content gets less attention.

---

## Verification override files

For any phase whose marker has a label, the plugin tries to load `verifications/<label-lowercased>.md` once at `roadmap` time. If found and non-empty, becomes the verification rubric. If missing or empty, falls back to "verify against the phase content above".

- Override files apply only to `s.phase` / `m.phase`. `n.phase` ignores them (no verify round-trip exists).
- File body is the rubric verbatim. No frontmatter, no template substitution.
- Rubrics should read like a reviewer's brief: numbered checks in order, PASS (with one-paragraph summary) / FAIL (with numbered actionable gaps) output spec.
- For `m.phase` rubrics: must be self-contained — a subagent will see only what the verify prompt passes it.

---

## The model's contract

The runtime cannot enforce these — the SKILL.md must teach the model:

1. **Call `forced_todo roadmap` first**, with `skill_name` and `phases[]` matching parsed SKILL.md ids exactly.
2. **Stop after every `forced_todo` call.** Tool result text says this; SKILL.md should reinforce.
3. **Respond to `[FORCED TODO] Act on phase: X`** by doing the work, then `forced_todo progress --summary "<bullets>"`.
4. **Respond to `[FORCED TODO] Self-verify` / `Subagent-verify`** by running the check, fixing gaps in the same turn, then `forced_todo progress` with a final summary that reflects the fixes.
5. **Use `forced_todo ask --question "..."`** for clarification, after writing the question to the user in the same response.
6. **Use `forced_todo extend --phases [...]`** from inside an iterate-style phase to re-run prior phases. Pass the original phase ids as written in the SKILL.md. Original verified phases stay verified. Include the iterate phase itself in the list when continued iteration may still be needed.

### Summary format

The prompts injected by the plugin carry the authoritative summary-format spec at runtime (1–4 bullets: decisions/facts/artifacts/open items). The model receives it adjacent to the `forced_todo progress` instruction every turn it needs to call progress. SKILL.md preambles do not need to re-teach the format — point at the prompt-supplied spec instead.

Summaries are durable — they become the cumulative context header for every later phase. Thin summaries break downstream phases; pruning has already removed the original content by the time later phases run.

---

## Phase lifecycle

Per phase:

```
n.phase:    [act prompt] → progress(summary) → done
s.phase:    [act prompt] → progress(summary) → [verify-self prompt] → progress(final summary) → done
m.phase:    [act prompt] → progress(summary) → [verify-subagent prompt] → progress(final summary) → done
```

After the last phase verifies, `current_phase_id` becomes null and the plugin stops issuing `[FORCED TODO]` prompts.

`ask` is a side channel — fires at any point, pauses the orchestrator until the user replies.
`extend` appends new pending phases to the end of the roadmap; original verified phases stay verified.

---

## Authoring footguns

| Symptom                                          | Cause                                                                                |
|--------------------------------------------------|--------------------------------------------------------------------------------------|
| Phase prompt arrives empty                       | Phase id passed to `roadmap` doesn't match a parsed id (typo, capitalization).       |
| Marker silently ignored                          | Label has a space (`: research notes`), or marker before first `##`, or in a fence.  |
| Verify rubric never loads                        | Filename case mismatch on a case-sensitive filesystem (`Review.md` vs `review.md`).  |
| Downstream phase has no context                  | Earlier phase's summary was thin/generic; pruning removed the original content.      |
| Plugin re-prompts during ask                     | Model wrote the question in text but didn't call `forced_todo ask`.                  |
| External-directory writes silently fail          | OpenCode permission system auto-rejects writes outside the workspace `--dir`.        |

---

## Quick checklist for an E-skill that satisfies the contract

- [ ] Folder name matches frontmatter `name`.
- [ ] SKILL.md teaches the seven model-contract rules above.
- [ ] Every named phase (`Phase N: ...`) has exactly one marker comment.
- [ ] Marker labels are kebab-case (no spaces, no `>`), unique per phase.
- [ ] Every labeled `s.phase` / `m.phase` has a non-empty `verifications/<label>.md`.
- [ ] Phase ids are unique post-strip and read well as prompts.
- [ ] Phase content is self-contained, with critical constraints at phase edges.
- [ ] `m.phase` rubrics are self-contained for the spawned subagent.
- [ ] No `Phase N:`-style heading inside a fenced code block.

For the full lint pass that checks all of these mechanically, run `python -m scripts.lint_eskill <skill-path>`.
