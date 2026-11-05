---
name: migrate
description: "Move an existing text-to-speech integration to Inworld. Use to map voices and formats, preserve a provider switch and verify the app's speech."
argument-hint: "[provider or path]"
---

# Migrate to Inworld TTS

Replace an existing TTS or speech-output provider with Inworld in an app, including voice-agent TTS migrations. Detect SDK call sites, map voices and audio formats, keep a reversible provider switch and verify on the app's own lines. Use for migrating, switching or comparing an existing TTS integration; use add-realtime for a new complete two-way voice agent.

Swap an app's existing TTS provider for Inworld without breaking it: keep the old path
behind a switch, move call sites one at a time, and prove parity with audio the user
can listen to.

## Step 1 — Inventory the current integration

Inspect dependency manifests/lockfiles, imports and TTS call sites (respect
`$ARGUMENTS` if it names a provider or a path). Do not discover providers by
searching credential files, API-key names, authentication headers or service hosts.

| Provider | Packages / imports and public SDK calls |
|---|---|
| ElevenLabs | `@elevenlabs/elevenlabs-js`, `elevenlabs` (PyPI), `textToSpeech.convert`, `text_to_speech.convert` |
| OpenAI TTS | `openai` (npm/PyPI), `audio.speech.create` |
| OpenAI Realtime | `@openai/agents-realtime`, `openai` realtime client imports and session call sites |
| Cartesia | `@cartesia/cartesia-js`, `cartesia` (PyPI) |
| Deepgram Aura | `@deepgram/sdk`, `deepgram-sdk` (PyPI), `speak.rest`, `speak.live` |
| Google / Azure / AWS | `@google-cloud/text-to-speech`, `google-cloud-texttospeech`, `microsoft-cognitiveservices-speech-sdk`, `azure-cognitiveservices-speech`, `@aws-sdk/client-polly`, `boto3` Polly client, `SynthesizeSpeechCommand` |
| Voice frameworks | Public TTS provider imports in LiveKit/Pipecat and existing Vapi or Twilio ConversationRelay voice configuration |
| Raw HTTP / shared SDK | Trace the named TTS adapter and request-building code; ask the developer if the provider cannot be identified without credential inspection |

For each call site, record: file and function, provider, mode (one-shot, HTTP stream,
WebSocket), voice, model, output format and sample rate, extras used (timestamps,
SSML, pronunciation dictionaries, voice settings), and the existing secret-injection mechanism (names/structure only, never values).

Summarize the inventory and preserve the migration scope already authorized. Ask only when the provider, affected feature or desired change remains ambiguous. If nothing is found, say so and offer the `setup` skill instead.

## Step 2 — Connect and pick voices

