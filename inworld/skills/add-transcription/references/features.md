# Select STT features for the application

Read current [overview](https://docs.inworld.ai/stt/overview.md),
[best practices](https://docs.inworld.ai/stt/best-practices.md) and the selected
mode's reference before writing config. This is a decision guide, not a pinned
API specification. Availability and defaults can change.

## Start from the output the developer needs

| App | Start with | Add when useful | Verify |
| --- | --- | --- | --- |
| Voice messages / short recordings | Synchronous file transcription | Known language, domain vocabulary | Real device format; complete words and names |
| Meetings / interviews / call archives | Async recording job | Word timestamps + diarization | Speaker turns, overlap, result persistence and resumable jobs |
| Live captions | Streaming | Language hint, vocabulary, timestamps if the UI needs them | Interim replacement, final commits, stop/reconnect |
| Dictation / notes | Streaming or short-file STT | Optional app-side LLM cleanup | Keep original transcript alongside rewritten output |
| Voice agent | Streaming in the existing framework | Tuned or manual turns, vocabulary | End-of-speech → final, interruptions and one owner of endpointing |
| Adaptive voice UX | Appropriate transcription mode | Optional Voice Profile | Ranked confidence labels, language coverage and graceful missing analysis |

Recommend the applicable options from the app's requirements. Do not ask the user
to select every flag, add Voice Profile by default or require an LLM for captions.

## Mode boundaries

- **Synchronous:** about 16 MB maximum; containers use `AUTO_DETECT` and headers.
  Raw PCM needs the actual sample rate. File size does not imply a fixed duration.
- **Async:** large recordings (current guide: up to 512 MB), upload or accessible
  URL → operation → result. Persist the operation ID and download results promptly.
  See [async docs](https://docs.inworld.ai/stt/async-transcription.md).
- **Streaming:** PCM16 with actual rate, interim/final results and speech events.
  Encoded MediaRecorder fragments are not PCM. A final ends a turn, not a session.
- **Diarization:** async/streaming, with `enableSpeakerDiarization` AND
  `includeWordTimestamps`; not the synchronous endpoint. Follow current release
  stage, language and billing restrictions. Speaker labels identify within-job
  voices, not a person's name or persistent identity.
- **Vocabulary:** `prompts` biases names/jargon. Do not promise forced spelling,
  contextual prompting or mid-stream reconfiguration unless current docs support
  that exact behavior. It is not a TTS pronunciation dictionary.
- **Voice Profile:** opt in using `voiceProfileConfig.enableVoiceProfile`; optional
  `topN`. Current categories are ranked arrays of `{label, confidence}`. Preserve
  unknown/missing categories and confidences, including 0. STT language coverage
  and Voice Profile's trained language set differ; consult both pages.
- **Language:** prefer ISO 639-1 hints. A locale may normalize to its base language;
  hints can also constrain output script. Confirm target-language accuracy rather
  than promising automatic translation or universal code-switching.

## Separate product features from an application composition

The transcription workflow uses Inworld STT-1 only. Do not infer support for contextual prompts, medical modes, voice-focus
noise suppression, persistent speaker identification, PII redaction, webhooks,
formatted dictation or audio intelligence. Consult current Inworld docs for each
request. If absent/unverified, say so. An explicit app-side STT → LLM workflow
can summarize or rewrite text, but that is an additional model call with separate
cost/latency/privacy behavior, not a native STT flag. Do not invent parameter names.

## Audio and error handling

Inspect actual channels, encoding, rate and device path. Keep source audio when
permitted; do not upsample 8 kHz telephone audio and claim accuracy was restored.
Separate microphone noise, codec conversion and clipping from model recognition.

Expose HTTP errors and JSON/WebSocket error frames. Resource exhaustion may mean
concurrency or a rate limit; back off based on the actual message and plan. Do not
retry expired signed result links or restart a successful async job blindly. Never
log API keys, browser tokens or private recordings by default. Keep mode-specific
credentials/regions aligned and detect permission errors separately from bad keys.

## Result consumers

Commit final transcripts once; replace interims for the current turn. Do not
concatenate cumulative interims. Keep word timings in their documented units;
64-bit JSON millisecond values may be strings and zero fields may be omitted.
In async results, process every segment rather than assuming one. Preserve raw
response fields the app needs instead of silently discarding speaker/profile data.
Voice Profile labels are estimates: use an app-chosen confidence policy, not
identity verification or assertions of a speaker's true age/emotion/accent.
