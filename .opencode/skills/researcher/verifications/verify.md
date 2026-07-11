Verify the Phase 4 (Verify Output) verdict against the deliverable. This rubric runs as a fresh-eyes subagent check: the verdict WAS the act, but this file re-runs the same structural checks mechanically to catch ratification slips. The subagent reads three files: `docs/research/.researcher/intent.md`, `docs/research/.researcher/decision.md`, and the deliverable at the target path.

Check each, in order:

1. **Structure check.** The deliverable has, in order: a top-level `# Title`, a `> **TL;DR.**` blockquote, at least three `## ` section headings, and a `## References` section. FAIL if any are missing or out of order. (The TL;DR marker must be `> **TL;DR.**` exactly — the literal bold `TL;DR.` prefix matters for downstream tooling that parses these briefs.)

2. **Reference presence.** At least one inline reference marker (e.g., `[1]`) appears in the prose OR the `## References` section has at least one numbered entry. FAIL if there are zero references and intent.md did not explicitly say "no sources needed".

3. **Reference quality.** Each numbered reference in `## References` includes a URL (or DOI) and an access date. Spot-check 1-2 URLs by curling them or visually inspecting formatting. FAIL if any URL is `example.com`, `TBD`, or otherwise a placeholder.

4. **Must-cover coverage.** Re-read the `## Must-cover questions` list in intent.md. Each question must map to a section in the deliverable that addresses it. If a question has no obvious home, FAIL and name the missing question.

5. **Audience match.** Re-read `## Audience and depth` in intent.md. Compare against the prose register. A technical reader expects terse, direct prose; a non-technical reader expects plain language. FAIL if the register is clearly off — name how (e.g., "uses jargon without explanation in three places when intent.md said non-technical audience").

6. **Merge correctness (CONDITIONAL).** Only applies when decision.md's action is `append` or `merge`.
   - For **`append`**: the existing content above the new section is unchanged from what was there before this skill run (re-read docs/research/ HEAD if available, or rely on the writer's stated claim plus a check that pre-existing section headings are still present and in original order). The new section heading must be dated `## Update — YYYY-MM-DD: <descriptor>`. FAIL if existing content was modified, the new section isn't dated, or the new section duplicates an existing topic.
   - For **`merge`**: the recomposed file reads as ONE coherent document, not stitched halves. An `## Update history` note is present at the bottom with a date and one-line description of what changed. FAIL if old content is duplicated rather than absorbed, or if the file reads as two documents glued together.

7. **TL;DR substance.** The TL;DR must be 2-4 sentences with the actual takeaway, NOT a placeholder like "This document covers X" or "Below is a research summary on X". FAIL on placeholders.

8. **Length sanity.** Each top-level section has 1-3 short paragraphs of real prose. FAIL on one-line sections that don't earn their heading, or on sections that ramble without substance.

9. **Voice check.** Three sub-checks, all mechanical:
   - **Banned phrases.** Grep the deliverable (case-insensitive) for: "it is important to note", "it is worth noting", "furthermore", "moreover", "in conclusion", "delve", "leverage", "robust", "pivotal", "underscores", "landscape", "realm", "navigate the complexities", "deserve a special callout", "deserves a special callout", "the honest answer", "the honest caveat", "notably". FAIL on any hit outside a direct quote from a source or the `## References` section (source titles don't count), and name the phrase(s) found.
   - **Citation density.** Scan two body paragraphs at random. If a paragraph has a `[n]` marker on every sentence, or any sentence carries more than two markers, FAIL and quote the offending sentence.
   - **Sentence rhythm.** In the same two paragraphs, check sentence-length variation: at least one sentence under ~10 words per paragraph, and no run of three consecutive sentences of near-identical length and shape. FAIL and name the paragraph if the rhythm is uniform.
   - **Scaffold repetition.** Grep (case-insensitive) for connective scaffold phrases that recur: any non-technical 3+ word phrase appearing 3+ times in body prose (classic offenders: "the cost is", "the tradeoff is", "the bottleneck is", "the win is", "the discipline that matters"). Technical terms and proper nouns don't count. FAIL and name the phrase.
   - **Template paragraphs.** Scan paragraph and section openers. FAIL if 3+ paragraphs in one section share the same scaffold shape (e.g., every paragraph is `**Label.** definition, cost, bottleneck`), or if two or more sections open with the same enumeration-promise shape ("Four families…", "Five mechanisms…").
   - **Duplicated claims.** If the same system, paper, or result is explained in two different sections with near-identical sentences, FAIL and name both locations. A brief back-reference is fine; a re-introduction is not.

Return one of:

- **PASS**, followed by a one-paragraph summary of strengths and the single biggest concern (or "no concerns" if the deliverable is genuinely clean).
- **FAIL**, followed by a numbered list of the failed checks (e.g., `1, 4 (missing question: "compare OAuth2 grant types")`) with one concrete sentence per failure.