Call `list_voices` with `{"language": "en"}` (or the app's language). If it reports a
missing key, run the `connect` skill first.

For each voice in use, propose one or two Inworld voices: use `description_match` with
words from the old voice's character (e.g. `["warm", "narrator"]`), and play the
candidates by synthesizing the app's own copy with `synthesize_speech`. For cloned or
branded voices:

- ElevenLabs clones: the open-source batch tool `inworld-ai/voice-migration-tool` copies
  them across (it runs locally with both API keys). See `search_docs` "ElevenLabs
  migration".
- Anything else: `clone_voice` takes 3–30 s of clean reference audio.

## Step 3 — Add the Inworld path behind a switch

Add a provider switch (e.g. `TTS_PROVIDER=inworld|elevenlabs`, default unchanged until
the user flips it) and an Inworld implementation with the same function signature as
the old one, so callers don't change. Keep `INWORLD_API_KEY` server-side, add it to
`.env.example`, and never delete the old provider's code unless the user asks.

### OpenAI TTS → base-URL swap

Inworld serves OpenAI's `POST /v1/audio/speech`, so the SDK stays:

- `baseURL` / `base_url` → `https://api.inworld.ai/v1`, `apiKey` → the Inworld key.
- `model` → `inworld-tts-2` (quality, steering) or `inworld-tts-2-flash` (latency, cost;
  no steering).
  OpenAI model names return 400.
- `voice` → an Inworld voice ID (case-sensitive). OpenAI names like `alloy` return 404.
- `response_format`: `mp3`, `opus`, `flac`, `wav`, `pcm` work; `aac` does not.
- `speed` 0.5–1.5; `instructions` works on `inworld-tts-2`; `input` up to 4,000 chars.

If the same OpenAI client also makes chat calls, create a second client for speech
rather than repointing the shared one. (The same base URL also serves Inworld's
OpenAI-compatible LLM Router; moving chat traffic is a separate decision.)

### OpenAI Realtime → Inworld Realtime

Same event protocol with a different endpoint and session config. Use the `add-realtime`
skill's migration section and `search_docs` "OpenAI Realtime migration".

### Everything else → Inworld REST

| Mode | Inworld endpoint |
|---|---|
| One-shot (≤2,000 chars) | `POST https://api.inworld.ai/tts/v1/voice` → base64 `audioContent` |
| HTTP stream (≤4,000 chars) | `POST https://api.inworld.ai/tts/v1/voice:stream` → NDJSON `{"result":{"audioContent"}}` |
| WebSocket, text streamed in | `wss://api.inworld.ai/tts/v1/voice:streamBidirectional` (context-based: `create`, `send_text`, `flush_context`, `close_context`) |

Auth is `Authorization: Basic <INWORLD_API_KEY>`. The `setup` skill has the one-shot
client and the `add-streaming-tts` skill has the stream and WebSocket clients; reuse
them rather than writing new ones.

Field mapping:

| Old | Inworld |
|---|---|
| `text` / `transcript` / `input` | `text` |
| voice ID (ElevenLabs `voice_id`, Cartesia `voice.id`, the voice part of a Deepgram `aura-2-<voice>-en` model) | `voiceId` |
| fast models (ElevenLabs Flash/Turbo, Cartesia Sonic Turbo, Aura) | `modelId: "inworld-tts-2-flash"` |
| quality models (ElevenLabs Multilingual / v3, Cartesia Sonic) | `modelId: "inworld-tts-2"` |
| `mp3_44100_128`-style formats | `audioConfig: {audioEncoding: "MP3", sampleRateHertz: 44100}` (16–48 kHz) |
| raw 16-bit PCM (`pcm_16000`, `pcm_s16le`, `linear16`) | `audioEncoding: "PCM"` (no header) or `"WAV"` (header), same rate, 8–48 kHz |
| μ-law / A-law 8 kHz telephony | `audioEncoding: "MULAW"` / `"ALAW"`, `sampleRateHertz: 8000` |
| speed | `audioConfig.speakingRate` (0.5–1.5) |
| stability-style voice settings | `deliveryMode`: `STABLE`, `BALANCED` (default), `CREATIVE` — an approximation; tell the user it is a judgment call |
| word / character timestamps | `timestampType: "WORD"` or `"CHARACTER"` |
| pronunciation dictionaries | Use [pronunciation](../pronunciation/SKILL.md) to choose a Portal workspace dictionary or named API dictionary, validate language/model support and preserve reusable rules. Do not flatten a saved dictionary into inline IPA |
| SSML `<phoneme>` | Unsupported markup; for a single English word, inline English IPA between slashes is available (`/kriːt/`). Confirm the sound rather than mechanically converting a phoneme alphabet |
| SSML `<break>` | inline `<break time="500ms"/>` |
| style / emotion prompts | TTS-2 steering tags inline, e.g. `[say warmly]`, `[whisper]` (`inworld-tts-2` only; if the app needs both speed and style, test both models) |

Anything without a clear equivalent (ElevenLabs `previous_text`/`next_text` stitching,
other SSML tags such as `<prosody>` or `<emphasis>`, per-request seeds): check
`search_docs` before assuming. If there's still no equivalent, list it for the user
instead of silently dropping it.

### Voice frameworks

Don't hand-roll HTTP inside LiveKit or Pipecat. Both ship Inworld integrations (a
LiveKit Agents plugin and Pipecat's built-in `InworldTTSService`). Run `search_docs`
"LiveKit" or "Pipecat" for the current package and class names, then swap the TTS
constructor only. For Vapi and Twilio ConversationRelay, the change is the TTS provider
or voice setting; `search_docs` has the exact fields.

## Step 4 — Verify side by side

1. With `synthesize_speech`, render two or three real strings from the app (a greeting,
   a number- or name-heavy line, the longest typical line) in the chosen Inworld voice
   and save them next to the old provider's output if the user can produce it.
2. Run the app's own path with `TTS_PROVIDER=inworld` and confirm the audio plays in
   the format the consumer expects: sample rate, container, and mono.
3. For streaming paths, measure time to first audio chunk on both providers from the
   same machine and report both numbers, labelled as measured locally.

## Step 5 — Hand off

Summarize: files changed, the switch name and how to flip it, voice mapping, anything
you couldn't map, and how to roll back (flip the switch). For pricing, run
`search_docs` "pricing" or point to https://inworld.ai/pricing; don't quote numbers
from memory.
