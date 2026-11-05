# Sample preparation and surface limits

Verified against primary docs on 2026-10-17. Recheck before remote use; these are
documented limits, not a report of successful live uploads.

| Surface | Documented inputs | Duration and caveats |
| --- | --- | --- |
| IVC Portal | One WAV, MP3 or WEBM file; 12 MB maximum | 3–30 seconds; longer inputs trimmed to 30 seconds |
| IVC API | `voiceSamples[].audioData` is base64 WAV/MP3; optional transcription | 10–30 seconds recommended; cut off at 30 seconds. Do not transfer Portal's 12 MB/WEBM rules to API |
| Bundled `clone_voice` MCP | Local WAV/MP3 paths; advertised ≤4 MB per sample | Existing wrapper uses `lang_code`; preserve its schema. This is a bundled compatibility constraint, not the Portal limit |
| PVC Portal | Up to 50 samples; combined 1,000,000,000 bytes | At least 600 seconds total; Portal guide does not establish a per-request API batch size |
| PVC API | WAV, MP3, WEBM; ≤10 files per upload; ≤1,000,000,000 bytes per file and per voice; ≤50 samples total | At least 600 seconds **after trims**. WEBM needs Duration metadata; format is detected from bytes |

PVC API rejects empty/truncated audio, M4A, A-law/12-bit WAV, and WEBM without
Duration. WAV supports integer PCM, float32 and extensible forms at the service;
the local helper deliberately handles only integer PCM WAV. Upload uses repeated
multipart `files[]` parts. One rejected file rejects the whole upload batch.
Inspect and repair that batch before a deliberate retry; reconcile uncertain
transport results before resubmitting.

The PVC train reference separately documents an approximate 2,800-second audio
cap per run; excess audio may be silently truncated. This differs from upload
storage capacity. Avoid treating arbitrarily long uploads as fully used training
data. Current docs provide differing illustrative training-time ranges; neither
is a completion guarantee.

IVC clones created before 2026-08-15 retain their original 15-second prompt.
Using a longer prompt requires a new clone; never silently replace an existing
voice. API `languageCode` is preferred in new code, with accent encoded in the
locale; set at most one of `languageCode` and legacy `langCode`. The bundled MCP
still exposes the latter. Preserve the returned voice ID unchanged.

For IVC, docs recommend ≥22 kHz/16-bit audio. For PVC, optimal recording guidance
is mono linear PCM WAV, 48 kHz/24-bit, -23 LUFS ±0.5, true peak ≤-5 dBFS and noise
floor ≤-60 dB. These are quality recommendations, not universal upload rejection
rules. Record one speaker, with consistent accent and natural expressive range.
Avoid silence padding to reach the minimum. Do not convert a lossy recording
and claim the conversion restored its quality. Noise removal is optional and can
harm already-clean audio; leave it off unless the samples justify it.

Local helper scope: checks file count/bytes/duration, PCM WAV completeness and
identical-file hashes, then warns on quality recommendations. Portal's 12 MB
is conservatively treated as 12,000,000 bytes locally; IVC API has no size ceiling
asserted by this helper. It neither performs loudness measurement nor estimates
usable speech or trimmed server duration. Evaluate existing PVC samples with
server get data before adding new material; helper totals describe only supplied
local files, not remote cumulative storage. To bound local I/O it skips inspection
of files over 1,000,000,000 bytes; this is not an asserted IVC API size limit.

Primary sources:

- [IVC onboarding](https://docs.inworld.ai/tts/instant-voice-cloning)
- [Clone API contract](https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/clone-voice)
- [PVC onboarding and plan limits](https://docs.inworld.ai/tts/professional-voice-cloning)
- [PVC upload contract](https://docs.inworld.ai/api-reference/pvcAPI/pvcvoiceservice/upload-pvc-voice-samples)
- [PVC train contract](https://docs.inworld.ai/api-reference/pvcAPI/pvcvoiceservice/train-pvc-voice)
- [Recording recommendations](https://docs.inworld.ai/tts/best-practices/voice-cloning)
