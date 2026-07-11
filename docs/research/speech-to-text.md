# Speech-to-Text for Chiron's Chat Input

> **TL;DR.** For Chiron, the easy path is OpenAI's `gpt-4o-mini-transcribe` API — reuse the existing `openai` SDK, pay $0.003/min, no new vendor, no new DPA. Layer the browser-native Web Speech API on top as a zero-cost progressive enhancement for instant interim transcripts, and the OpenAI route becomes the universal fallback for Firefox (which has no `SpeechRecognition`) and privacy-conscious users. Privacy is fine — the audio endpoints are ZDR-eligible and not used for training.

## The shortlist

Eight STT options show up repeatedly when developers shop for voice input in 2026: Web Speech API (free, browser-native), OpenAI Whisper API, Deepgram Nova-3, AssemblyAI Universal, Google Cloud Speech-to-Text, Azure Speech, AWS Transcribe, and local Whisper.cpp. The table that matters is free tier and per-minute cost beyond it.

Web Speech API is free and unmetered but sends audio to the browser vendor's servers (Google on Chrome/Edge, Apple on Safari) and only works on Chromium-family and Safari browsers [2]. The cloud vendors split into two camps on free tier generosity: Deepgram gives a one-time $200 credit good for roughly 45,000 minutes of Nova-3 pre-recorded transcription [4], and AssemblyAI offers 185 hours of pre-recorded and 333 hours of streaming per month on its free tier [5]. Azure gives 5 audio hours per month for 12 months [6], and Google and AWS each cap at 60 minutes per month [7][8]. All three are barely enough to evaluate; a busy community event with a handful of attendees voice-typing longer messages could blow through Google's 60 minutes in an evening. OpenAI's audio endpoints have no free tier at all — you pay from minute one [9].

Two practical filters narrow this further. The first is whether the dev team already has a vendor relationship: Chiron pays OpenAI for GPT, so reusing that client for STT avoids a second API key and a new DPA. The second is format support: Chrome's `MediaRecorder` produces `audio/webm;codecs=opus` by default [12], and OpenAI's `/v1/audio/transcriptions` accepts webm directly [13], so no audio conversion is needed. Deepgram and AssemblyAI also accept webm, so any of the three cloud picks would work without conversion.

Self-hosting Whisper.cpp is the third cost axis. At Chiron's expected volume — a community-event app generating a few hundred voice minutes per month — it loses decisively to the API [42]. At OpenAI's $0.003/min, that volume is under $20 a month [9]; the cheapest 2026 cloud GPU rentals run $0.27-0.80/hr (Vast.ai RTX 4090, RunPod Community, Modal L4) [41][43], so a single reserved GPU already costs more than the entire API bill. The math inverts around 360-700 audio hours per month, which most small nonprofits will never reach [42]. Setup time is better than it used to be — `faster-whisper-server` via Docker Compose is a five-minute bring-up [44], and Modal or Replicate offer one-click Whisper deployments with a $30/month Modal free credit [46]. The catch is DevOps overhead. GPU driver updates, capacity planning, model redeploys, and monitoring typically add two to three times the GPU line item on top of the compute bill [45]. For a single-developer nonprofit project, the API stays the default; revisit self-hosting only if voice volume crosses several thousand minutes a month, or if the team is already running a GPU server for other workloads [40].

## Why gpt-4o-mini-transcribe is the easy pick

The existing OpenAI Node SDK is already in `package.json` and the project has a paid OpenAI account, so adding STT does not need a new vendor, a new secret, or a new billing relationship [14]. The route handler that accepts a multipart upload and forwards it to OpenAI is roughly 20 lines. The model name itself is the only meaningful choice — `gpt-4o-mini-transcribe` is the cheapest ($0.003/min), supports the same 25 MB file cap as Whisper, and accepts the same audio formats [10][13].

Two caveats matter. First, OpenAI does not offer a free tier on the audio endpoints, so every minute of voice input costs something — at community-event scale this is negligible (a 5-minute query is roughly 1.5 cents) [9]. Second, both `gpt-4o-transcribe` and `gpt-4o-mini-transcribe` only return JSON, not SRT or VTT; for plain chat input this is irrelevant, but if the team later wants timestamped captions for accessibility, `whisper-1` is the right pick [15].

## Latency, streaming, and the Web Speech API trade-off

Whisper and the gpt-4o-transcribe family are batch endpoints — you upload a complete audio file and get a single transcript back. The 25 MB cap and 30-second chunk design make true streaming impossible without a hacky client-side buffer [16][17]. For a 5-second chat query the user-visible latency is roughly network round-trip plus processing, typically one to three seconds end-to-end.

