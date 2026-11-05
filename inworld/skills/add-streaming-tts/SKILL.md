---
name: add-streaming-tts
description: "Stream Inworld speech into an existing app or voice-agent loop. Use when playback should start before synthesis finishes."
argument-hint: "[http|websocket]"
---

# Add Streaming TTS Skill

Wire Inworld's streaming TTS API into the user's project for low-latency playback. The endpoint streams audio chunks back via chunked HTTP (or WebSocket) as the model generates, so playback can start before synthesis completes. Use when adding streaming speech to an existing LLM/voice-agent loop, chat agents, voice assistants, game narration, anywhere latency matters and batch synthesize_speech feels too slow.

Inworld exposes streaming TTS two ways:

| Transport | Endpoint | When to use |
|---|---|---|
| Chunked HTTP | `POST https://api.inworld.ai/tts/v1/voice:stream` | Server-side or anywhere fetch+streams work. Simpler. |
| WebSocket    | `wss://api.inworld.ai/tts/v1/voice:streamBidirectional` | Lowest latency, persistent connection, stream text in and cancel mid-utterance. |

The plugin's MCP `synthesize_speech` tool uses the non-streaming endpoint and writes a complete
file at the end. For chat agents that need playback to start before synthesis finishes, you want
the streaming variants in your own code.

## Step 1 — Pick the transport

From $ARGUMENTS or by asking:
- `http` → chunked HTTP. Default. Works everywhere. Easy to debug.
- `websocket` → WebSocket. Best for interactive UIs where you might want to interrupt mid-utterance.

Default to `http` unless the user mentions cancellation, barge-in, or sub-100ms TTFA.

## Step 2 — Pick a voice + model

Ask the user, or call `list_voices` and suggest 3–5. Defaults to use:
- `voice_id`: any from list_voices (e.g. `Ashley`)
- `model_id`: `inworld-tts-2` (default) for quality and steering (~100ms server-side TTFB), or
  `inworld-tts-2-flash` when latency or cost is the deciding factor (~20ms TTFB, same languages,
  no steering instructions — non-verbal tags like `[laugh]` still work)

Mention steering if not already known — TTS-2 supports `[whisper]`, `[say with rising excitement]`,
inline `[laugh]`, etc.

For contextual delivery, HTTP supports TTS Reasoning via `reasoning: "on"`,
optional `reasoningContext` (600 characters max), and
`onReasoningInstruction(instruction)`. Use `inworld-tts-2`; if the API reports the feature unavailable, surface that result rather than retrying with invented fields. Preserve delivery settings unless the user requests a change. Capture
instruction-only first records. WebSocket duplex does not run Reasoning; do not
pass it there or promise the same feature on both transports. See
[Reasoning integration notes](../find-voice/references/tts-reasoning.md) for defaults,
comparison limits and rollout caveats.

## Step 3 — Scaffold the chunked-HTTP client (Node)

`src/streaming-tts/http-client.mjs`:

Copy [assets/http-client.mjs](assets/http-client.mjs) into `src/streaming-tts/`.
It exports `streamSynthesize({ apiKey, text, voiceId, modelId?, audioEncoding?,
sampleRateHertz?, speakingRate?, deliveryMode?, synthesisContext?, reasoning?, reasoningContext?, signal?,
onAudioChunk?, onTimestamp?, onReasoningInstruction? })`.
Pass existing `synthesisContext` to retain `previousRequests`; Reasoning fields
merge over that context without mutating it. The callbacks receive decoded
`Buffer` audio and timing records. Word timestamps are requested only when
`onTimestamp` is passed, with `timestampTransportStrategy: "ASYNC"` so they
arrive in separate records and do not delay the first audio. It reads through
EOF, including trailing timestamps, and rejects malformed records or API errors
even after partial audio has arrived. Handle that rejection as incomplete synthesis.

Typical usage — pipe directly to a player or HTTP response:

```ts
// Node: pipe to system audio via SoX / ffplay
import { spawn } from "node:child_process";
import { streamSynthesize } from "./streaming-tts/http-client.mjs";
const player = spawn("ffplay", ["-autoexit", "-nodisp", "-loglevel", "quiet", "-"], {
  stdio: ["pipe", "ignore", "ignore"],
});
try {
  await streamSynthesize({
    apiKey: process.env.INWORLD_API_KEY!,
    text: "[say with rising excitement] We did it!",
    voiceId: "Ashley",
    onAudioChunk: (chunk) => player.stdin.write(chunk),
  });
} finally { player.stdin.end(); }
```

