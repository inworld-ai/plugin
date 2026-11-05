# Offline log and adapter contract (version 1)

The evaluator reads two JSON files, never executes a log or plan, makes no API
requests, and writes only its JSON report to stdout. No external dependencies.
Use a redacted export from the developer's test logger; do not commit credentials,
session tokens, user transcripts, tool outputs, or raw audio. Payload fields not
used by assertions may be removed. Preserve IDs consistently across rows.

## Log envelope

See [example-log.json](../assets/example-log.json). Required top-level fields:

- `schema_version: 1` and `provenance: "synthetic" | "recorded" | "unknown"`.
  Recorded means exported from an actual app run; describe offline/live separately
  in the run report. Never relabel the example as recorded.
- `adapter`: all six canonical field names mapped to explicit dot paths on each
  source row. The supplied identity adapter expects `case`, `session`, `direction`,
  `event`, `at_ms`, and `clock`. There are no implicit aliases, time conversions,
  direction guesses, protocol mappings, or default connection IDs.
- `cases`: object keyed by case ID. Each has boolean `complete` and string array
  `observed`. `complete` means capture covers the entire declared scenario window
  without dropped rows, not that the app succeeded or merely closed its socket.
  The runner/exporter supplies this evidence. On logger loss, crash, pending
  capture, or unknown end boundary set false. `observed` enumerates instrumented
  capabilities; e.g. `wire`, `playback`, `tools`, `transport`, `fixture`.
  Instrumentation must cover the whole relevant window before asserting absence.
- `events`: capture-ordered source rows. Do not sort across clocks or concatenate
  independently logged streams without a known causal merge. Evidence indices
  in reports are zero-based positions in this original array.

Canonical row fields:

| Field | Meaning |
| --- | --- |
| `case` | Required declared scenario ID, assigned by the app test runner. |
| `session` | Required connection epoch ID. Change after reconnect even if business conversation ID is unchanged. |
| `direction` | `server` received wire event, `client` actually submitted wire event, or `app` actual local instrumentation. An intention to send is not a submitted event. |
| `event` | Object with required `type`. Preserve provider field names and nested IDs. Framework signals may be mapped to documented app events, without claiming wire equivalence. |
| `at_ms` | Optional finite nonnegative measured monotonic milliseconds, including zero. Omit if unknown. No conversion from media offsets, token counts, or estimated chunk lengths. |
| `clock` | Optional clock identity shared only by directly comparable timestamps. Different processes/time origins need distinct identities unless actually synchronized. Missing time/clock prevents timing measurements. |

Example mapping for a logger with `{ctx:{scenario,epoch},flow,payload,time:{mono,origin}}`:

```json
{"case":"ctx.scenario","session":"ctx.epoch","direction":"flow","event":"payload","at_ms":"time.mono","clock":"time.origin"}
```

Here `flow` must already use the canonical direction values. If it uses `rx/tx`,
map those explicitly in the developer app's existing export/test code and document
the mapping. Never treat a field named `timestamp` as milliseconds without checking
units and clock. Backward measured times within a case/clock are invalid input.

## App instrumentation used by the synthetic example

- `playback.invalidated`: player has stopped/cleared the old response queue and
  installed its stale-output guard. Include the invalidated response ID/epoch.
- `playback.enqueued`, `playback.dropped`: actual queue acceptance or rejection
  after that guard; `response_id` is retained. Neither establishes audible output.
- `playback.drained`: the player's actual queue-drained callback for that response.
  Do not emit this on receipt of `response.done`.
- `tool.stub_result`: local stub completed for the specified `call_id`.
- `transport.opened`, `transport.closed`, `capture.stopped`: actual transport and
  capture lifecycle callbacks. A close does not imply capture release.
- `fixture.started`, `fixture.ended`: runner boundaries for a known local fixture.

Add only instrumentation needed for the requested cases in the developer app.
If player internals are unavailable (e.g. a remote WebRTC sink), omit `playback`
coverage and report the gap. Server transcript/audio events cannot replace it.

## Plan and results

See [example-plan.json](../assets/example-plan.json). Plans require version 1 and
nonempty `checks`; each check needs a unique `id`, `case`, `kind`, and nonempty
`requires` capability array. Every selector must include `session`, `direction`,
and `event.type`. Additional dot paths under `event.*` match exact scalar values,
e.g. `event.response.id`, `event.response.status`, `event.item.call_id`. Missing
fields never match null. No regex, executable expressions, implicit correlation,
or fuzzy string matching. Set actual IDs from the app fixture in the plan.

| Kind | Fields | Evaluation |
| --- | --- | --- |
| `count` | `match`, nonnegative integer `exact` | Exact count in the case window; use zero for absence. Excess is a witnessed failure even in partial capture. Missing expected events fail only in a complete measured window. |
| `sequence` | `steps` (at least two selectors) | Ordered subsequence in capture order. Other events may occur between steps. Does not prohibit duplicates; add count checks. |
| `forbid_after` | `after`, `match` | No matching event after the first matching anchor through the case window's end. Missing anchor cannot pass. Use response/epoch selectors for stale-output rejection. |
| `latency` | `after`, `match`, finite nonnegative `max_ms` | Exactly one start/end, in order, with measured times on the same clock. Ambiguous/missing timestamps or anchors yield not measured. There is no built-in latency budget. |

`passed`: declared expectation satisfied in a complete measured window.
`failed`: witnessed violation or missing expected evidence in a complete measured
window. `incomplete`: missing case or open/truncated observation, even if partial
evidence looks correct. `not_measured`: missing required instrumentation or
unavailable/ambiguous timing. Capability declarations are trusted exporter inputs,
not facts the evaluator can reconstruct from event absence.

Overall precedence is failed → incomplete → not measured → passed, with every
check retained. CLI exit codes: 0 all passed, 1 any failed, 2 incomplete/not
measured, 3 invalid input. Invalid input is not a product failure. An empty plan
is invalid. No terminal status is inferred: assert the expected status per response.
The evaluator does not automatically flag unrelated API errors or a response with
`status: failed`; add explicit checks for those outcomes where relevant.
