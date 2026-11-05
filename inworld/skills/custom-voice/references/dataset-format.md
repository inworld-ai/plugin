# Local dataset helper contract

`prepare_audio.py` uses Python's standard library plus locally installed FFmpeg
and FFprobe. It does not download media, submit STT, read credentials, upload,
clone, train or play audio. All inputs are explicit local paths. It reads source
files, prints JSON, and writes audio only with `assemble --execute` to a fresh
output directory. Keep transcripts, plans and renders private and out of Git.

From this skill directory (use absolute paths for data):

```sh
python3 scripts/prepare_audio.py inspect /absolute/meeting.mp4 > /private/work/source.json
# For multiple audio tracks, choose the actual global audio stream index:
python3 scripts/prepare_audio.py inspect /absolute/meeting.mp4 --stream-index 1
python3 scripts/prepare_audio.py plan /private/work/recordings.json > /private/work/plan.json
# Review candidate IDs and set selection/review as described below.
python3 scripts/prepare_audio.py assemble /private/work/plan.json --output /private/work/dataset
python3 scripts/prepare_audio.py assemble /private/work/plan.json --output /private/work/dataset --execute
python3 scripts/prepare_audio.py validate /private/work/plan.json /private/work/dataset/dataset.json
```

The data directory and output parent must already exist. Inspect/plan output can
be large: redirect it to a private file, then summarize counts instead of dumping
a transcript into chat. Existing output directories are rejected, even if a prior
run failed. Optional `--normalize` applies bounded constant gain with measured
-23 LUFS / -5 dBTP targets and output checks; insufficient signal or a missed target
fails rather than silently claiming repair. No automatic denoising or limiting.

Exit 0 means the local command completed; it never means cloning is authorized,
speaker purity is proven, or the dataset is upload-ready. Failures return nonzero
with a JSON error. Failed assembly retains a `status: failed` receipt and partial
files in its new directory; it must not be uploaded as a successful dataset.

## Source manifest: recordings.json

Top-level fields:

| Field | Meaning |
|---|---|
| `version` | `1` |
| `target` | Intended speaker label/name used consistently in attribution |
| `settings` | Optional local selection/packing settings below |
| `sources` | 1–20 inspected source objects, each with complete normalized analysis |

For each source, copy the actual `inspect` output (`path`, `sha256`, `duration`
in seconds, `stream_index`, `timebase`, and `canonical_parent`). Add a unique `id`, a
`session_id` identifying the exact STT job/window, and `analysis`. Preserve
source URL/recording identity, retrieval date, chosen track, rights/consent evidence
and analysis-copy offsets as additional metadata when relevant. Do not put API
keys, signed URLs or raw request headers in a plan.

