---
name: add-streaming-stt
description: "Add live captions or dictation with speaker labels, vocabulary hints and reliable final transcripts. Use for streaming audio, not recordings."
argument-hint: "[browser|server|livekit|pipecat]"
---

# Live speech recognition

Build live captions, dictation or the speech-recognition stage of a voice agent with Inworld streaming STT. Select vocabulary, speaker labels, Voice Profile and turn behavior for the app; implement browser/server capture and reliable final transcript delivery. Use for live audio, not uploaded recordings.

Inspect the app's audio source, language, transcript consumer and existing
framework. Infer feature choices from the task; ask only for missing information
that changes the implementation. Read the [feature guide](../add-transcription/references/features.md)
for mode restrictions and actual Inworld capabilities. For LiveKit/Pipecat, read
[framework guidance](../add-transcription/references/frameworks.md) first: do not
add a second competing turn detector or replace a working transport unnecessarily.

Use `inworld/inworld-stt-1` and current [WebSocket docs](https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe-stream-websocket.md).
Streaming consumes mono signed little-endian PCM16, not MediaRecorder WebM/Opus.
Declare the actual sample rate; 16 kHz is convenient, not the only accepted rate.
Changing the config does not resample audio. Prefer `en`/`ja` language hints;
verify supported languages and script behavior in the current docs.

## Scaffold from maintained assets

Copy only the required assets into the user's app and adapt its existing patterns:

- [session.mjs](assets/session.mjs): transport-neutral configuration, events,
  manual turn boundaries, errors, connection timeout and graceful drain.
- [node-client.mjs](assets/node-client.mjs): Node `ws` adapter (install `ws` using
  the app's package manager). Set the server-side API key and actual PCM rate.
- [browser-client.mjs](assets/browser-client.mjs): AudioWorklet capture in 100 ms
  chunks, zero-gain sink, actual browser rate, authenticated backend token route,
  final worklet flush and microphone cleanup. Call from the app's user gesture.

These are plain app source files, not imports from an installed plugin. Keep
`session.mjs` adjacent to the chosen adapter; no plugin or MCP process is needed
at application runtime. Convert to TypeScript if the project requires it.
For Python, adapt the current official [Python samples](https://github.com/inworld-ai/inworld-api-examples/tree/main/stt/python)
with the same lifecycle invariants instead of translating a Node socket API.

```js
const stt = startNodeStt({
  apiKey: process.env.INWORLD_API_KEY,
  sampleRateHertz: 16000, language: 'en', vocabulary: ['Inworld'],
  onTranscription(t) {
    // Interim text replaces the previous interim. Append each final once.
    if (t.isFinal) { commitTurn(t); clearInterim(); }
    else replaceInterim(t.transcript ?? '');
  },
  onSpeechStarted: showListening,
  onSpeechStopped: showProcessing,
  onVoiceProfile: handleProfile, onUsage: recordUsage, onError: showError,
});
await stt.ready;
// Send PCM chunks from the app's existing capture source.
for await (const pcm of pcmSource) stt.sendAudio(pcm);
const result = await stt.finish();
if (!result.complete) showIncompleteTranscript(result);
```

Always surface partial output as incomplete on transport failure, cancellation,
missing usage or drain timeout. Do not promote the last interim to a final.
The sample reports complete only after requested shutdown, normal server close
and a usage frame. It does not establish recognition accuracy.

## Choose behavior, not a list of toggles

- **Captions/dictation:** replace interims; commit finals. Keep raw transcripts
  separate from optional LLM cleanup; never silently rewrite a quoted transcript.
- **Voice agent:** tune end-of-turn for actual pauses, accents and background
  audio; measure end-of-speech → final separately from first partial. Let either
  the framework or STT own turn boundaries. Speech events are not transcript finals.
- **Multi-speaker audio:** enable diarization and word timestamps together only
  when useful. Speaker numbers are local labels, not real identities. Do not
  assume diarization can separate arbitrary overlapping speech.
- **Names/jargon:** pass vocabulary as `prompts`; it is a soft bias. Evaluate on
  held-out names/IDs. This is distinct from TTS pronunciation dictionaries.
- **Voice Profile:** opt in only when the app uses its ranked labels/confidences;
  do not turn an estimated age/emotion/accent into a verified personal fact.

`sttConfig` accepts `vocabulary`, `diarization`, `voiceProfile`, `profileTopN`,
`manualTurns`, optional `endOfTurnConfidenceThreshold`, and `turnDetection` containing both silence thresholds.
Server defaults change; do not silently hardcode a remembered default.
For manual turns, send `endTurn()` at natural boundaries (turn cap ~30 s), then
continue audio. To finish the session, flush PCM and call `finish()` once:
**closeStream alone, receive all results and usage until server close**. Do not
precede shutdown with endTurn. Browser `stop()` flushes the worklet first.
If shutdown times out, retain committed final transcripts and received usage,
report that session completion is unconfirmed, and do not resend audio merely
to obtain a clean close. Voice Profile can arrive inside `transcription.voiceProfile`;
the shared session helper forwards it through `onVoiceProfile`.

The assets select `audioProtocol: BINARY` to avoid base64 overhead. Use `JSON`
if the app needs it; config/control/results remain JSON. For browser reconnects,
mint a fresh one-time token on every attempt; do not replay already committed
turns or silently duplicate captured speech.

## Browser authentication

Keep the API key on an authenticated backend, protected by the app's existing
CSRF controls and per-user usage limits. Mount this helper at the browser's
`tokenEndpoint`; return its status/headers/body through your framework:

```ts
// Mints a single-use, short-lived token so the browser never sees the API key.
// Docs: https://docs.inworld.ai/portal/ephemeral-tokens
// Your route sends back { status, headers, body } as-is.
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function issueInworldToken(user: { id: string } | null) {
  if (!user) return { status: 401 as const, headers: NO_STORE };
  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) throw new Error("INWORLD_API_KEY is not set");
  const upstream = await fetch("https://api.inworld.ai/auth/v1/tokens", {
    method: "POST",
    headers: { Authorization: `Basic ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ single_use: true, ttl: "300s", client_reference_id: user.id }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!upstream.ok) {
    return { status: upstream.status === 429 ? (429 as const) : (502 as const), headers: NO_STORE };
  }
  const { accessToken, expireTime } = await upstream.json();
  // The token is a bearer credential: no-store keeps it out of caches. Never log it.
  return { status: 200 as const, headers: NO_STORE, body: { accessToken, expireTime } };
}
```

Use the browser's `bearer_` subprotocol, never a credential in the URL. Rejected
handshakes may not return an error frame; expose connection/close errors and
release the microphone on failure. A backend relay is also valid where the app
already owns capture and authentication.

## Prove the user outcome

Run recorded PCM before adding microphone variability, then real target-device
audio: a normal utterance, a pause mid-sentence, a domain term, silence, stop
while speaking, and a failed connection. Verify no missing final tail, duplicate
interims/finals, leaked microphone or ignored error/usage. Record actual rate,
locale, options, audio source and completion status. For accuracy/latency/cost
evaluation, use `benchmark-stt`; for uploaded files use `add-transcription`.
