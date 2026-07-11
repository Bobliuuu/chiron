Re-read the implementation plan you just produced. Check it against the structure and quality bar required by Phase 4. Be honest — do not mark verified to advance the roadmap. Mark verified only when another developer could execute this plan without coming back with questions.

Structural checks (these are mechanical — easy to verify):

1. **Required sections present and in order:** Overview, Context/Background, Research Findings (with Options Considered, Decision Made, Risks Identified table), Implementation Phases, Files to Create/Modify table, Verification Checklist (Functional / Edge Cases / Integration), Open Questions, Appendix.

2. **File path with line numbers** appears for every step that modifies existing code. New files name their target path.

3. **Risks table is filled** with Likelihood, Impact, and concrete Mitigation per row.

Quality checks (require judgement):

4. **Specificity.** Every step describes a concrete action against a named file. "Add error handling" without saying where, what error, and what to do is a fail. Compare each step to the Bad/Good examples in the Writing Style Guidelines section of the SKILL.

5. **Code examples are complete where they need to be.** New interfaces, types, and key function signatures are written out. Don't hand-wave critical contracts.

6. **Decision rationale is written, not implied.** Each significant choice has a WHY that another reader can evaluate.

7. **Implementation order is dependency-correct.** No step references a file or function that the plan has not yet said to create. Walk the steps top-to-bottom and confirm.

8. **Verification Checklist items are testable.** Each checkbox should be a concrete test someone could run, not "make sure it works".

9. **Open Questions are real, not laziness.** If something is "TBD" that should have been decided in Phase 3, that's a gap — go back and decide.

If gaps exist, fix them in place (still in the "acted" state — don't mark verified yet), then re-run this checklist. Mark verified only when you would stake your name on this plan being executable as written.
