# Accessibility for a Blind-Friendly Chiron

> **TL;DR.** About 91% of blind computer users run a screen reader (NVDA, JAWS, VoiceOver, or TalkBack), and most of their experience is built on keyboard navigation plus an accessibility tree that the browser only exposes correctly when you use semantic HTML [1][2]. WCAG 2.2 AA adds nine new success criteria on top of 2.1, but 96% of detectable failures on real web pages still fall into the same six categories the WebAIM Million has tracked for half a decade — missing alt text, missing form labels, low contrast, empty links and buttons, and missing `lang` [2]. For Chiron specifically, the highest-leverage fixes start with `eslint-plugin-jsx-a11y` wired into the Next.js lint, the chat history rendered as a `role="log"` polite live region with `aria-busy` flipped off only after the assistant stream completes, plus a skip link and a labeled Send/Stop button. Animations should also be gated behind `prefers-reduced-motion` via Tailwind's `motion-reduce:` variants.

## How blind users actually browse the web

The most recent industry-wide survey is WebAIM Screen Reader User Survey #10, collected from December 2023 through January 2024 across 1,539 respondents [1]. It is the largest dataset of its kind. On a "primary desktop reader" basis, JAWS leads at 40.5%, NVDA at 37.7%, and VoiceOver at 9.7%. On a "commonly used" basis (users running more than one), NVDA is first at 65.6% to JAWS's 60.5%. JAWS still dominates North America (55.5% primary) because of enterprise and government procurement; NVDA dominates lower-income regions because it is free. Mobile is a different market entirely: 91.3% of blind screen reader users also run one on a phone, and VoiceOver on iPhone leads mobile at 70.6%, with TalkBack on Android at roughly 35% [1].

The three desktop readers are not interchangeable for a developer. NVDA and JAWS read the Windows accessibility tree through MSAA/IA2 and UIA, then expose the page via a "virtual buffer" (browse mode) where arrow keys move a virtual cursor independently of keyboard focus. VoiceOver on macOS and iOS walks the live AX tree directly, with a VoiceOver cursor only loosely coupled to keyboard focus, so patterns that mutate the DOM invisibly tend to "work" in JAWS and NVDA but break in VoiceOver [11]. JAWS's browse mode also applies heuristics to infer missing form labels from nearby text, while NVDA reads the tree more literally — which means JAWS may mask WCAG 4.1.2 failures that NVDA surfaces [11].

Blind users navigate with a small set of keyboard primitives. Tab and Shift-Tab move between focusable elements, so a visible focus indicator (WCAG 2.4.7) is mandatory. Headings need to live in a strict H1→H6 hierarchy so the H-key outline in JAWS, NVDA, and the VoiceOver rotor lets users skim the page [5][7]. Landmarks (`<main>`, `<nav>`, `<aside>`) feed the landmark list in VoiceOver's rotor (VO+U) and the region list in JAWS/NVDA. For status updates, `aria-live="polite"` (or `role="status"`) queues announcements at the next idle moment, while `role="alert"` (`aria-live="assertive"`) interrupts the user mid-sentence [7][9]. The ARIA Authoring Practices Guide is the canonical reference for composite widgets: tab moves between widgets, arrow keys move inside them via roving `tabindex` or `aria-activedescendant`, and modals must trap focus, close on Escape, and return focus to the trigger [5].

On touch, VoiceOver uses multi-finger swipes plus a two-finger rotor twist to change granularity. TalkBack uses single-finger and right-angle "L" gestures with a Reading Controls menu, and it lacks the rotor, help mode, and magic tap that VoiceOver provides. Gesture behavior varies by Android OEM. VoiceOver on iOS reads heading levels natively; TalkBack largely does not, so a clean heading hierarchy that works on iOS may be invisible on Android.

## WCAG 2.2 AA at the code level

WCAG 2.2 (W3C Recommendation, October 2023) keeps the four POUR principles introduced in 2.0 and adds nine new success criteria on top of the 2.1 set [3][4]. **Perceivable** maps in code to text alternatives on images, captions or transcripts for media, color contrast of at least 4.5:1 for body text, and content that reflows at 320 CSS pixels without horizontal scrolling. **Operable** is enforced through keyboard reachability of every interactive element, a visible focus indicator, and — new in 2.2 — a 24×24 CSS-pixel minimum hit target (2.5.8), a non-dragging alternative for any dragging interaction (2.5.7), and a focus indicator that is not hidden by author-created content (2.4.11) [4]. **Understandable** is mostly language declaration, consistent navigation, no redundant re-entry of data already given, and an authentication path that does not require cognitive function tests (3.3.8). The fourth principle, called **Robust** in the spec, is satisfied by valid semantic HTML, with ARIA used only when the platform lacks the right element; semantics-first is the rule.

