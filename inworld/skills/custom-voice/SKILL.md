---
name: custom-voice
description: "Prepare recordings for instant or professional voice cloning. Use for speaker isolation, training audio, IVC/PVC creation and integration."
---

# Custom voice onboarding

Prepare Inworld voice clones from recordings, including long meetings or videos with multiple speakers. Isolate the target speaker with diarized timestamps, assemble training/holdout audio, then create or resume IVC/PVC and integrate the ready voice.

Use the developer's existing app, client and audio fixtures. Establish the speaker,
their permission for cloning and intended use, sample location, language/accent,
and target feature from context. Possession of a recording is not consent. If
permission is missing, prepare instructions only; do not upload or clone. Keep
recordings and consent evidence private, outside version control.

## Choose the route

| Route | Choose when | Input and lifecycle |
| --- | --- | --- |
| IVC | A short reference is available; quick experimentation | As little as 3 seconds, up to 30 seconds; clone returns a persisted synthesis voice |
| PVC (beta) | Similarity and stable delivery matter enough to prepare more audio | At least 10 minutes after trims; draft → uploads → asynchronous training → ready |

Recommend 15–30 seconds of clean speech for IVC. For PVC, English is fully
supported; other languages remain experimental. Verify support before uploading.
Do not promise completion time or that a larger dataset guarantees similarity.
If no authorized samples exist, offer library selection or voice design through
the existing `find-voice` skill instead.

Read [limits and preparation](references/preparation.md) for the chosen surface
(Portal, API or bundled MCP). These have distinct format/size restrictions.
Read [PVC lifecycle](references/pvc-lifecycle.md) when creating or resuming PVC.

## Prepare locally first

For a long meeting, interview, podcast or video with multiple speakers or gaps,
follow [recording preparation](references/preparing-recordings.md) first. Inspect
the local file, use completed diarized STT with word timings, attribute the target
speaker, exclude interruptions/overlap/gaps, reserve holdout, and assemble clean
training files with source offsets. See [the helper contract](references/dataset-format.md)
for local planning and assembly. Do not treat a long raw file as a ready sample.


Use clean recordings of one consenting speaker: no music, other voices, echo,
clipping or abrupt word cuts. Match sample language and intended delivery. Listen
to the supplied files only when local playback is appropriate and authorized;
do not record a live call or route playback into an active meeting. Reserve
separate reference audio and app utterances for the held-out audition.

Optional dependency-free preflight, from this installed skill’s directory
(the directory containing this SKILL.md, not your application repository):

```bash
python3 scripts/preflight.py --mode ivc-portal /absolute/path/sample.wav
python3 scripts/preflight.py --mode pvc-api /absolute/path/sample-01.wav /absolute/path/sample-02.wav
```

This reads files and prints JSON only: no credentials, network, uploads, edits,
training or playback. It supports integer PCM WAV only; other formats need the
app's existing local media inspector. It reports mechanical checks, not consent,
speech duration, speaker count, language or perceptual quality. Never interpret a
passing report as permission or proof of service acceptance. Exit 0 means local
checks passed, 1 means a known problem, 2 means inspection was incomplete.

## Create or resume deliberately

Carry out creation, uploads, training and auditions when they fall within the
user's requested cloning workflow, account and understood quota/cost. Do not ask
again for each routine step already authorized. If the request is for planning
or local implementation only, stop at local artifacts and the next action plan.
If rights, account or a material spending decision are unresolved, resolve those
before the dependent remote action.

- **IVC via MCP:** preserve the existing `clone_voice` integration. Inspect its
  advertised schema before use: currently `display_name`, `lang_code`, absolute
  `audio_files`, optional `transcriptions`, and `remove_background_noise`.
  Its bundled description says WAV/MP3, ≤4 MB per sample; do not assume Portal
  inputs work there. It is an IVC tool, not a PVC training interface. Review
  returned `sample_errors`/`sample_warnings` before accepting `voiceId`.
- **IVC via Portal:** Text-to-Speech → Create Voice → Upload or record audio.
  Confirm rights in the flow; review the result in Playground. Copy its voice ID.
- **IVC via an existing API client:** use the current Clone a voice contract
  linked in the preparation reference; do not rewrite MCP to add newer fields.
  Clones persist automatically; no `publish_voice` call is needed.
- **PVC:** use Portal's Start professional clone flow or the app's existing
  authorized API client. Follow the lifecycle reference; no new service or MCP
  registration is needed. On resume, inspect the existing voice before proposing
  a new draft, upload or training run.

Keep a small private continuation record: route, workspace identifier, locale,
consent-evidence pointer, sample paths/hashes, returned sample IDs, `pvcVoiceId`,
last observed state and timestamp, `customVoice`, and resolved synthesis
`voiceId` when available. Leave unknown values empty. Never store API keys,
authorization headers, raw base64 audio or full responses in this record or Git.
Keep PVC management IDs separate from synthesis IDs. An uncertain request result
requires reconciliation by list/get before repeating a mutation.

## Audition and integrate

Once ready, resolve the exact returned `voiceId`; never construct one from a
display name or PVC ID. Use existing app fixtures for a greeting, correction,
longer passage, names/numbers and target locale. Text and reference recordings
must be held out from cloning/training. With synthesis authorization, render a
small fixed set with the same model/settings as the current voice and compare
similarity, clarity, pronunciation, consistency and artifacts. Use safe local
playback or provide saved files. In Codex, embed saved audition clips as
`![Voice name](/absolute/path/to/audition.mp3)` in the final answer, outside code
blocks; use `playbackMarkdown` when returned. If no inline player appears, offer
the file preview. Other hosts may have different audio controls.

Let the user choose whether the audition is acceptable. Wire the selected ready
ID into the existing voice config/helper for the requested feature, retain the
previous voice for rollback, and use the app's normal error handling. Never
silently substitute a different voice or change global settings. Run existing
offline app checks with a stubbed response; live synthesis and listening remain
separate validation. Report the route, state/IDs, local checks, audition evidence,
changed app path and next action. Label simulated results and untested live
behavior explicitly. Do not delete or retrain a READY voice automatically.


For OpenClaw native attachments, Cursor file previews and other hosts, follow
[native audio presentation](../find-voice/references/playback.md).
