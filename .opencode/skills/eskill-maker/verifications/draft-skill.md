Re-read the SKILL.md you just produced. Check it against the contract structure and the decomposition you committed to. Be honest — do not mark verified to advance the roadmap. Mark verified only when another author could pick up this SKILL.md and run it through the full E-skill lifecycle without coming back with questions.

Reference: [references/contract-summary.md](../references/contract-summary.md), [references/preamble-template.md](../references/preamble-template.md).

Structural checks (mechanical — easy to verify):

1. **Frontmatter is correct.**
   - `name` matches the skill folder name exactly.
   - `description` describes both what the skill does AND when to trigger it. "Pushy" framing — names trigger phrases the user might say without explicitly invoking the skill. No angle brackets.
   - `evolved: true` is present (convention).
   - No unexpected keys.

2. **Preamble is at h3, not h2.** The five non-phase sections (CRITICAL RULE, FIRST STEP, How phases run, Asking the user a question, Re-running phases after fixes) all use `###` headings. If any are at `##`, the runtime parses them as phantom phases — convert to `###`.

3. **Preamble teaches the model contract.** Concretely:
   - "Stop after every `forced_todo` call" rule, top of preamble.
   - `forced_todo roadmap` instruction with at least three example phase subsets for different task shapes.
   - Phase progression overview (act → progress → verify → progress).
   - Summary-format spec (1-4 bullets, decisions/facts/artifacts/open items).
   - `forced_todo ask` instruction (write question text in reply, then call ask, then stop).
   - `forced_todo extend` instruction iff the skill has an iterate phase. Otherwise this section can be omitted.

4. **Every named phase has exactly one marker comment** on the line(s) immediately after the heading. Markers are `[nsm].phase[: <label>]`. Label is kebab-case, no spaces, no `>`. Label is unique per phase (unless intentional rerun coupling).

5. **Phase ids in the example `roadmap` calls match the headings exactly.** After stripping the `Phase N:` prefix. Case-sensitive. A mismatch would make the act prompt arrive empty at runtime — silent failure.

6. **Every phase's content is self-contained.** Read each phase's body in isolation. Could a model receive ONLY this phase's content (plus the cumulative summary header from prior phases) and do the work correctly? If a phase relies on context from another phase that wasn't summarized forward, either move that context into the phase content or strengthen the prior summary spec. Self-contained means self-contained **for acting** — do not satisfy this check by copying grading criteria into the body; that violates check 12.

Quality checks (require judgement):

7. **Critical constraints at phase edges.** Within each phase, hard constraints (must/must-not, security/safety bounds) appear at the top or bottom of the phase content, not buried in the middle. Mid-content gets less attention; same lost-in-the-middle problem we're combating at the skill level.

8. **Phase ids read well in prompts.** They appear in `[FORCED TODO] Act on phase: X` prompts and in the cumulative summary header. Names like "Research" or "Write the Implementation Plan" read well; names like "step-2" or "Phase A" don't.

9. **Output instructions are concrete.** If the skill produces files, the SKILL.md should say where they go (relative to the model's cwd, not absolute paths to `/tmp/` — those get auto-rejected by OpenCode's permission system).

10. **Push-back rules.** If there's any version of the user's task where the model should refuse or scope down (vague request, scope explosion, already-done work), the SKILL.md should name those cases explicitly so the model can recognize them.

11. **Cross-phase data handoff goes through files.** Trace every phase that consumes content an earlier phase produced. The cumulative summary header carries only 1-4 summary bullets per prior phase, and the orchestrator prunes a verified phase's full conversation. So for each producer→consumer pair: the producer phase body must have a step that writes the content to a named file, and the consumer phase body must have a step that reads it. A phase body that says "use what the previous phase produced" with no file behind it fails this check — fix it by adding the write step to the producer and the read step to the consumer.

12. **No verification content in `s`/`m` act bodies.** Scan each `s`/`m` phase body for grading content: success-criteria checklists, "self-check" / "self-verify" blocks, instructions to re-read or confirm the finished work, rubric previews ("the verifier will check X"), or "if verification surfaces gaps…" reactions. All of that belongs in the phase's `verifications/<label>.md` — the runtime delivers it in the verify prompt, after acting. A body that also grades makes the verify turn look redundant; the model narrates verification without calling `forced_todo progress` and the phase stalls. `lint_eskill.py` errors on the obvious token patterns; catch paraphrased variants here. Fix by moving the content into the rubric file, not deleting it.

If gaps exist, fix them in place (still in the "acted" state — don't mark verified yet), then re-run this checklist. Mark verified only when you'd hand this SKILL.md to a stranger and trust them to run it end-to-end.

Final summary should record: any structural fixes made, any sections you considered adding/removing and why you decided as you did, and the canonical phase id list (post-strip) the model is expected to use in `roadmap`.
