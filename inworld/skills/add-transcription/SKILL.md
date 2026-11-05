---
name: add-transcription
description: "Transcribe audio files and long recordings with speaker labels, timestamps and vocabulary hints. Use for meetings, podcasts and call archives."
argument-hint: "[short|long] [diarization]"
---

# Add Transcription Skill

Add transcription of recorded audio to the user's project with Inworld STT-1: short clips synchronously, and long recordings (meetings, interviews, podcasts, call archives) as async jobs, with optional speaker diarization, word timestamps, Voice Profile, and custom vocabulary. Use when the user wants to transcribe files or recordings rather than live microphone audio.

Wire Inworld STT into a feature that transcribes **recorded** audio. For live
microphone audio, use `/inworld:add-streaming-stt` instead.

Use `inworld/inworld-stt-1`. Before configuring options, inspect the app's output
needs and read [feature selection](references/features.md). Infer useful features
rather than asking for each toggle. For an existing voice framework, read
[framework guidance](references/frameworks.md); TTS support does not imply STT
adapter support. Use `benchmark-stt` when the user needs accuracy/latency evidence.
Do not claim support for a competitor's feature without current Inworld evidence.

If transcription is being used to prepare a voice clone, continue into
[custom-voice recording preparation](../custom-voice/references/preparing-recordings.md)
after the complete diarized result. Preserve exact word timings, source identity
and job-scoped labels; the transcript alone is not a clean training sample.

## Step 1 — Pick the mode

From $ARGUMENTS, or by asking how long the recordings are:

| Mode | When | Endpoint |
|---|---|---|
| `short` | Clips up to ~16 MB (duration depends on encoding/rate) where the user can wait for the reply | `POST /stt/v1/transcribe` (synchronous) |
| `long` | Meetings, interviews, podcasts, call archives: minutes to hours, up to 512 MB per job | `POST /stt/v1/transcribe:async`, then poll |

**Speaker diarization** ("who said what") works only in `long` mode and on the
streaming endpoint, not on synchronous transcription. If the user wants speaker
labels on short clips, use `long` mode anyway.

## Step 2 — Choose the options

All go in `transcribeConfig`:

- `modelId`: `"inworld/inworld-stt-1"`
- `audioEncoding`: `"AUTO_DETECT"` for files with headers (WAV, MP3, FLAC, OGG);
  `"LINEAR16"` with `sampleRateHertz` for raw PCM
- `language` (optional): a hint such as `"en"` or `"ja"` when the language is
  known. It improves accuracy, especially on short utterances.
- `prompts` (optional): **custom vocabulary**. Names, product terms, jargon, and
  acronyms the audio contains. It's a soft bias rather than a hard keyword
  lock, so test it on real audio.
- `includeWordTimestamps: true`: per-word timings (needed for diarization)
- `enableSpeakerDiarization: true` (`long` mode): adds a `speaker` number to
  each word. Requires `includeWordTimestamps`.
- `voiceProfileConfig: { enableVoiceProfile: true }` (optional): age, emotion,
  pitch, vocal style, and accent labels with confidences

Declare the actual rate for raw PCM; container formats read their headers.
16 kHz mono is convenient; upsampling 8 kHz telephony does not restore information.

## Step 3 — Scaffold the client

### Node / TypeScript

`src/lib/inworld-transcribe/client.mjs`:

Copy [assets/client.mjs](assets/client.mjs) into the app. It exports:

- `transcribeShort(audioBuffer, options?)`: returns transcript plus requested timings, profile and usage.
- `submitTranscription(blobOrUrl, options?)`: submits once and returns the operation name.
- `waitTranscription(name, pollMs?, timeoutMs?)`: resumes a job without submitting again.
- `transcribeLong(blobOrUrl, options, onSubmitted, pollMs?, timeoutMs?)`: awaits durable persistence before polling.
- `speakerTurns(result)`: groups words with `speaker: number | null`; unknown words separate known speaker turns.

Options are `language`, `vocabulary`, `diarization`, `voiceProfile` and `timestamps`.
The default model is `inworld/inworld-stt-1`. A URL input has shape `{ url }`.
`TranscriptionJobError` carries `operationName` and `acceptanceUnknown`.

