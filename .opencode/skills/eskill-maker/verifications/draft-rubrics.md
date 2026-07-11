Re-read each `verifications/<label>.md` file you just produced. Check them as a set against the rubric-shape spec, and check each individual file against the phase it serves.

Reference: [references/contract-summary.md](../references/contract-summary.md) §"Verification override files" and [references/examples/plan-architect/verifications/](../references/examples/plan-architect/verifications/) (bundled inside this skill) for canonical examples (`research.md`, `options.md`, `write.md`, `review.md`).

Coverage checks. **Use tools here, not memory** — coverage is exactly the kind of "did I do enough work" check that authorship bias makes unreliable as a self-verify:

1. **Mechanical enumeration.** Run the lint script: `python .opencode/skills/eskill-maker/scripts/lint_eskill.py <new-skill-path>`. Read every `INFO:` line. Any INFO of the form *"Phase 'X' has 's.phase: <label>' marker but no verifications/<label>.md file"* is a missing rubric — even though the runtime will tolerate it (falling through to phase-content as the rubric), it's almost certainly an authoring oversight. Write the missing rubric file in this same turn before marking verified.

2. **One file per labeled `s.phase` / `m.phase`.** After fixing any missing files in step 1, list the verifications directory (`ls .opencode/skills/<skill-name>/verifications/` or use the Glob tool). Cross-reference against the SKILL.md's marker comments — every `s.phase: <label>` and `m.phase: <label>` must have its `<label>.md` file present. `n.phase` markers don't get rubric files (runtime ignores them).

3. **No orphan files.** Files in `verifications/` that don't correspond to any labeled phase in the SKILL.md are noise. Either delete them or make sure they're intentional (e.g., shared rubric referenced from another file).

4. **No empty files.** Empty rubric files cause runtime fallthrough to "verify against phase content above" — usually not what the author wanted. Lint reports these as ERRORs.

Per-file shape checks:

4. **Each rubric reads as a numbered checklist + PASS/FAIL output spec.** The structure the bundled plan-architect example (`references/examples/plan-architect/verifications/`) uses: brief framing paragraph, "Check each, in order:", numbered checks with specific criteria, "Return one of: **PASS** ... / **FAIL** ...". Free-form prose rubrics drift; the numbered-checklist form keeps verifications focused.

5. **Each check is testable.** A check like "the research is good" is unverifiable. A check like "every significant decision has a cost-benefit analysis with explicit costs, benefits, risks, and rationale tied to the user's goals" is testable. Each check should describe what evidence makes it PASS and what makes it FAIL.

6. **PASS output specifies what the summary must contain.** Not just "PASS" — but "PASS, followed by a one-paragraph summary of X". This drives the model toward summaries that carry forward the right information for downstream phases (which only see the summary, not the original work).

7. **FAIL output requires actionable gaps.** Each FAIL gap should name a specific defect AND a concrete fix. "More research needed" fails this; "compare option Y against the chosen X using the same cost/benefit/risk frame, since alternatives weren't surfaced" passes.

8. **`m.phase` rubrics are self-contained.** A subagent receives only the verify prompt + the rubric body — no other context, no other files, no parent skill state. Re-read each `m.phase` rubric pretending you have nothing else. Does it explain what to look for, what counts as evidence, and what the expected output shape is? If it references "see the full SKILL.md" or "check the prior phase's notes", the subagent can't follow that — fix.

9. **`s.phase` rubrics can reference the phase content.** The model self-verifying has the phase content in its context window already. Self-rubrics can say "compare against the structure spec in this phase's content" without being self-contained the way `m.phase` rubrics need to be.

10. **Fix-loop rubrics are explicit when needed.** If a phase is meant to loop until a script passes (e.g., `lint`), the rubric should say so explicitly: "PASS only when the most recent script invocation in this turn exited 0. If non-zero, fix the errors and re-run before marking verified."

If gaps exist, edit the rubric files in place, then re-run this checklist. Mark verified only when each rubric would let a reasonable reviewer or subagent reach a defensible PASS/FAIL verdict from the artifacts the phase produces.

Final summary should record: which phases have rubric files vs. fall back to phase-content, which rubrics are self-contained vs. reference-the-phase-content, and any rubric you intentionally left thin (and why).