Cloud vendors that stream over WebSocket (Deepgram Nova-3, AssemblyAI Universal-Streaming) hit sub-300ms time-to-first-token with partial transcripts every ~100ms [18][19]. Deepgram's Nova-3 streaming pricing is roughly $0.0077/min during a 2026 promo [4]. For a chat input box where the user taps a mic, speaks, and waits for the transcript to populate, two-to-three-second latency is acceptable but not delightful; sub-second streaming feels live. If the team wants live-feeling interim transcripts, Deepgram is the upgrade path.

The browser-native Web Speech API is the third option, and it sits between the two cloud paths on every axis. It streams partials continuously with `interimResults: true` set [20], so the user sees text appearing word-by-word like an autocomplete. It is free and unmetered. The cost is that audio goes to the browser vendor's server (Google for Chrome, Apple for Safari), with no DPA possible and no privacy guarantee [1][21]. Treat it as a progressive enhancement: use it when available, fall back to the OpenAI route when it is not.

## Browser support, permissions, and the Firefox gap

Web Speech API's `SpeechRecognition` works on Chrome 33+ desktop and Android, Edge 79+, and Safari 14.1+ desktop / 14.5+ iOS via the prefixed `webkitSpeechRecognition` constructor [2]. Safari additionally requires Siri to be enabled in system settings and is broken inside standalone installed PWAs [22][24]. Firefox does not expose `SpeechRecognition` to website content — Mozilla's bug 1248897 has been wontfix for years, and the on-device replacement (bug 1940906) has not landed [25][26]. Roughly 3% of desktop users run Firefox; for them the mic button silently produces no text unless a cloud fallback exists.

`navigator.permissions.query({name: 'microphone'})` is now widely supported (Chrome 132+, Safari 16+, Firefox 118+) and lets the UI ask "Allow microphone?" before the user even taps the mic [27][28]. `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 } })` is the standard constraint set for STT-quality audio [29][30]. The audio blob format varies by browser: Chrome and Firefox produce `audio/webm;codecs=opus`, Safari produces `audio/mp4` (AAC) since 16.6 [31][32]. Always call `MediaRecorder.isTypeSupported()` before constructing the recorder and fall back to whatever the browser offers.

The recommended UX is a push-to-talk button with five visible states (idle → requesting-permission → recording → processing → idle/error) rendered as a pulsing red dot or animated waveform, with `aria-pressed` set and a polite live-region announcement so screen reader users hear "Recording started" and "Recording stopped" [33]. Use a separate, short label for each state. On iOS Safari, call `getUserMedia` only inside the click handler, not from a promise callback — the `AudioContext` must be created and resumed from a user gesture or audio will silently fail [34].

## Privacy posture for a nonprofit

OpenAI's `/v1/audio/transcriptions` endpoint is one of the more privacy-friendly surfaces in the API. The data controls table marks it as `Data used for training: No`, `abuse monitoring retention: None`, `application state retention: None`, and `ZDR-Eligible: Yes` [35]. The 30-day abuse-monitoring window that applies to chat/responses endpoints does not apply to audio. For organizations that want a hard contractual no-retention guarantee, OpenAI's Zero Data Retention amendment is available on the audio endpoints with a sales contract [36][37].

Two regulatory notes. First, voice recordings are personal data under GDPR, and the Spanish data-protection authority's April 2026 guidance is the most current EU view: controllers must do processor diligence (reuse, training, retention, location), obtain per-session consent rather than generic notice, and treat transcripts as not neutral [38]. Second, OpenAI confirms API inputs are not used for training unless explicitly opted in [39]. For a US-only deployment, OpenAI's standard DPA plus the ZDR amendment is sufficient. For an EU-resident deployment, point OpenAI at the EU regional endpoint (`eu.api.openai.com`) and rely on OpenAI's existing SCCs.

The Web Speech API is the privacy anti-pattern. Audio goes to Google on Chrome/Edge and Apple on Safari with no DPA, no retention disclosure, and no opt-out beyond not using the API. For a nonprofit serving potentially vulnerable community members, the right design is to capture audio client-side via `getUserMedia` + `MediaRecorder`, POST it to a Next.js route handler, and only then forward to OpenAI — the developer can sign OpenAI's DPA, surface a per-session consent banner, and delete the temporary file server-side immediately after the API call returns.

## Wiring it up

A complete Next.js 15 App Router wiring is roughly 50 lines. The route handler accepts a multipart upload, forwards to OpenAI, and returns the transcript as JSON:

```ts
// app/api/transcribe/route.ts
import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No audio file" }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "File exceeds 25MB" }, { status: 413 });
  }
  const { text } = await openai.audio.transcriptions.create({
    file,
    model: "gpt-4o-mini-transcribe",
  });
  return NextResponse.json({ text });
}
```

The client component captures audio with `MediaRecorder`, packages it as `FormData`, and sets the result into the chat input state:

```tsx
// app/components/VoiceInput.tsx
"use client";
import { useRef, useState } from "react";

export function VoiceInput({ onTranscript }: { onTranscript: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (e) => chunks.current.push(e.data);
    rec.onstop = async () => {
      setBusy(true);
      const blob = new Blob(chunks.current, { type: mime || "audio/webm" });
      chunks.current = [];
      const fd = new FormData();
      fd.append("file", blob, "speech.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const { text } = await res.json();
      onTranscript(text);
      setBusy(false);
    };
    rec.start();
    recRef.current = rec;
  }
  function stop() { recRef.current?.stop(); }

  return (
    <button onMouseDown={start} onMouseUp={stop} disabled={busy}>
      {busy ? "Transcribing..." : "Hold to talk"}
    </button>
  );
}
```

The Firefox gap is closed for free: Firefox users hit the same `fetch('/api/transcribe')` path and never know Web Speech was unavailable. To add the progressive-enhancement path on top, feature-detect `window.SpeechRecognition || window.webkitSpeechRecognition`, and if present, use it instead of `MediaRecorder` for instant interim transcripts while keeping the OpenAI route as the universal fallback [20].

## References

