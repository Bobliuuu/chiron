Verify the Phase 2 (Classify Existing Research) output. The phase produced `docs/research/.researcher/decision.md` from intent.md and a scan of `docs/research/`; this rubric checks that the decision was made correctly and recorded in the right shape.

Check each, in order:

1. **File exists.** `docs/research/.researcher/decision.md` is present and non-empty. FAIL if missing or empty.

2. **Action is one of three values.** The line immediately after `## Action` is exactly `create`, `append`, or `merge` (lowercase, no trailing punctuation, no extra words). FAIL on any other value, including variants like "Create new" or "MERGE".

3. **Target path is reasonable.** The line after `## Target path` is a path that:
   - starts with `docs/research/` (the deliverable directory),
   - ends with `.md`,
   - if action is `create`, the filename stem matches the slug listed under `## Slug`.
   FAIL if any of these are wrong.

4. **Slug matches intent.** The slug under `## Slug` equals the `## Category slug` value in `docs/research/.researcher/intent.md` byte-for-byte. FAIL if they differ.

5. **Every existing file was considered.** The `## Existing files considered` section lists every `.md` file currently under `docs/research/` that is not inside `.researcher/`. Compare by listing the directory yourself — FAIL if any file is omitted, or if a listed file does not actually exist.

6. **Rationale references the deciding evidence.** The `## Rationale` section must, in two to five sentences, name (a) any user merge hint from intent.md and how it was applied, and (b) for `merge`/`append`, the existing file matched and the topic overlap. FAIL if the rationale is generic ("decided to create a new file") rather than tied to the specific evidence.

7. **For `append` or `merge`, target file exists.** Re-read `docs/research/.researcher/decision.md` action. If it is `append` or `merge`, the target path must point to a file that already exists at verification time. FAIL if it points to a non-existent file (the user merge hint was wrong, and the model didn't fall through to `create` correctly).

8. **No merge-affecting typos.** The action word `create`/`append`/`merge` does not appear inside `## Rationale` as a near-miss (e.g., "merged together", "appended later" is fine in prose — only the actionable line under `## Action` must be exact).

Return one of:

- **PASS**, followed by a one-paragraph summary of which action was chosen, which existing file drove the decision (if any), and any borderline cases the writer considered.
- **FAIL**, followed by a numbered list of the failed checks above (e.g., `1, 6`), with one concrete sentence per failure naming the gap.