The nine new 2.2 criteria, in one-line code form: 2.4.11 (focused element not fully obscured, AA), 2.4.12 (focused element fully visible, AAA), 2.4.13 (focus indicator perimeter ≥ 2 CSS pixels and ≥ 3:1 contrast, AAA), 2.5.7 (single-pointer alternative for drag, AA), 2.5.8 (24×24 CSS-pixel targets, AA), 3.2.6 (help mechanism in same relative order, A), 3.3.7 (don't re-ask for info already given, A), 3.3.8 (no cognitive function tests in auth, AA), 3.3.9 (no object-recognition auth, AAA) [4]. Chiron should target the AA set; the AAA criteria are aspirational.

WebAIM's Million 2025 report scanned the top one million home pages and found detectable WCAG failures on 94.8% of them, with an average of 51 errors per page [2]. The failure distribution has been almost identical for five years: low-contrast text at 79.1%, missing alt text at 55.5%, missing form input labels at 48.2%, empty links at 45.4%, empty buttons at 29.6%, missing `lang` attribute at 15.8%. Pages that use ARIA correlate with about twice as many errors; wrong ARIA is worse than no ARIA [2]. In a React codebase these map to concrete patterns: `<img>` with no `alt`, controlled `<input>` with no `<label htmlFor>`, click handlers on `<div>` instead of `<button>`, modals with no focus trap, route changes that drop focus to `<body>`, and animations that ignore `prefers-reduced-motion`.

## Where Chiron is most likely to fail right now

Chiron has three a11y hotspots a smaller app would not have: a streaming LLM response, dynamic route changes between conversations, and Supabase-driven event cards with per-card actions.

The Vercel AI SDK's `useChat` hook streams assistant tokens into React state on every chunk via Server-Sent Events, exposing a `status` field (`submitted` → `streaming` → `ready` | `error`) and a `stop()` function [21]. If the chat region is rendered as `<div>{message.text}</div>` directly, the DOM mutates 5–20 times per second. With `aria-atomic="true"` on the region, screen readers re-announce the entire accumulated response on every token, producing a "re-announcement storm"; with `aria-atomic="false"`, NVDA, JAWS, and VoiceOver drop updates under load, so the user hears a fragmented reply, or nothing at all [11][23]. The fix is structural. Render the chat history as `role="log"` (implicit polite, non-atomic), set `aria-busy="true"` on the in-flight message while `status === "streaming"`, then announce "Response complete" once via a sibling polite region when `status === "ready"` [6][23].

Dynamic route changes after submit are the second risk. Next.js App Router ships a built-in `next-route-announcer` (`aria-live="assertive"`, `role="alert"`) that reads `document.title` first, then the first `<h1>`, then the path [12]. A known limitation is that the announcer only fires when `document.title` changes, so navigating `/chat/new` to `/chat/[id]` with the same page title is silent. Chiron should set a unique `document.title` per chat via the Next.js metadata API and move focus to a `<h1 tabindex="-1">` on the new route, since the App Router does not auto-restore focus on client-side navigation [12][13].

Supabase Auth's magic-link flow has three documented a11y pitfalls: cross-device session loss on iOS because the OS opens the email link in Safari rather than the requesting Chrome, no audible or focusable signal when the link returns and the session is established, and OAuth popups that frequently fail to return focus to the opener. Concretely, Chiron should present a "Check your email — link expires in 10 minutes" status with `role="status"` `aria-live="polite"`, move focus to a post-verification heading on the callback route, and prefer Supabase's redirect-based OAuth over `skipBrowserRedirect: true` so the redirect back to the app preserves focus context.

Event cards rendered from Supabase need `role="article"` with `aria-labelledby` pointing to the event title and a visible `aria-describedby` description. Each per-card action needs a descriptive accessible name — "Click here" is never acceptable. Forms for publishing an event must pair `aria-invalid="true"` with `aria-describedby` pointing to inline error text per WebAIM and ARIA21 [22], and date pickers should follow the WAI-ARIA Date Picker Dialog pattern (a `role="dialog"` modal with `aria-live="polite"` on the month and year header). Chat history should be an `<ol>` of conversation links with `aria-current="page"` on the active conversation so screen-reader users know which chat is open.

## Quick wins: libraries and patterns for Next.js + React + Tailwind

Wire `eslint-plugin-jsx-a11y` into Next.js's lint config first. `create-next-app` already adds `eslint-config-next`, which bundles the `jsx-a11y` recommended rules; extend with `'plugin:jsx-a11y/strict'` (or `flatConfigs.strict` in flat config) to catch `anchor-is-valid`, `click-events-have-key-events`, `no-autofocus`, `interactive-supports-focus`, and `label-has-associated-control` at lint time [14]. Failing CI on a new `anchor-is-valid` rule is worth a one-day ticket because it forces you to use `<button>` and `<a href>` instead of `<div onClick>`.

For unstyled accessible primitives, the three practical choices for a small Next.js + Tailwind project are Radix Primitives (MIT, ~10.6 KB per package, the largest ecosystem via `shadcn/ui`, `asChild` composition, but must run inside a `"use client"` boundary) [19]; React Aria (Apache-2.0, deepest ARIA fidelity and built-in i18n, heavier at ~241 KB, requires a client `RouterProvider` wired to `next/navigation` in `app/providers.tsx`) [20]; or Headless UI (~60 KB, 15 components, MIT, the most Tailwind-ergonomic but smallest surface). For a chat-first app where most controls are custom anyway, Radix's Dialog and Tooltip cover the highest-leverage primitives and skip the bundling weight of a full ARIA library.

`next/link` and `next/image` enforce accessibility by default: `next/image` warns at dev time when `alt` is missing and supports `alt=""` for decorative images [12]; `next/link` renders an `<a>`, so any rendered text becomes the accessible name. Custom wrappers that pass a `<button>` or non-anchor child break the `anchor-is-valid` rule, which is why shadcn-style wrappers live in a Client Component.

Tailwind ships accessibility utilities that are easy to miss:

- `sr-only` for visually-hidden skip links and live regions
- `focus-visible:` for keyboard-only focus rings
- `motion-reduce:animate-none` paired with `motion-safe:` to gate animations behind `prefers-reduced-motion`
- `contrast-more:` and `forced-colors:` variants to respect Windows High Contrast Mode
- `dark:` to honor `prefers-color-scheme` [17]

For Lighthouse CI in GitHub Actions, drop in `treosh/lighthouse-ci-action` with a `lighthouserc.json` asserting `"categories:accessibility": ["error", { "minScore": 1 }]` and `numberOfRuns: 3` (the median reduces single-run noise) [18].

## Chat UI accessibility: live regions, focus, streaming

The WAI-ARIA APG does not contain a dedicated "Chat" pattern as of mid-2026; the canonical chat-history structure is built from `role="log"` plus a labeled text input [5][6]. `role="log"` has implicit `aria-live="polite"` and implicit `aria-atomic="false"` [6][8], meaning polite-level, idle-only announcements of just the newly appended message — exactly what a chat thread wants. Use `role="alert"` (`aria-live="assertive"`, `aria-atomic="true"`) sparingly for blocking errors such as "session expired"; use `role="status"` (`aria-live="polite"`, `aria-atomic="true"`) for short confirmations like "Message sent" [9]. The W3C ARIA23 technique and the MDN `log_role` reference both require the region to have an accessible name via `aria-labelledby` or `aria-label` [6][8].

Focus management between turns is straightforward in principle but rarely implemented in templates. After the user submits, focus stays on (or returns to) the input so the user can type a correction. On assistant completion, focus stays on the input and a polite live region announces the response is ready. On error, move focus to an inline error heading so the user is not stranded. A skip link as the first focusable element jumping to the message input satisfies WCAG 2.4.1 and is mandatory.

Streaming state must be exposed to assistive technology as a bounded announcement, not as a per-token read. Announce "Assistant is typing" once when streaming begins, then "Response complete" once when `status === "ready"`. The `useChat` `stop()` function should be wired to a button that swaps the Send affordance for a Stop icon while `status === "streaming"`, with `aria-label="Stop response generation"` per the Firefox specification and the AuditBuffet pattern catalog [25][24]. "Copy transcript" and similar per-message actions need explicit `aria-label`s; the openai/chatkit-js audit found copy buttons silently unlabelled in a production SDK [24].

For event card images, generate alt text server-side from event title, date, and venue (e.g., ``alt={`Poster for ${event.title}, ${event.date} at ${event.location}`}``) and never rely on filename-only alts. Skeleton and loading states should use `aria-busy="true"` on the chat region rather than relying on `role="status"` text updates, which get queued behind the screen reader's current speech and feel laggy. Voice-control compatibility (the Web Speech API) is partial. Chrome and Edge ship it. Safari 14.1+ supports single-shot recognition only. Firefox has none. Never gate core flow on dictation. All actionable controls must use real `<button>` elements so voice-control and screen-reader activation paths converge.

## Testing and ongoing checks

Automated tools catch about 30–40% of WCAG issues, but they catch the easy ones reliably. Wire `vitest-axe` (a Vitest fork of `jest-axe`) into component tests with `expect(await axe(container)).toHaveNoViolations()` for every component that renders meaningful UI [15]. For component integration, run `@axe-core/playwright` in E2E tests with `AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()` and assert `expect(violations).toEqual([])` [16]. axe-core's color-contrast rule is disabled under JSDOM, so contrast must be verified in a real browser via Playwright; that is exactly what the Playwright integration gives you.

Beyond automation, schedule a 30-minute manual screen-reader smoke test each release. In NVDA + Firefox and in VoiceOver + Safari, walk through:

- Submitting a chat query
- Opening an event card
- Publishing a new event

Does the streaming response make sense? Does focus land somewhere sensible after navigation? Can the chat history list be skimmed via the heading or region shortcut? The WebAIM SR Survey and the WebAIM Million together act as a baseline; when those numbers move on Chiron's own pages, the work is moving in the right direction.

## References

1. WebAIM. "Screen Reader User Survey #10 Results." WebAIM, 2024. https://webaim.org/projects/screenreadersurvey10/. Accessed 2026-07-11.
2. WebAIM. "The WebAIM Million — 2025 Report." WebAIM, 2025. https://webaim.org/projects/million/2025. Accessed 2026-07-11.
3. W3C WAI. "Web Content Accessibility Guidelines (WCAG) 2.2." W3C. https://www.w3.org/TR/WCAG22/. Accessed 2026-07-11.
4. W3C WAI. "What's New in WCAG 2.2." W3C. https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/. Accessed 2026-07-11.
5. W3C WAI. "ARIA Authoring Practices Guide (APG)." W3C. https://www.w3.org/WAI/ARIA/apg/. Accessed 2026-07-11.
6. W3C WAI. "ARIA23: Using role=log to identify sequential information updates." WCAG 2.1 Techniques. https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA23. Accessed 2026-07-11.
7. MDN. "ARIA live regions." https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions. Accessed 2026-07-11.
8. MDN. "ARIA: log role." https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/log_role. Accessed 2026-07-11.
9. MDN. "ARIA: aria-live attribute." https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live. Accessed 2026-07-11.
10. MDN. "ARIA: aria-atomic attribute." https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-atomic. Accessed 2026-07-11.
11. Adrian Roselli. "Live Region Support." 2026. https://adrianroselli.com/2026/01/live-region-support.html. Accessed 2026-07-11.
12. Next.js. "Architecture: Accessibility." https://nextjs.org/docs/architecture/accessibility. Accessed 2026-07-11.
13. Next.js. "Improving Accessibility — App Router Learn Track." https://nextjs.org/learn/dashboard-app/improving-accessibility. Accessed 2026-07-11.
14. jsx-eslint. "eslint-plugin-jsx-a11y." https://github.com/jsx-eslint/eslint-plugin-jsx-a11y. Accessed 2026-07-11.
15. Nick Colley. "jest-axe / vitest-axe." https://github.com/NickColley/jest-axe. Accessed 2026-07-11.
16. Playwright. "Accessibility testing." https://playwright.dev/docs/accessibility-testing. Accessed 2026-07-11.
17. Tailwind CSS. "User Preference Variants — motion-safe / motion-reduce / contrast-more / forced-colors." https://tailwindcss.com/docs/transition-property. Accessed 2026-07-11.
18. treosh. "Lighthouse CI Action." https://github.com/treosh/lighthouse-ci-action. Accessed 2026-07-11.
19. Radix UI. "Server-side rendering — Radix Primitives." https://www.radix-ui.com/primitives/docs/guides/server-side-rendering. Accessed 2026-07-11.
20. React Aria. "Framework setup / Client-side routing." https://react-aria.adobe.com/frameworks. Accessed 2026-07-11.
21. Vercel AI SDK. "useChat." https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat. Accessed 2026-07-11.
22. WebAIM. "Usable and Accessible Form Validation and Error Recovery." https://webaim.org/techniques/formvalidation/. Accessed 2026-07-11.
23. Tianpan.co. "The Accessibility Gap in AI Interfaces Nobody Is Shipping Around." 2026. https://tianpan.co/blog/2026-04-17-ai-accessibility-streaming-screen-readers. Accessed 2026-07-11.
24. openai/chatkit-js. "Issue #114: Accessibility issues found in ChatKit." GitHub. https://github.com/openai/chatkit-js/issues/114. Accessed 2026-07-11.
25. Mozilla Bugzilla. "Bug 2029204 — Add stop generation button for assistant chat." https://bugzilla.mozilla.org/show_bug.cgi?id=2029204. Accessed 2026-07-11.