Inspection decodes the chosen track and checks each frame's presentation timestamp
against cumulative decoded samples. Duration is decoded sample count / source
sample rate, rather than container runtime. `timebase` records that count, rate,
timestamp tick, zero decoded origin and `presentation_origin_pts` (the first
decoded frame's exact container PTS). A constant presentation offset is accepted:
`presentation_seconds = decoded_seconds + presentation_origin_pts * timestamp_tick`.
Word times must use decoded seconds; subtract that offset from presentation-based
annotations explicitly. Audio-only STT copies must preserve decoded sample order;
record their conversion evidence. Gaps, overlaps, unavailable timestamps and decode
errors fail closed; timestamp rounding is bounded to one
container tick plus one sample without accumulating tolerance per frame. Assembly
and revalidation repeat the check. The scan has hard 64 MB stdout / 2 MB stderr
caps, a 2-million-record limit, and a 180-second decode-plus-parse deadline.
Both pipes are drained while the child runs; failures kill/reap it. Disk use is
bounded by the byte caps; records are parsed incrementally. Hashing is outside
that deadline and reads the original twice per inspection. Assembly and
revalidation each inspect again; no whole-workflow deadline is promised.

If rejected, create an explicit continuous, zero-origin local source with the
existing media tools, retaining the original and transformation evidence. Inspect
that new source and rerun STT on it, or explicitly reconcile and verify every
analysis offset against that exact source. Simply resetting/resampling timestamps
while retaining old STT word times can select another passage. This helper never
repairs timestamp discontinuities. Old manifests/plans without timebase evidence
must be inspected, reconciled and regenerated.

For split/re-encoded windows, set `canonical_parent.sha256` to the original
recording's hash and retain explicit evidence of that relationship. Use
`canonical_parent.offset_frames` for the window's exact start in the original
48 kHz coordinate system; `offset_seconds` is also accepted if frame-aligned
within floating-point tolerance. This offset is unrelated to speaker identity.
If both are supplied they must agree. Unrelated files retain the inspected
original hash and zero offset. Missing provenance cannot be inferred by this
helper; alternate encodings without a declared common parent remain a limitation.

`analysis` fields:

| Field | Meaning |
|---|---|
| `complete` | Must be true only for a successfully completed, matching analysis |
| `coverage` | `[0, source.duration]`, covering this entire exact source/window |
| `timebase` | Exact copy of the inspected source `timebase`, supplied only after verifying STT coordinates match that decoded zero-origin track |
| `provenance` | Nonblank job/result reference and description of how it was produced |
| `target_mapping` | `session_id`, matching `target`, `labels` array of strings, and nonblank `evidence` |
| `words` | Complete normalized word array, including other speakers and unknown words |
| `unscored_policy` | `allow-with-evidence` (default) or `exclude`; current Inworld confidence is unpopulated |
| `unscored_evidence` | Optional explicit attribution/selection evidence; otherwise mapping evidence is used |

Each word has `text`, `start`, `end` in **seconds relative to the selected audio
track/window from decoded sample zero** (matching `analysis.timebase`), `speaker` (a string or null), and optional `confidence` (0–1 or
null). For Inworld async output, read **all** `segments[].wordTimestamps`, convert
milliseconds to seconds, and convert present numeric speaker IDs to strings.
Missing labels become null, not `"0"`. Honor documented zero-time defaults only;
a missing end/invalid interval must not silently turn into a usable word.
Retain the original result separately, so normalization is auditable. Complete
coverage and attribution are supplied evidence, not facts the helper authenticates.

Do not strip other speakers, uncertain words or overlaps before planning: they
are the barriers that keep candidate runs from crossing unwanted speech. Invalid
intervals reject the analysis. Exact repeated words are deduplicated; overlapping
words (including same-label overlaps), other/unknown speakers and low meaningful
imported confidence break runs. Omitted/all-zero confidence stays unscored and can
remain eligible with explicit evidence; it is never a confidence pass.

The helper cannot identify music, untranscribed interruptions, speaker identity or
acoustic purity. Omit entire uncertain candidates from selection. If finer cuts
are needed, re-plan with suitable whole-word limits and fresh evidence rather
than editing candidate timestamps past a boundary.

## Settings and selection

Current defaults are local preparation policy, not API requirements:

- `max_gap: 0.3`, `min_clip: 0.5`, `max_clip: 30` seconds. Choose appropriately
  for the recording; prefer intact phrases and varied longer passages when useful.
- `min_confidence: 0.8` applies only to meaningful imported nonzero confidence.
- `holdout_seconds: 30` reserves whole candidates first; use a larger, varied
  holdout when evaluating similarity. The report flags an unmet reservation.
- `train_cap_seconds: 7200`, `max_pack_seconds: 600`, `max_files: 50`,
  `max_bytes: 1000000000`. Current service/training limits still need verification.
  These settings bound local preparation; they do not promise service acceptance.

`plan` retains the manifest, derived candidates, diagnostics and a proposed
`selection: {"train": ["clip-id"], "holdout": ["clip-id"]}`. IDs bind the word
ranges, source, attribution and analysis evidence. The automatic proposal can
need adjustment if it reserves all available material or includes an uncertain
candidate. Leave excluded candidates unselected. Select whole candidates, never
expand their ranges in the plan. At least one training clip is needed; an empty
holdout or short reservation is reported rather than invented.

After reviewing the requested selection, set `review` to:

```json
{"status":"reviewed","by":"agent-or-reviewer-id","evidence":"Selection basis and unresolved acoustic limitations"}
```

This is a plan-level selection record, not a human listening attestation. The
agent can supply its own identifier and evidence within the requested task; no
per-clip checkbox or repeated approval is required. Speaker/source rights and
voice consent remain separate and must be established before remote cloning.

Assembly regenerates candidates from retained analysis and rejects edited ranges,
unknown/repeated IDs, duplicate source hashes and overlapping canonical intervals,
including train/holdout overlap. Repeated transcript phrases are warnings, not
proof of duplicated audio; distinct takes of the same phrase can be useful.
Identical decoded selected PCM is rejected, even with different transcript text.
This is exact-content detection, not a robust perceptual duplicate detector.

## Render receipt and revalidation

Each selected range is decoded to mono 48 kHz 24-bit PCM WAV. Originals remain
unchanged. Individual training clips stay in `clips/`, holdout in `holdout/`, and
only training frames enter bounded files in `packed/`. WAV packing writes one
truthful header, including odd-byte RIFF padding; it never concatenates headers,
adds silence, time-stretches or crossfades. Formats are rechecked from actual bytes,
including PCM WAVE_FORMAT_EXTENSIBLE on older Python versions.

`dataset.json` records selected intervals/words, attribution, source/plan hashes,
actual file duration/frames/bytes/hashes, signal checks and optional loudness
measurements. Each packed mapping has integer `packed_start_frame`/
`packed_end_frame`, source/clip hashes and original/canonical frame ranges.
Source hashes are checked before and after preparation; cheap stat checks detect
mid-run changes without rehashing a large source for every clip. Revalidation
checks source hashes, selection, actual PCM and the complete packed range mapping.

`selected_train_interval_seconds` includes short gaps; `summed_train_word_seconds`
is a timestamp-derived diagnostic, not independently measured speech duration.
`actual_train_seconds` and `actual_holdout_seconds` describe rendered files. The
600-second file-duration indicator only compares local output length with the
documented minimum; server trims, current quota, rights and quality remain pending.
`upload_ready` deliberately stays false. Runtime summed over overlapping windows
is not unique original-recording coverage. Inspect the report, then follow the
[recording workflow](preparing-recordings.md) and [PVC lifecycle](pvc-lifecycle.md).

The separate `preflight.py` inspector hashes decoded integer PCM plus sample
rate, channels and bit depth for exact duplicate detection. Container metadata
changes do not make new speech: duplicate samples fail, and
`unique_decoded_duration_seconds` excludes repeated PCM from the PVC minimum.
This does not detect partial overlap, lossy re-encodings or perceptual similarity;
unsupported formats remain incomplete.

The signal check rejects silence/full-scale output; it cannot establish clean
speech or perceptual quality. Hashes establish local integrity, not the truth of
provided evidence. Long files can take time to decode and scan; inspect/select
bounded windows when useful. No dependency installation happens automatically.
