---
name: latency
description: "Measure streaming speech latency and find bottlenecks in a voice app. Use for time to first audio, model selection and slow conversations."
argument-hint: "[optional: the line or flow that feels slow]"
---

# Latency

Measure and reduce voice latency in the user's Inworld integration. Times streaming TTS from their machine (time to first audio, per model), then reviews their code for the usual causes of a slow voice agent: unary instead of streaming, waiting for the whole LLM reply, new connections per request, normalization, timestamps, and region. Use when the voice feels slow, when choosing between inworld-tts-2 and inworld-tts-2-flash, or before shipping a realtime voice feature.

Before calling tools, follow [installed tool availability](../connect/references/tool-availability.md).
Use the single Inworld connection and its actual schemas. If the host has
disabled a tool or loaded an older package, follow the availability guidance;
missing tools do not imply a missing API key.


A voice agent feels slow when time-to-first-audio is high. Measure first, then
fix the biggest cause in the code.

## Step 1 — Measure from here

If `measure_latency` is registered, call it with a line the app really says first (`text`) and the
app's voice. Set `compare_normalization: true` if the app could write numbers
out itself. Show the table. The numbers include the user's network round trip and stop at received audio,
not audible playback. Preserve every attempt and failure, valid/attempted metric
counts, warm-up policy and percentile method. A few runs are exploratory; they
do not establish production tail latency. Public server-side figures on
https://inworld.ai/models use a different clock/workload and are not this test's result.

Compare `inworld-tts-2-flash` when low latency is a priority and the app does not
need steering. Use `inworld-tts-2` when it needs steering; listen to representative
lines before deciding. Model labels do not establish a quality or speed winner.

If it is absent, prepare timing in the app's streaming client using
[HTTP streaming assets](../add-streaming-tts/assets/http-client.mjs) or
[WebSocket assets](../add-streaming-tts/assets/ws-client.mjs). Run it only within
the authorized request budget. Core `synthesize_speech` returns a complete file;
its total duration cannot establish streaming time to first audio. If no live
measurement is authorized, continue the code review without inventing timings.

## Step 2 — Review the pipeline

Read the TTS and LLM call sites and check, in order of impact:

1. **Streaming.** Unary `/tts/v1/voice` waits for the whole clip. Use HTTP
   streaming (`/tts/v1/voice:stream`, NDJSON) or the WebSocket
   (`/tts/v1/voice:streamBidirectional`), and start playback on the first chunk.
2. **LLM → TTS hand-off.** Waiting for the full LLM reply before calling TTS
   adds the whole generation time. Stream the LLM and send text to TTS sentence
   by sentence. On the WebSocket, create the context with `autoMode: true` and
   `autoModeStrategy: "SENTENCE_BOUNDARY"`, send tokens as they arrive, and
   flush or close the context when the reply ends.
3. **Connections.** A new TLS connection per request adds a round trip or more.
   Reuse one HTTP agent/session with keep-alive, or keep one WebSocket open per
   conversation.
4. **WebSocket handshake.** Send `create` and the first `send_text` together;
   don't wait for `contextCreated`.
5. **Timestamps.** Request `timestampType` only when the app uses the timings.
   When it does, set `timestampTransportStrategy: "ASYNC"` on HTTP streaming
   and on the WebSocket. The default sends timestamps together with the audio,
   which can hold back the first chunk.
6. **Normalization.** `applyTextNormalization: "OFF"` saves a little per
   request, but only when the LLM writes numbers, dates and symbols in words.
   It also disables `<verbatim>` tags.
7. **Browser and mobile.** Proxying audio through the backend adds a hop. Mint a
   short-lived token server-side and stream to the client directly.
8. **Distance.** Run the backend near the API; EU (`api.eu.inworld.ai`) and
   India (`api.in.inworld.ai`) regions exist for Enterprise.

## Step 3 — Fix and re-measure

Make the highest-impact change, then add timing around the real call
(request start → first audio chunk) so the user sees the improvement in their
own app, not only in the tool. For full speech-to-speech agents, hand off to
`/inworld:add-realtime`.
