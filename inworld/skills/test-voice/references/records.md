# Offline record contract (version 1)

All files are UTF-8 JSON. The helper reads only the three explicit paths, never
credentials, audio contents or network endpoints. It prints JSON and does not
write files itself. Duplicate JSON keys, nonfinite values, duplicate/unknown
case IDs, unsupported versions and mismatched manifest hashes are invalid.

## Manifest

Start with `../assets/manifest.json`. `suite_id` identifies the evaluation.
Each case has a stable `id`, exact `text` sent to TTS, `language`, `source`,
`split` (`tuning` or `held_out`), `expected` reading and named `checks` for
listening. At least one held-out case is required. Include text cleaning,
per-case request overrides and streaming chunk boundaries as extra case fields
when the app uses them; all manifest fields are covered by the hash.
`request_options` on a manifest case must be an object of top-level overrides
on the run's `config.request_options` (nested values replace, rather than merge).

`allowed_config_changes` lists top-level config keys varied deliberately. An
unplanned difference in any key (including extra keys) makes comparison
inconclusive. Use narrowly scoped keys: allowing `request_options` as a whole
permits all nested option changes, so review the full diff. Changing a config
field does not change the utterance set. To compare text transformations,
freeze both variants and their mapping in the manifest before rendering.

`metrics` is optional. Each policy requires `unit`, `definition`, `direction`
(`lower` or `higher` is better), `max_regression` (absolute tolerance in that
unit), and boolean `required`. Values at the boundary are within tolerance.
Use the same clock boundaries and measurement procedure on both sides; freeze
them in `definition`. For example first playable audio from request start is
different from provider time-to-first-byte. A metric is a recorded scalar per
case, not an inferred score or a corpus percentile. Cost requires known usage
and an applicable price; unknown cost is null, never zero.

## Run

Copy `../assets/result-template.json` once per side. Fill in:

- `schema_version: 1`, unique `run_id`, `recorded_at` (UTC timestamp),
  `manifest_sha256` from `compare.py manifest.json --hash`.
- `provenance`: `simulated` for fabricated/rehearsal records, `recorded` only
  for actual saved app render outcomes. An imported run is still `recorded`;
  add `origin` and record where it came from. Provenance is self-reported.
- `config`: exact model, voice, language/default policy, normalization,
  dictionary_version, app_version, request_options object, audio_format, and
  any other material config keys. Use `none` for no dictionary, `unset` for
  an omitted setting. A null, blank or missing required config is invalid.
  Record unknown immutable revisions as limitations; do not claim repeatability
  from an alias. Neither a hash nor this helper authenticates provider metadata.
  Put explicit caveats in run-level `limitations`, including any unknown model,
  voice or dictionary revision; those caveats are retained in the report.
- `cases`: one row per case ID. `status` is `ok`, `error`, `incomplete` or
  `skipped`. Keep `attempts` including retries. Non-skipped rows require at
  least one attempt; non-ok rows require a `reason`. `ok` requires `audio_ref`.
  A missing case is counted/reported, not silently removed. Attach errors and
  request IDs as extra fields without secrets. `ok` means audio completed,
  not semantic quality.
- Optional effective-input echoes (`text`, `language`, `request_options`, other
  run config keys or generation fields frozen on the manifest case) must exactly
  match that case's manifest/run configuration, including JSON value types.
  `request_options` echoes contain the full effective object after case overrides.
  Omitting echoes preserves the existing fixture contract; it is a declaration
  of the frozen inputs, not independent verification of the render request.
  Unsupported per-case metadata is rejected with a field-specific error so
  generation settings cannot disappear silently. Observational fields `error`,
  `errors`, `request_id`, `request_ids`, `origin`, `limitations` and `recorded_at`
  remain supported; freeze other generation metadata on the manifest first.
- `metrics`: name to finite numeric value or null. Omitted/null is unknown.
  Integers outside the finite float range and overflowing metric deltas are
  invalid input, reported as structured errors with exit 2.
  Extra metric names are listed as unscored; no direction or threshold is
  guessed. Required unknown metrics make the result inconclusive; optional
  unknowns remain visible without blocking a comparison.
- `reviews`: keyed by manifest check name. Each entry has `status` (`pass`,
  `fail`, `unknown`). Pass/fail requires `listener`, `notes`, and `audio_ref`
  matching the rendered row. Unreviewed checks stay unknown. The helper checks
  the record structure, not whether the listener actually listened or whether
  a reference exists. Do not put simulated reviews in recorded runs.

Example evidence fragment after actual listening (illustrative shape only):

```json
{
  "id": "reference",
  "status": "ok",
  "attempts": 1,
  "audio_ref": "clips/run-b/reference.wav",
  "metrics": {"first_audio_ms": null},
  "reviews": {
    "exact_id": {
      "status": "fail",
      "listener": "reviewer-id",
      "audio_ref": "clips/run-b/reference.wav",
      "notes": "At 1.2 s the leading zero was omitted."
    }
  }
}
```

No-regression requires complete successful rows and listening checks on both
sides, no candidate listening failures, and known required metrics. An inherited
candidate defect makes the result inconclusive even if it is not a new
regression. Baseline fail → candidate pass may be an improvement, but is not
proof of general correctness. A candidate render error/incomplete after a
successful baseline, pass → fail review, or numeric threshold breach is a
regression when provenance/config permit comparison. Simulated or unplanned
config differences always take precedence as inconclusive; observed deltas
remain in the report for diagnosis. Invalid input exits 2 with JSON on stderr.

The report's `source_records.baseline` and `source_records.candidate` preserve
complete snapshots of the supplied runs, including unchanged config, collection
times, imported origins, limitations, request/error metadata and every listening
review's listener, notes and audio reference. These are self-reported evidence,
not authenticated observations. Keep secrets out of source records: they will
also appear in the report. The compact per-case summary remains available for
comparison; unknown review states and missing records are not promoted to passes.
