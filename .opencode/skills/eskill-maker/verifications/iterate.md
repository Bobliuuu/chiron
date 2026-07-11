Re-read your iterate decision with fresh eyes — be honest, do not rubber-stamp it to advance the roadmap. The act asked you to read the prior phases' summaries (especially Semantic Review, Lint, Smoke Test), identify gaps, apply fixes to the skill, and decide which earlier phases to re-run via `forced_todo extend`. Confirm the decision was substantive and the extend list is correct.

A wrong decision here either (a) extends nothing when real gaps remain, leaving the skill broken, or (b) extends everything reflexively when no real gaps exist, burning time on no-op re-runs.

Ground each check in evidence: the prior phase summaries in the cumulative context header, the current state of the skill folder on disk (re-read the files you claim to have fixed), and the extend list you issued (or chose not to).

Check each, in order:

1. **Real gaps exist.** Read the prior verification summaries. Are there actual unresolved gaps that warrant re-running phases? If smoke test passed cleanly, semantic review passed, and lint exited 0, there are no gaps and iterate should NOT have called extend — it should have called `progress` with a summary explaining "no gaps surfaced; skill is ready". Flag a needless extend as a fail.

2. **Fixes were actually applied.** If the iterate decision claimed to apply fixes (e.g., "fixed marker label on Phase 4", "tightened the description per semantic-review feedback"), check that the file changes are present. An iterate phase that says it fixed something but didn't is a process failure.

3. **The extend list matches the gaps.** Extend phase ids must match the SKILL.md `## Phase N: <id>` heading text post-strip — case-sensitive — not the marker label. So the list values are `Lint`, `Semantic Review`, `Smoke Test`, `Iterate` (not `lint` / `review-semantic` / `smoke`). If `Lint` failed but `Semantic Review` and `Smoke Test` passed, the extend list should include `Lint` (and the iterate phase itself, plus any phase whose verify rubric depends on lint passing). If `Semantic Review` failed, include `Semantic Review`. If `Smoke Test` failed, include `Smoke Test`. The model should not extend phases whose verifications already passed and whose work is unaffected by the fixes.

4. **`Iterate` is in the extend list when continued iteration may be needed.** If any of the included phases might fail again after the fixes, `Iterate` must be in the extend list — otherwise the loop runs only once. If `Iterate` is omitted, the model is asserting that one more pass through the included phases will definitively resolve the gaps. That's a strong claim; flag if it doesn't seem warranted.

5. **The order in the extend list is dependency-correct.** `Semantic Review` must run before `Lint` (Lint depends on a semantically-reviewed skill). `Lint` must run before `Smoke Test` (smoke depends on a contract-compliant skill). If the list is out of order, the model is asking the runtime to verify against stale state.

6. **No phantom phases were added.** Confirm every id in the extend list corresponds to an actual phase id in the SKILL.md (case-sensitive, post-`Phase N:` strip). Adding a phase that doesn't exist results in empty act prompts at runtime and silent failure.

7. **The summary records what changed.** The iterate phase's `progress` summary should list (a) the gaps it identified, (b) the fixes it applied (with file paths), (c) the extend list it issued (with rationale per phase). This summary becomes the cumulative context header for the re-run phases — they need to know what changed since their first pass.

Return one of:

- **PASS** — followed by a one-paragraph summary: which gaps drove the iteration, which files were modified, which phases will re-run, and whether iterate is set to fire again. The re-runs will inherit this summary so make it concrete.
- **FAIL** — followed by a numbered list of specific issues. For each: name the issue (gap not addressed, wrong phase in extend list, fix not actually applied, etc.) and what to do about it. If the fix is "don't extend at all" because no gaps exist, say so explicitly — the model should call `progress` without `extend` in that case and let the roadmap complete.
