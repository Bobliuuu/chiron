# Research intent

## Topic
Speech-to-text (STT) options for adding a voice-input feature to Chiron's chat interface — a Next.js 15 + Supabase + OpenAI nonprofit event assistant.

## Category slug
speech-to-text

## Scope
- Realistic STT options for a small nonprofit web project: cloud APIs (OpenAI Whisper / gpt-4o-transcribe family, Deepgram Nova-3, AssemblyAI Universal, Google Cloud Speech-to-Text, Azure Speech, AWS Transcribe), browser-native Web Speech API, and self-hosted Whisper.cpp.
- Comparison axes: free-tier generosity, per-minute cost beyond the free tier, self-hosting cost in money and time, browser support, latency and streaming behavior, integration effort with the existing Next.js 15 + Supabase + OpenAI stack.
- Concrete code sketches for the recommended path: a Next.js App Router route handler that accepts a multipart audio upload and forwards it to OpenAI, plus a client-side `MediaRecorder` component that captures audio and posts it to the route.
- Browser and mobile gotchas: Firefox's missing `SpeechRecognition`, Safari / iOS quirks (Siri prerequisite, PWA breakage, `AudioContext` user-gesture requirement), `getUserMedia` permissions flow, audio format compatibility (webm/opus vs mp4/AAC).
- Privacy posture for a nonprofit community app: OpenAI's audio endpoint data controls (ZDR eligibility, no training use, no retention), DPA considerations, GDPR voice-recording requirements.

## Out of scope
- Text-to-speech (TTS) — this is the inverse direction; mention only where a vendor bundles both.
- Speaker diarization, language identification, or any non-transcription audio intelligence.
- Fine-tuning or custom acoustic models — the project has no labeled voice corpus.
- Live captioning for events (captioning one person's audio in real time on a stage) — out of scope; the feature is for chat-input only.

## Audience and depth
The reader is Chiron's developer (technical, comfortable with Next.js App Router, React 19, Tailwind, Supabase, OpenAI SDK). The write-up should be actionable — every recommendation should map to a concrete code path, vendor pricing page, or stack-specific configuration. No need to re-explain what `useState`, `fetch`, or `FormData` is.

## Output target
docs/research/speech-to-text.md

## Merge hint
none

## Must-cover questions
- List the realistic STT options for a small nonprofit web project, comparing free tiers, per-minute cost beyond them, and self-hosting (Whisper.cpp) cost in both money and time.
- How easy is it to integrate each top option with the existing Next.js 15 + Supabase + OpenAI stack? What new SDKs, secrets, or routes are needed?
- What is the latency and streaming behavior of each option? Does any support interim transcripts (live word-by-word) for real-time chat feel?
- What browser support, permissions, and iOS / Firefox quirks will trip us up? Are there SDK-vs-API-only trade-offs in the browser?
- What privacy posture (ZDR, DPA, GDPR) should a nonprofit community app worry about for voice input specifically?

## Source preferences
Prefer 2025–2026 sources where possible. Authoritative origins: MDN (Web Speech API, MediaRecorder, MediaDevices), OpenAI official docs (audio endpoint, pricing, data controls, ZDR), Deepgram / AssemblyAI / Google / AWS / Azure vendor pricing pages, Mozilla Bugzilla for Firefox status, Can I Use for browser compatibility, and recent privacy regulator guidance (AEPD, EDPB). Avoid SEO listicles unless they cite primary sources.
