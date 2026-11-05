---
name: benchmark-stt
description: "Benchmark speech recognition on recordings or live replays. Compare transcript accuracy, speaker labels, latency, failures and cost."
---

# Evaluate speech recognition for this app

Evaluate speech recognition on the app's real recordings or live-audio replays: transcript accuracy, names and numbers, turn completion, speaker labels, latency, failures and cost. Use when choosing STT options, checking transcription quality or comparing speech models/providers. Does not require a provider migration.

Use the app's existing audio, client, fixtures and requirements. This is a small
project-local experiment, not a new benchmarking service. Read the Inworld
[feature guide](../add-transcription/references/features.md) and current mode docs.
Use the agent's existing knowledge of the app; don't repeat discovery or require
credentials for a provider the user is not evaluating.

## Freeze an evaluation set

Select representative recordings with permission: target languages, actual mic or
telephone codecs, short commands and longer speech, pauses, noise, names/numbers,
and multiple speakers if relevant. Keep IDs for every sample, including failures.
Create human-checked references and critical entities. Separate vocabulary/turn
configuration tuning samples from held-out evaluation samples. Don't use only
Inworld-generated clean speech as proof of production accuracy.

Use the same source audio for compared configurations/providers, respect supported
rates and formats, and record any necessary transcoding. For streaming latency, replay PCM at its real audio cadence and record setup time;
blasting a file as fast as possible measures a different workload. Never silently remove
silence, hard cases, accents or failed requests. If the task is choosing an Inworld
feature, compare that feature off/on; an external baseline is optional.

## Measure the user's outcome

- **Accuracy:** corpus WER with documented normalization; CER for languages where
  word segmentation makes WER misleading. Inspect insertions/deletions, not just
  spelling. Keep raw transcripts available for human review.
- **Critical terms:** exact IDs/digits and app-relevant names/amounts, separately
  from normalized WER. A low WER can still give the wrong account number.
- **Streaming:** first partial from audio start, final from audio start, and
  end-of-speech → final as distinct clocks. Exclude no setup/connection time
  silently. Partial text isn't final; a quiet period isn't proof of completion.
- **Turns/speakers:** premature splits, lost final tail, speaker attribution and
  overlap on annotated samples. Do not claim a speaker-error rate without labels.
- **Reliability/cost:** successes/attempts, errors, retries, stream completion and
  usage; cost per actual audio hour using the applicable plan/add-ons. Unknown
  usage/prices remain unknown, not zero. Include idle/billed duration where relevant.

For comparisons, preserve required features and fairly tune vocabulary/endpointing
on each side. Report default and tuned runs separately. Do not compare first
partial on one side to final on another, hide failures or claim Inworld always wins.

## Run and report

Adapt the app runner to write JSONL records using the contract in
[scoring notes](references/scoring.md). The optional
[offline scorer](scripts/score.py) computes transcript errors and latency summaries;
it makes no API calls, reads no keys and uploads nothing. Run:

```sh
python3 path/to/benchmark-stt/scripts/score.py ./stt-results.jsonl --output ./stt-summary.json
```

Show a compact table by model/config and relevant language/audio stratum: attempted,
succeeded, incomplete, labelled samples, WER/CER, critical-term exact match,
median/p95 timing with counts, and measured cost when known. Show bad examples and
confidence limits; few samples do not establish dependable tails. A missing
reference does not mean zero errors. Keep model IDs, options, time, region and
normalization with the report. Report skipped runs honestly.

Recommend the smallest useful change from the evidence, then rerun the app's
caption/voice-agent/dictation path. Separate correct recognition from downstream
LLM rewriting and TTS quality. Do not migrate providers unless requested.
