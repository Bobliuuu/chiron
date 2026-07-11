---
name: researcher
description: Given a topic, research it online and produce a structured reference-backed Markdown write-up saved at docs/research/{category}.md with Title, TL;DR, sections, and a References list. Use when the user asks to "research {topic}", "investigate {topic}", "find out about {topic}", "write up {topic}", or wants a single, durable, citable write-up on a topic in their docs/research/ folder.
evolved: true
---

# Researcher

Produces a structured, reference-backed Markdown write-up for a topic and saves it under `docs/research/<category>.md`. The skill captures the user's intent, decides whether to create a new file or merge into an existing one, runs subagents to gather and write the content, and verifies the output before handing it back.

### CRITICAL RULE: Stop after every `forced_todo` call

After any `forced_todo` call, **end your turn immediately**. No further tool calls. No further text. The orchestrator (a plugin) replies with the next instruction; if you keep generating, you'll skip past verify prompts and produce thin work.

**If `forced_todo` returns an error**, re-read the error, fix your call shape, and retry. Do NOT abandon the orchestrator and proceed without it — every later phase depends on the roadmap state the orchestrator owns. Common shape errors: `phases` passed as a stringified JSON literal instead of a native array (use `phases: ["A", "B"]`, not `phases: "[\"A\", "B\"]"`); phase id case mismatch; missing `skill_name` on `roadmap`.

### FIRST STEP: Declare your roadmap

Call `forced_todo` with action `roadmap`, naming the phases you'll run. Phase ids MUST match the headings below exactly (after stripping the `Phase N:` prefix — e.g., `## Phase 1: Confirm Intent` → id `Confirm Intent`).

```
forced_todo roadmap \
  --skill_name "researcher" \
  --phases ["Confirm Intent", "Classify Existing Research", "Research and Write", "Verify Output", "Iterate"]
```

Pick a subset that matches the user's task. Examples:

- User asks "research X" and gives no prior context → all five phases.
- User asks "add a section on Y to the existing research on transformers" → ["Classify Existing Research"] is wrong here because Confirm Intent is still required to lock scope; in practice, all five phases (Confirm Intent captures the merge hint, Classify then makes the merge decision, Research and Write appends, Verify checks merge correctness).
- User asks a quick factual question that is NOT a write-up → this skill is the wrong fit. Do not invoke it; suggest a normal `webfetch`/`MiniMax_web_search` instead.

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

#### Summary format

Every progress call uses a summary of **1–4 short bullets** covering, as applicable to the phase:

- **Decisions** made (with the chosen value).
- **Facts** established (with source if external).
- **Artifacts** produced (with file paths).
- **Open items** handed to later phases.

Summaries are durable — they become the cumulative context header for every later phase. Thin summaries break downstream phases.

### Asking the user a question

Any time you need clarification, write the question text in your reply (so the user sees it) and call:

```
forced_todo ask --question "<the question text>"
```

Stop. The user will reply. On the next turn, continue acting on the current phase using their answer, then call `forced_todo progress` when done.

### Re-running phases after fixes (only inside an iterate-style phase)

If a verification phase surfaced real gaps, an iterate-style phase can append re-runs of earlier phases to the end of the roadmap:

```
forced_todo extend --phases [phase ids to re-run, plus the iterate phase if more iteration may still be needed]
```

Pass the original phase ids as written in the SKILL.md. Original verified phases stay verified; re-runs are net-new pending entries that inherit the original's content + rubric. Include the iterate phase itself in the list when continued iteration may still be needed — the loop runs only once otherwise.

---

## Phase 1: Confirm Intent
<!-- n.phase: confirm -->

Your job in this phase: nail down exactly what the user wants researched, in a form that downstream phases can act on without re-asking. The output of this phase is `docs/research/.researcher/intent.md` (a sibling scratch file under the artifact directory, not the deliverable itself).

### Step 1 — Read the user's request

The act prompt carries the user's research topic and any prior context. Re-read it carefully. Do NOT invent scope the user did not ask for.

### Step 2 — Identify what's missing or ambiguous

Walk through these and for each one ask: "can Phase 3 research and write the deliverable without further input from me?"