```js
import { transcribeLong, waitTranscription } from "./inworld-transcribe/client.mjs";
const result = await transcribeLong({ url: recordingUrl }, { diarization: true },
  async name => { await jobs.saveOperation(recordingId, name); });
// After a worker restart, use the persisted name:
// const result = await waitTranscription(await jobs.operationName(recordingId));
```

### Python

`inworld_transcribe.py` (uses `httpx`, matching the setup skill):

Copy [assets/inworld_transcribe.py](assets/inworld_transcribe.py) into the app.
It uses `httpx` and exports `transcribe_short`, `submit_transcription`,
`wait_transcription`, and `transcribe_long`. The combined helper requires a
synchronous `on_submitted(name)` callback that durably saves the accepted name
before polling. Errors expose `operation_name` and `acceptance_unknown`.

```python
from inworld_transcribe import transcribe_long, wait_transcription
result = transcribe_long(url=recording_url, diarization=True,
                         on_submitted=lambda name: jobs.save_operation(recording_id, name))
# Resume after restart: wait_transcription(jobs.operation_name(recording_id))
```

## Step 4 — Wire it into the feature

- **Long jobs belong in a background worker or queue**, not a request handler.
  Await durable `onSubmitted` persistence (Python: synchronous `on_submitted`) before
  polling, or call `submitTranscription` / `submit_transcription`, persist the returned
  name, then `waitTranscription` / `wait_transcription`. Every wait/download error
  carries `operationName` (Python: `operation_name`). Resume that name after a poll
  503, timeout, download failure or worker restart; do not submit again. A submit
  transport timeout or ambiguous 5xx sets `acceptanceUnknown` / `acceptance_unknown`:
  reconcile it before trying another submission. The URL submit allowance is 360 s,
  separate from 30 s polls and the total waiting deadline. See
  [async limits](https://docs.inworld.ai/stt/async-transcription).
- **Download results promptly.** Transcripts and submitted audio are deleted
  7 days after completion, and polling again returns the same signed link.
- **Speaker numbers are per job.** `speaker: 0` means "the same voice within
  this recording", not a known person. Let users rename speakers in the UI.
- In the result JSON, preserve numeric or string millisecond fields; zero-valued fields
  are omitted, and `language` is a name such as `"English"`, not a BCP-47 tag.
  Don't assume `segments` has exactly one entry.
- `RESOURCE_EXHAUSTED` on submit means the plan's in-flight job limit or the
  rate limit was hit; the message says which. Wait for a job to finish and
  resubmit.

## Step 5 — Verify

Verify the selected mode through the maintained client using permitted audio;
run live requests only within the user's authorized scope. If live access is
unavailable, run offline fixtures and mark API/audio verification pending.

- **Long recordings or any diarization request, including short clips:** use
  `transcribeLong` / `transcribe_long`, with `diarization: true` in Node or
  `diarization=True` in Python when speaker labels are needed. Persist the accepted
  operation name before polling and resume that operation after interruption.
  Do not use the synchronous MCP tool as a prerequisite or a substitute. For
  diarization, use at least two speakers and check the complete downloaded result;
  in Node, check that `speakerTurns` alternates where expected.
- **Short recordings without diarization:** use `transcribeShort` /
  `transcribe_short`. An optional MCP comparison with `transcribe_audio` is valid
  only for supported short-file cases without Voice Profile; pass
  `model_id: "inworld/inworld-stt-1"` explicitly and inspect the installed schema.
  It cannot verify async jobs or speaker labels.
- **Voice Profile, in either client mode:** enable it only when the app uses the
  analysis, with `voiceProfile: true` in Node or `voice_profile=True` in Python.
  These client options set `voiceProfileConfig.enableVoiceProfile`; the bundled
  MCP tool has no Voice Profile input option. Preserve ranked labels and
  confidences rather than flattening them.

Test representative device audio, a name/number-heavy sample, silence and a failure.
For long jobs persist the operation ID, cap polling time, and offer resume; a timeout
is not a failed server job. Keep raw transcript separate from optional LLM cleanup.
Do not infer identity or verified age/emotion from Voice Profile. For measured
recognition quality and tail latency, use `benchmark-stt` instead of treating one
successful transcript as proof of accuracy.

`transcribeShort` / `transcribe_short` return an object: read `.transcript` (Python
`["transcript"]`) for text, and retain optional word timings, profile and usage
when the feature needs them. Do not request metadata and then discard it in the
helper. The examples return raw ranked profile categories; apply the app's
confidence policy when displaying or using them.
