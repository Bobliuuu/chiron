# Classification decision

## Action
`create`

## Target path
docs/research/speech-to-text.md

## Slug
speech-to-text

## Rationale
The user's merge hint is `none`, so the decision tree begins at branch 2 (filename match). The slug `speech-to-text` has no exact or kebab-case near-match against the existing stems `accessibility` or `email-sending`, so branch 3 (loose-topic match) applies. `accessibility.md` is the closest topical neighbor — STT voice input does help users with motor or visual impairments — but the existing file's frame is WCAG, screen readers, ARIA, and a11y testing workflows for blind users. Merging would force that file to absorb vendor pricing, Whisper API code sketches, and real-time-vs-batch UX trade-offs, breaking its structural fit. `email-sending.md` shares zero subject matter. With no valid candidates to merge into or append to, the only correct action is `create` at `docs/research/speech-to-text.md`.

## Existing files considered
- docs/research/accessibility.md — closest topical neighbor (voice input is an accessibility win), but the existing file is framed around WCAG/screen-reader/ARIA, not STT engineering trade-offs; ruled out for both filename match and loose-topic match.
- docs/research/email-sending.md — transactional email providers (Resend, free tiers, Supabase SMTP); zero overlap with STT; ruled out.

## Merge hint applied
none