1. MDN. "SpeechRecognition - Web APIs." https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition. Accessed 2026-07-11.
2. Can I Use. "Speech Recognition API." https://caniuse.com/speech-recognition. Accessed 2026-07-11.
3. Web Platform DX. "Speech recognition." https://web-platform-dx.github.io/web-features-explorer/features/speech-recognition/. Accessed 2026-07-11.
4. Deepgram. "Pricing." https://deepgram.com/pricing. Accessed 2026-07-11.
5. AssemblyAI. "Pricing." https://www.assemblyai.com/pricing. Accessed 2026-07-11.
6. Microsoft Azure. "Speech Pricing." https://azure.microsoft.com/en-us/pricing/details/speech/. Accessed 2026-07-11.
7. Google Cloud. "Speech-to-Text Pricing." https://cloud.google.com/speech-to-text/pricing. Accessed 2026-07-11.
8. AWS. "Amazon Transcribe Pricing." https://aws.amazon.com/transcribe/pricing/. Accessed 2026-07-11.
9. OpenAI. "Pricing." https://developers.openai.com/api/docs/pricing. Accessed 2026-07-11.
10. OpenAI. "GPT-4o mini Transcribe Model." https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe. Accessed 2026-07-11.
11. OpenAI. "Whisper Model." https://developers.openai.com/api/docs/models/whisper-1. Accessed 2026-07-11.
12. MDN. "MediaRecorder - Web APIs." https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder. Accessed 2026-07-11.
13. OpenAI. "Speech to text." https://platform.openai.com/docs/guides/speech-to-text. Accessed 2026-07-11.
14. OpenAI Node SDK. "Transcriptions." https://github.com/openai/openai-node/blob/c9a4d688/src/resources/audio/transcriptions.ts. Accessed 2026-07-11.
15. OpenAI. "GPT-4o Transcribe Model." https://developers.openai.com/api/docs/models/gpt-4o-transcribe. Accessed 2026-07-11.
16. APIScout. "Deepgram vs OpenAI Whisper 2026." https://apiscout.dev/guides/deepgram-vs-openai-whisper-2026. Accessed 2026-07-11.
17. Forasoft. "Streaming ASR in production — Whisper, Deepgram, AssemblyAI in 2026." https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/streaming-asr-deepgram-whisper-assemblyai-2026. Accessed 2026-07-11.
18. Deepgram. "Measuring STT Latency." https://developers.deepgram.com/docs/measuring-streaming-latency. Accessed 2026-07-11.
19. Deepgram. "Using Lower-Level WebSockets with the Streaming API." https://developers.deepgram.com/docs/lower-level-websockets.mdx. Accessed 2026-07-11.
20. MDN. "Using the Web Speech API." https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API. Accessed 2026-07-11.
21. Stack Overflow. "Web Speech API and data protection." https://stackoverflow.com/questions/69074499/web-speech-api-and-data-protection. Accessed 2026-07-11.
22. WebKit. "New WebKit Features in Safari 14.1." https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/. Accessed 2026-07-11.
23. Can I Use. "SpeechRecognition() constructor." https://caniuse.com/mdn-api_speechrecognition_speechrecognition. Accessed 2026-07-11.
24. lilting.ch. "How to Stabilize the WebSpeech API on iOS." https://lilting.ch/en/articles/ios-webspeech-api-tips. Accessed 2026-07-11.
25. Mozilla Bugzilla. "Bug 1248897 - Expose SpeechRecognition to the web." https://bugzilla.mozilla.org/show_bug.cgi?id=1248897. Accessed 2026-07-11.
26. Mozilla Bugzilla. "Bug 1940906 - Implement on-device Web Speech Recognition." https://bugzilla.mozilla.org/show_bug.cgi?id=1940906. Accessed 2026-07-11.
27. Can I Use. "Permissions API: microphone." https://caniuse.com/mdn-api_permissions_permission_microphone. Accessed 2026-07-11.
28. MDN. "Permissions: query() method." https://developer.mozilla.org/en-US/docs/Web/API/Permissions/query. Accessed 2026-07-11.
29. MDN. "MediaDevices: getUserMedia()." https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia. Accessed 2026-07-11.
30. MDN. "MediaTrackConstraints." https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints. Accessed 2026-07-11.
31. TestMu AI. "MediaRecorder: Browser Support, Codecs, Limitations." https://www.testmuai.com/learning-hub/mediarecorder-browser-support/. Accessed 2026-07-11.
32. media-codings.com. "Recording cross browser compatible media." https://media-codings.com/articles/recording-cross-browser-compatible-media. Accessed 2026-07-11.
33. Chrome Developers. "Voice driven web apps." https://developer.chrome.com/blog/voice-driven-web-apps-introduction-to-the-web-speech-api. Accessed 2026-07-11.
34. Microsoft BotFramework-WebChat. "Speech: Fix Safari by priming AudioContext." https://github.com/microsoft/BotFramework-WebChat/issues/2245. Accessed 2026-07-11.
35. OpenAI. "Data controls in the OpenAI platform." https://platform.openai.com/docs/guides/your-data. Accessed 2026-07-11.
36. OpenAI. "How we're responding to The New York Times' data demands." https://openai.com/index/response-to-nyt-data-demands/. Accessed 2026-07-11.
37. OpenAI. "Business data privacy, security, and compliance." https://openai.com/business-data/. Accessed 2026-07-11.
38. Covington Inside Privacy. "Spain's AEPD Issues New Guidance on AI-Based Voice Transcription." https://www.insideprivacy.com/artificial-intelligence/spains-supervisory-authority-issues-new-guidance-on-ai%E2%80%91based-voice-transcription/. Accessed 2026-07-11.
39. OpenAI. "How your data is used to improve model performance." https://openai.com/policies/how-your-data-is-used-to-improve-model-performance/. Accessed 2026-07-11.
40. GigaGPU. "Whisper VRAM Requirements: Tiny to Large-v3." https://gigagpu.com/whisper-vram-requirements/. Accessed 2026-07-11.
41. RunAIHome. "Cloud GPU Pricing Compared: RunPod vs Vast.ai vs Lambda (May 2026)." https://runaihome.com/blog/cloud-gpu-pricing-runpod-vast-lambda-2026/. Accessed 2026-07-11.
42. GigaGPU. "Self-Hosted Whisper vs OpenAI Whisper API Cost Comparison." https://gigagpu.com/self-hosted-whisper-vs-openai-whisper-api-cost/. Accessed 2026-07-11.
43. Pietrus (dev.to). "Speech-to-Text API Comparison: Whisper API Options in 2026." https://dev.to/pietrus914/speech-to-text-api-comparison-whisper-api-options-in-2026-400h. Accessed 2026-07-11.
44. SelfHosting.sh. "How to Self-Host Whisper with Docker Compose (speaches)." https://selfhosting.sh/apps/whisper/. Accessed 2026-07-11.
45. Brass Transcripts. "Whisper API Pricing 2026: $0.006/min vs Self-Host Costs." https://brasstranscripts.com/blog/openai-whisper-api-pricing-2025-self-hosted-vs-managed. Accessed 2026-07-11.
46. Modal. "How to deploy Whisper to transcribe audio in seconds." https://modal.com/blog/how-to-deploy-whisper. Accessed 2026-07-11.
47. GigaGPU. "How Much Does It Cost to Run Whisper on a GPU Server?" https://gigagpu.com/cost-to-run-whisper-gpu-server/. Accessed 2026-07-11.