Copy [assets/speech-route.mjs](assets/speech-route.mjs) alongside the HTTP client.
Mount its `POST` export at `/api/speech` using your app's authentication and rate limit.
Its JSON body accepts `reasoning`, `reasoningContext`, `deliveryMode` and
`synthesisContext` alongside `text`/`voice`. This route returns audio only; use
the direct client callbacks or your app's metadata channel to surface generated
instructions and timestamps.
Send `{text, voice}` in the JSON request body. The route returns MP3 bytes,
propagates upstream failures and aborts upstream work if the browser disconnects.
Keep speech text out of URLs and application request-body logs.

## Step 4 — Or scaffold the WebSocket client (Node)

`src/streaming-tts/ws-client.mjs`:

The protocol is context-based: `create` a context with the voice and audio settings,
stream text into it with `send_text`, `flush_context` to force synthesis of what's
buffered, and `close_context` for a graceful finish. Messages are
processed in order. `close_context` flushes buffered text; it is not cancellation.
See the [official context lifecycle](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-websocket).

Copy [assets/ws-client.mjs](assets/ws-client.mjs) into the app and install `ws`.
Construct `StreamingTtsWs` with `apiKey`, `voiceId`, optional `modelId`,
`audioEncoding` and `sampleRateHertz`, plus a required `clearPlayback(contextId?)`
callback that cancels already scheduled/queued audio. Optional callbacks are
`onAudioChunk(buffer, contextId)`, `onContextClosed(contextId)` and `onError(error)`.

Use `await open()` to obtain a context, then `await speak(id, text, flush?)`,
`await flush(id)` or `await closeContext(id)`. `closeContext` is a graceful finish
and synthesizes buffered text. **Barge-in calls `cancel()`**, which suppresses old
audio, clears playback and closes this dedicated socket without sending a flush.
Create a fresh client for the next utterance. This helper cancels all contexts on its dedicated socket. The API also documents `cancel_context`, but this helper does not expose a per-context cancel method; do not invent one on the wrapper. Nonzero
response status invokes `onError` and never the successful completion callback.

The client creates each context with `auto_mode: true` and
`auto_mode_strategy: "SENTENCE_BOUNDARY"`. Send LLM tokens as they arrive. The
server buffers partial sentences and starts synthesis at each sentence end, so
the app does not split sentences itself. Long speech without a sentence end is
cut at `buffer_char_threshold`. Call `flush(id)` or `closeContext(id)` when the
input ends, so the last partial sentence is spoken. Browsers can't set the `Authorization`
header: mint a one-time token on the backend and pass it as the `bearer_<token>`
WebSocket subprotocol (`search_docs` "one-time tokens"). Official reference
implementations: `inworld-ai/inworld-api-examples` → `tts/js/example_websocket.js` and
`tts/python/example_websocket.py`.

The WebSocket variant shines when you're piping an LLM stream into TTS in real time — feed each
sentence as it's produced, and the audio starts playing before the LLM finishes.

## Step 5 — Browser playback notes

An audio element cannot POST JSON. For a simple preview, fetch the POST route
from the authenticated UI, await its complete response as a Blob, then assign a
short-lived object URL to an `<audio controls>` element and revoke it when done.
This buffers the utterance before playback; it is not incremental playback.
For low-latency playback, consume `response.body` using a supported streaming
MP3 player or MediaSource pipeline, and propagate cancellation and errors.
Never place utterances in query parameters just to use an audio `src`.
HTTP headers or early audio do not prove the full generation succeeded.

For raw `PCM`, schedule samples with an `AudioWorklet` using the returned rate.
`LINEAR16` includes a WAV header in every chunk; strip each header before raw playback. More work; only worth
it if you need sub-100ms latency the MP3 path can't hit.

## Step 6 — Verify

Tell the user:
1. `export INWORLD_API_KEY=…` (or `.env`).
2. Pick a voice with `list_voices`.
3. Run the example with a short test phrase.
4. Measure first audio and completion separately; network, buffering and device latency vary.
5. Exercise audio-then-error, final NDJSON without a newline, and barge-in. Confirm
   interruption clears queued playback and no old-context audio is scheduled.

If audio is choppy: confirm chunks are being flushed to the player as they arrive (no buffering
all chunks first). If silence: check `Content-Type` of the response, confirm `audioContent`
field is present in each chunk.