- **Scope boundaries.** Is "transformers" the architecture, the toys, a finance term, a movie? Is "research this" all of: history + current state + alternatives + risks, or just one of those?
- **Audience and depth.** Is this for a personal note, a team memo, a public brief? Should it assume the reader is technical?
- **Output target.** Where should it go? Default is `docs/research/<kebab-case-topic>.md`. If the user named a different path, capture that verbatim.
- **Existing-file intent.** Did the user mention "add to", "merge with", "the file on X", or "the existing research on X"? Capture verbatim — Phase 2 needs it.
- **Must-cover questions.** Did the user say "I need to know about X, Y, Z" or "compare A vs B"? Capture as a list.

If anything is still ambiguous after reading the request as carefully as you can, call `forced_todo ask` with ONE focused question (combine related sub-questions; don't pepper the user). If the request is reasonably clear, skip the ask and proceed.

When in doubt: one ask is better than five, but zero asks is better than one — only ask when you genuinely cannot act without the answer.

### Step 3 — Pick the category slug

Convert the topic into a kebab-case directory-and-filename slug:

- Lowercase ASCII letters, digits, and single hyphens.
- No leading/trailing hyphens, no consecutive hyphens.
- Examples: "Transformer Architecture" → `transformer-architecture`; "OAuth2 vs OIDC" → `oauth2-vs-oidc`; "RAG patterns in 2025" → `rag-patterns-in-2025`.

If the topic contains non-ASCII characters or proper nouns that lose meaning when transliterated, keep them in the body but use a sensible ASCII slug.

### Step 4 — Write the intent file

Create the scratch directory and write `docs/research/.researcher/intent.md` with this exact shape:

```markdown
# Research intent

## Topic
<the user's topic, in their words where possible>

## Category slug
<the kebab-case slug>

## Scope
<1-3 bullet points: what is in scope>

## Out of scope
<1-3 bullet points: what is explicitly NOT being researched (write "nothing stated" if the user didn't say)>

## Audience and depth
<one short paragraph: who's reading and how technical they are>

## Output target
<absolute or repo-relative path; default `docs/research/<slug>.md`>

## Merge hint
<verbatim user mention of an existing file or merge target, or `none`>

## Must-cover questions
- <question 1>
- <question 2>

## Source preferences
<any user-stated preferences for sources: peer-reviewed only, English only, specific domains to avoid, etc.; `none` otherwise>
```

### Step 5 — Sanity-check and write the progress summary

Re-read the file you just wrote. Make sure every section is populated (use `none` when empty, don't leave blanks). Then call `forced_todo progress` with a summary that names the slug and lists any clarifying questions you had to ask.

## Phase 2: Classify Existing Research
<!-- s.phase: classify -->

Your job: decide whether the deliverable goes in a brand-new file or merges into an existing one, then write that decision to `docs/research/.researcher/decision.md` so Phase 3 and Phase 4 can act on it.

### Step 1 — Read inputs

1. Read `docs/research/.researcher/intent.md` from Phase 1. Capture the **topic**, **category slug**, **merge hint**, and **must-cover questions**.
2. Glob the deliverable directory: list every file under `docs/research/` that is NOT inside `.researcher/` (use the `glob` tool with pattern `docs/research/**/*.md` or `docs/research/*.md`, then filter out `.researcher/*`).

### Step 2 — Decide

Walk through this decision tree in order:

1. **User merge hint exists** (`Merge hint:` is not `none` in intent.md): try to resolve it to a real file. If the hint names a file, set action = `merge` and target = that file. If the hint describes a topic ("the existing research on transformers") and exactly one existing file matches, set action = `merge` and target = that match. If the hint names a file that does not exist, fall through to step 2 and treat it as if there were no hint.
2. **Filename match**: is there an existing file whose stem (filename without `.md`) equals the category slug, OR a near-match (kebab-case similarity, e.g. `transformer-architecture` matches slug `transformer-architectures`)? If yes, set action = `append` and target = that file. Read the existing file's TL;DR to confirm same topic before finalizing; if the topic has clearly drifted, fall through.
3. **Loose-topic match**: does ONE existing file plausibly cover the same topic (same subject matter, even if the slug differs)? If yes, set action = `merge` and target = that file. Briefly note in rationale why the topics overlap.
4. **Multiple loose matches or no matches**: set action = `create` and target = `docs/research/<slug>.md`. Do not silently pick one of several candidates.

You will write one of three action values into the decision file:

- `create` — write a fresh file at `docs/research/<slug>.md`.
- `append` — append a clearly-dated, headed section to an existing file (target file unchanged).
- `merge` — rewrite the existing file to absorb this research (target file replaced with merged content).

Appends are for adding a small, clearly-bounded section to an unrelated existing topic. Merges are for the case where the existing file's topic overlaps enough that the new research should replace / reorganize it. If you're tempted to choose `append` because the existing topic "could be related", re-read the topic — appends to a mismatched topic create a confusing file.

### Step 3 — Write the decision file

Create (or overwrite) `docs/research/.researcher/decision.md` with this exact shape:

```markdown
# Classification decision

## Action
<one of: `create` | `append` | `merge`>

## Target path
<the file path the deliverable will be written to>

## Slug
<the kebab-case category>

## Rationale
<2-5 sentences explaining why this action. For merge/append, name the existing file matched and the topic overlap. For create, explain why no existing file was a fit.>

## Existing files considered
- <path> — <one line: why kept or ruled out>
- ... (list every file under docs/research/ that was considered, even briefly)

## Merge hint applied
<verbatim user merge hint, or `none`>
```

### Step 4 — Progress summary

Call `forced_todo progress` with the action, the target path, and a one-line rationale.

## Phase 3: Research and Write
<!-- n.phase: research -->

Your job: gather the information online and write the deliverable Markdown file. This phase produces the actual artifact at the target path — the entire user-visible output of this skill run.

### Step 1 — Read inputs

1. Read `docs/research/.researcher/intent.md` from Phase 1. You need the topic, scope, audience, must-cover questions, and source preferences.
2. Read `docs/research/.researcher/decision.md` from Phase 2. Capture the action and target path.
3. If the action is `append` or `merge`, also read the existing target file to understand its current structure so you don't break it.

### Step 2 — Research the topic

Spin up **one or more subagents** (Task tool, subagent_type `general`) to gather online sources. Each subagent gets:

- The topic and scope from intent.md.
- The must-cover questions (each subagent should return answers to its assigned subset).
- A short list of what kinds of sources are acceptable (peer-reviewed vs general web, English only if specified, etc.).
- A return-shape requirement: a list of sources with `{title, url, why_relevant}` plus a short prose summary of what that source says.

Do NOT research yourself with web tools and then summarize in your own voice — subagent findings carry the actual reference list. After subagents return, you compose the final write-up from their findings.

Cap the work at one round of 2-3 subagents in parallel. If must-cover questions split cleanly by sub-question, fan out. If they don't, one subagent for breadth and one for depth is usually enough.

### Step 3 — Compose the write-up following this exact template

The deliverable uses this Markdown shape, top to bottom:

```markdown
# <Topic, in title case>

> **TL;DR.** <2-4 sentence summary. The single most important takeaway the reader should leave with. No preamble like "This document..." — start with the substance.>

## <Section heading 1>
<prose: 1-3 short paragraphs>

## <Section heading 2>
<prose: 1-3 short paragraphs>

(...continue with as many sections as the topic warrants — usually 3-6)

## References

1. <Author/Org>. "<Title>." <Publisher/Source>. <URL>. Accessed <YYYY-MM-DD>.
2. ...
```

Section guidance:

- Pick sections that map to the must-cover questions in intent.md. If the user listed three questions, three top-level sections is a reasonable shape.
- Each section is plain prose. No bullet-list dumps where prose will do. A short bulleted list inside a section is fine if the content is genuinely list-shaped.
- Every non-trivial factual claim that came from a specific source should be supportable by checking a reference. Reference numbers ([1], [2]) inline are encouraged when a claim comes from a single source.
- The TL;DR blockquote uses the `>` prefix and the literal bold **TL;DR.** prefix.

Voice and register (concrete moves, not vibes):

- **Vary sentence length deliberately.** Mix short sentences (under 8 words) with longer ones. If three consecutive sentences have the same shape and length, rewrite one. Uniform sentence rhythm is the single strongest machine-writing tell.
- **One point per paragraph.** Each paragraph makes one claim; the other sentences support it. If a paragraph carries five equal-weight facts, it is a list wearing a paragraph costume — either write it as a short bulleted list or cut facts.
- **Cite in clusters, not per sentence.** Attach reference markers at the claim that needs them, not reflexively at the end of every sentence. More than two `[n]` markers in one sentence, or a marker on every sentence of a paragraph, means the prose is a citation dump — restructure so one marker covers the cluster.
- **Plain verbs and contractions.** "shows" not "demonstrates", "use" not "leverage", "big" not "significant". Contractions are fine.
- **Banned phrases** (do not use): "it is important to note", "it is worth noting", "furthermore", "moreover", "in conclusion", "delve", "leverage", "robust", "pivotal", "underscores", "landscape", "realm", "navigate the complexities", "deserve(s) a special callout", "the honest answer", "the honest caveat", "notably".
- **Banned structures**: perfect parallel constructions of three or more items ("X, Y, and Z" where all items are the same part of speech and length — vary or cut one; applies to the TL;DR too); more than one em-dash per paragraph; opening a section by restating its heading.
- **No template paragraphs.** The sentence-level rules apply one level up too. Don't reuse the same paragraph scaffold more than twice per document (e.g., `**Label.** <definition>. The cost is X. The bottleneck is Y.` repeated for every item) — express the third tradeoff a different way, or the section reads like a filled-in form. Same for scaffold phrases: if "the cost is" / "the tradeoff is" / "the win is" has already appeared twice, find other words.
- **Vary section openers.** At most one section per document may open with an enumeration promise ("Four families show up…", "Five mechanisms dominate…"). Consecutive sections must not share an opener shape.
- The goal is a readable reference doc, not detector evasion. When a banned word is the precise technical term in a quoted source, keep it.

Register example — same content, wrong then right:

> **Wrong:** "Persona vectors [7] deserve a special callout: they let you both *monitor* and *control* personality traits in activation space, and it is worth noting that Anthropic's pipeline extracts a vector for any natural-language trait description [7], while training-induced persona drift correlates ρ ≈ 0.8 with shifts along the vector [7]."
>
> **Right:** "Persona vectors do two jobs at once: monitoring and control. Anthropic's pipeline extracts a vector for any natural-language trait description, and training-induced drift tracks shifts along that vector at ρ ≈ 0.8 [7]. That correlation is the useful part — it means the vector works as a live gauge of how much of a trait is present."

### Step 4 — Pick the append/merge behavior when applicable

- **Action is `create`**: write the template directly to the target path.
- **Action is `append`**: preserve the existing file's content verbatim and append ONE new section at the bottom. The new section heading must be dated (`## Update — YYYY-MM-DD: <short descriptor>`) and must NOT duplicate any existing section. Do not move or rewrite existing content.
- **Action is `merge`**: read the existing content, recompose the file so the new research fully replaces / reorganizes the old content, keep what's still accurate, drop what's now stale, and write the recomposed file. The merge target path is preserved; you are replacing its content. Include a brief `## Update history` note at the bottom with the date and one-line description of what changed.

### Step 5 — Write the file

Write the composed content to the target path from decision.md using the `write` tool. Then re-read the whole file once, end to end, checking three things:

1. It's well-formed Markdown and the section count matches what you intended.
2. **No duplicated claims.** When multiple subagents feed the draft, the same system or paper often gets described twice in different sections with near-identical sentences. Cut or merge the second occurrence — every source should be *introduced* exactly once; later sections may reference it briefly but not re-explain it.
3. **No template drift.** Scan paragraph openers and section openers against the voice spec above (repeated scaffolds, repeated enumeration openers). Fix in place before moving on.

### Step 6 — Progress summary

Call `forced_todo progress` with: topic, target path, action taken (create / append / merge), number of references cited, and a one-line statement of whether subagent research covered the must-cover questions.

## Phase 4: Verify Output
<!-- m.phase: verify -->

Your job: read the freshly written deliverable against the user's intent and the add-vs-new decision, then render a verdict. This is a judgment-heavy check — the same model that wrote the file would rubber-stamp it, so read critically. Do not produce a checklist yourself; produce the verdict directly.

### Step 1 — Read inputs

1. Read the deliverable at the target path written in `docs/research/.researcher/decision.md`.
2. Read `docs/research/.researcher/decision.md` to capture the action (`create` / `append` / `merge`).
3. Read `docs/research/.researcher/intent.md` to load the topic, must-cover questions, audience expectations, and any merge hint.

### Step 2 — Evaluate against the criteria appropriate to the action

For a `create` action: evaluate structure (top-level title, TL;DR blockquote, at least three sections, References section at the end), reference presence and quality, must-cover coverage against the intent file, audience match, TL;DR substance (no placeholders), section length sanity, and voice (no banned phrases from the Phase 3 voice spec, varied sentence length, citations clustered rather than stamped on every sentence).

For an `append` action: in addition to the create-action criteria, evaluate whether the existing content above the new section is unchanged, whether the new section is dated and non-duplicating, and whether the file still reads coherently.

For a `merge` action: in addition to the create-action criteria, evaluate whether the writer actually dropped stale content (not just appended on top), whether the file reads as one coherent document, and whether an update-history note is present.

### Step 3 — Render the verdict

Render ONE of:

- **PASS** — every applicable evaluation passed. The deliverable is ready to hand back to the user.
- **FAIL** — at least one evaluation failed. Name each failed gap concretely. Example: `FAIL: must-cover question "compare OAuth2 vs OIDC grant types" has no dedicated section.` Do not write vague FAIL summaries like "needs more work" — name the gap.

If you would fail the file, do not fix it yourself. That is the Iterate phase's job. Just render the verdict.

### Step 4 — Progress summary

Call `forced_todo progress` with `PASS` or `FAIL`, plus a one-line summary of what most concerned you (or "no concerns" for PASS).

## Phase 5: Iterate
<!-- s.phase: iterate -->

Your job: given Phase 4's verdict, decide whether to re-run earlier phases or finish cleanly.

### Step 1 — Read inputs

1. Read Phase 4's verdict from the cumulative summary header. The verdict is either `PASS` or `FAIL` with a list of named failed checks. Do not rely on conversation history — the orchestrator prunes prior phases' full conversations once they verify; the summary header is the durable signal.

### Step 2 — Decide

- **If PASS**: the skill is done. Do not extend. Call `forced_todo progress` with a one-line summary "no further iteration; deliverable verified" and stop. The orchestrator will advance out of the roadmap.
- **If FAIL**: examine each named failed check. For each gap, decide which earlier phase owns it:
  - Gaps about **completeness** (must-cover question missing, missing section, missing reference, TL;DR is a placeholder, prose too thin) → re-run **`Research and Write`**.
  - Gaps about **merge correctness** (merge appended instead of replaced; section duplicated; existing content was modified when it shouldn't have been) → re-run **`Research and Write`** AND **`Verify Output`** (research needs to redo the merge, then re-verify).
  - Gaps about **classification** (you now realize the file should have been a merge but was created, or vice versa) → re-run **`Classify Existing Research`** AND **`Research and Write`** AND **`Verify Output`**.
  - Gaps about **scope** (the user's intent was wider / narrower than what was researched) → re-run everything from **`Confirm Intent`** onward.

### Step 3 — Extend the roadmap

For each category of gap, include the phase ids (exactly as written in the SKILL.md headings) in the extend list. Always include `Iterate` itself at the END so the loop can decide again after the re-run.

Examples:

- Completeness-only FAIL → `forced_todo extend --phases ["Research and Write", "Verify Output", "Iterate"]`
- Merge-correctness FAIL → `forced_todo extend --phases ["Research and Write", "Verify Output", "Iterate"]`
- Classification FAIL → `forced_todo extend --phases ["Classify Existing Research", "Research and Write", "Verify Output", "Iterate"]`

### Step 4 — Max iterations

If you find yourself extending the roadmap a second time in this phase (i.e., this is the third total pass through Iterate), stop trying to converge automatically. Surface the failure to the user via `forced_todo ask` with the latest verdict and a one-paragraph summary of what's still wrong. Two automatic attempts is enough; the user should decide whether to keep iterating, accept the gaps, or abandon.

### Step 5 — Progress summary

Call `forced_todo progress` with:

- If PASS-clean: "no further iteration; deliverable verified; skill run complete".
- If extending: the extend list issued and a one-line reason tying it to the Phase 4 verdict.
