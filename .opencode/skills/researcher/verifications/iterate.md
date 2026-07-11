Verify the Phase 5 (Iterate) decision. The act prompt for Phase 5 ran once and chose either to extend the roadmap or finish cleanly; this rubric confirms the choice was the right one given the Phase 4 verdict.

Check each, in order:

1. **Input present.** Phase 4's verdict was rendered as either PASS or FAIL with named failed checks. Re-read it (the act prompt for this phase contains the verdict, or it appears in the cumulative summary header from Phase 4). FAIL if no clear verdict is available.

2. **PASS path.** If the Phase 4 verdict is PASS, Phase 5 must NOT issue an `extend` call. Phase 5's progress summary should contain "no further iteration" (or close paraphrase) and no `forced_todo extend` call was made. FAIL if Phase 5 extended despite a clean PASS — that's wasteful re-runs that risk regressing a verified deliverable.

3. **FAIL path — gap-to-phase mapping.** If the verdict is FAIL, every named failed check must be mapped to the correct earlier phase:
   - Must-cover questions missing, missing sections, missing references, placeholder TL;DR, prose too thin → `Research and Write`.
   - Merge correctness failures (merge appended instead of replaced; section duplicated; existing content modified when it shouldn't have been) → `Research and Write` AND `Verify Output`.
   - Classification failures (file should have been merged but was created, or vice versa) → `Classify Existing Research` AND `Research and Write` AND `Verify Output`.
   - Scope failures (research was too narrow or too wide for the user's intent) → `Confirm Intent` AND everything downstream.
   FAIL if a gap was mapped to a phase that doesn't own it, or if the mapping was vague ("the deliverable needs work" with no named check).

4. **FAIL path — ordering in extend list.** The extend list passed to `forced_todo extend` must end with `"Iterate"` AND must list phases in dependency order (re-run prerequisites before their consumers). FAIL if `Iterate` is missing from the list (the loop only runs once otherwise), or if a phase appears after a phase that depends on it.

5. **FAIL path — at-least-the-producing-phase.** The phase that produced the artifact (`Research and Write` in most gaps) is always in the extend list when the verdict is FAIL — re-running Verify without re-running Research would re-verify the same broken file. FAIL if the producing phase is missing from the extend list.

6. **Iteration cap.** If Phase 5 has already extended the roadmap once during this skill run and is being asked to decide a second time on a new FAIL, this is the THIRD pass through Iterate (initial act + first re-run act + this verification). At this point Phase 5 should have issued a `forced_todo ask` to surface to the user, not another automatic extend. FAIL if a third automatic extend was issued without user escalation.

Return one of:

- **PASS**, followed by a one-line statement of which path was taken (clean-exit or which phase subset was extended).
- **FAIL**, followed by a numbered list of the failed checks above with one concrete sentence per failure.
