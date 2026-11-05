# Offline scorer record contract

One JSON object per attempted sample/configuration, with a stable sample `id`.
Write errors as rows too. Repeated runs need unique IDs; use a shared manifest to
verify every configuration attempted the same set. Example synthetic record:

```json
{"id":"call-01","configuration":"inworld-vocab-on","stratum":"en-telephone","status":"ok","complete":true,"reference":"Your reference is AB12.","hypothesis":"Your reference is AB12.","critical_entities":{"booking_id":"AB12"},"latency_ms":{"first_partial":130,"final_from_audio_start":1800,"end_of_speech_to_final":350},"cost_usd":0.001}
```

An error record retains ID, configuration, stratum, `status: "error"`, reason and
any known cost. Include references/entities when known so failure denominators
remain visible. Do not add unknown latency/cost as zero. Record all trials; don't
rerun failures until a configuration looks good. Keep region/model/settings and
measurement methodology in an adjacent report; do not put secrets in either.

The scorer reports corpus edit-distance WER/CER on **labelled successes**, alongside
failed, incomplete and unlabelled counts. Failures aren't silently scored as empty
successful transcripts. Unicode word-run tokenization is inappropriate as a word
segmenter for many scripts; CER and human review are often more useful. Punctuation
and case normalization is documented in the output; exact names/numbers remain a
separate case-sensitive occurrence check on raw output. That proxy cannot assess
semantic correctness, false-positive entities, speaker identity or diarization.
Do not present it as an entity F1 score. Keep empty references as silence cases:
insertions are counted, but a zero total reference denominator yields unknown.

Latency percentiles use successful measured samples only; keep failure/timeout
rates adjacent. First partial, final, setup and end-of-speech clocks must not be
mixed. Small-N p95 is labelled exploratory. Costs sum only when all attempts have
known costs; partial costs are separately reported. Cost per audio hour additionally
requires trustworthy duration/usage and the applicable plan/add-on prices.

This helper is optional. Prefer the app's existing evaluation runner where it
already handles segmentation, speaker labels or critical-entity extraction.
