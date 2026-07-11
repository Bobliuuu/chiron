# Research intent

## Topic
How blind users browse the web, and how to make Chiron (this project — a Next.js 15 + Supabase + OpenAI chat-first nonprofit event assistant) more accessible in general.

## Category slug
accessibility

## Scope
- Blind users' actual browsing experience: primary screen readers (NVDA, JAWS, VoiceOver), keyboard navigation, how semantic HTML and ARIA are perceived, common pain points on modern web apps.
- General accessibility applicable to Chiron: WCAG 2.2 AA principles (perceivable, operable, understandable, robust), keyboard operability, color contrast, focus management, motion, cognitive load, mobile/touch, low vision, motor impairments.
- Concrete, stack-specific guidance for Next.js 15 App Router, React 19, Tailwind, and Supabase-backed UI: semantic HTML patterns, ARIA use and abuse, `next/link` / `next/image` accessibility defaults, testing tools (axe-core, Lighthouse, Pa11y, screen reader smoke tests), and common React a11y pitfalls (auto-focus traps, missing alt text, focus loss on route change, streaming chat UI).
- Chat interface-specific concerns: live regions for streamed LLM responses, focus management between turns, copyable transcripts, alt text on event cards, accessible forms for event publishing.

## Out of scope
- Deep legal-compliance write-up (ADA Title III, Section 508, European Accessibility Act) — mention only as a "why this matters" framing, not as the core deliverable.
- Native iOS/Android app accessibility (Chiron is web-only).
- Standalone color-blindness deep dive beyond contrast guidance — touch briefly under low-vision.
- Auditing or accessibility testing of specific third-party libraries beyond what Chiron uses.

## Audience and depth
The reader is Chiron's developer (technical, comfortable with Next.js App Router, React 19, Tailwind, Supabase). Assume familiarity with HTML and component patterns; do not re-explain what a `<button>` or `useState` is. The write-up should be actionable — every recommendation should map to a concrete change in the codebase or a tool to install.

## Output target
docs/research/accessibility.md

## Merge hint
none

## Must-cover questions
- How do blind users actually browse the web today? Which screen readers dominate, what input devices do they use, and what makes a site usable vs. unusable to them?
- What do WCAG 2.2 AA's four POUR principles (perceivable / operable / understandable / robust) require at the code level, and which specific success criteria are most commonly violated in modern React apps?
- What accessibility issues are most likely present in a chat-first Next.js + Supabase app like Chiron right now? (AI streamed output, dynamic route changes, auth flows, event cards, forms.)
- Which Next.js / React / Tailwind patterns and libraries (semantic HTML, ARIA, `eslint-plugin-jsx-a11y`, React Aria, Radix primitives, axe-core in tests, Lighthouse CI) move the needle fastest for a small project?
- What are the chat-UI-specific a11y requirements (live regions, polite vs. assertive announcements, focus after submit, exposing streaming state to assistive tech, alt text on dynamically generated event cards)?

## Source preferences
Prefer 2025–2026 sources where possible. Authoritative origins: W3C WAI (WCAG, ARIA APG), MDN, WebAIM, the A11y Project, axe-core / Deque docs, Next.js official docs, official screen reader vendor pages (NV Access, Apple VoiceOver support, Freedom Scientific). Avoid SEO-style listicles unless they cite primary sources.