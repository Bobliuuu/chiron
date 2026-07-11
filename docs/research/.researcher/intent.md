# Research intent

## Topic
Easiest free way to send emails from this Next.js 15 + Supabase project (Chiron — nonprofit community event assistant). Free tier, minimal integration friction.

## Category slug
email-sending

## Scope
- Transactional email use cases most relevant to a community event app: account auth emails (sign-up confirmation, password reset, magic link), event notifications (new event posted, RSVP confirmations), and admin contact messages.
- Free-tier options that work without a custom domain (or with one) and that integrate cleanly with Next.js App Router and Supabase.
- Concrete recommendation with a minimal integration sketch.

## Out of scope
- Marketing/bulk email platforms (Mailchimp, Sendgrid Marketing Campaigns, etc.) — this is an app, not a newsletter.
- Self-hosted SMTP relays (Postfix, Mailcow, etc.) — explicitly not "easy" for the user.
- Paid tiers in depth — only mention as a "what you hit when you outgrow the free tier" footnote.

## Audience and depth
The developer of this project. Technical, comfortable with Next.js App Router, Supabase, and reading API docs. Should compare options concretely (free quota, SDK shape, Supabase compatibility) and end with a clear pick, not a balanced survey.

## Output target
docs/research/email-sending.md

## Merge hint
none

## Must-cover questions
- What are the best free-tier email-sending services in 2026 for a Next.js + Supabase app?
- Which one has the lowest integration friction (best SDK for Next.js App Router, ideally no separate SMTP config, ideally works with Supabase Auth out of the box)?
- What are the real free-tier limits (emails/day, emails/month, sender-domain requirement)?
- What does a minimal "send an email" code sketch look like in this stack?
- Which option should Chiron use right now, and when does the team need to revisit?

## Source preferences
None. General web sources (official docs, vendor pricing pages, recent dev-blog comparisons) are fine. Prefer sources from 2025–2026 so free-tier limits and SDK state are current.