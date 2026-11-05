---
name: test-conversation
description: "Test voice conversations with offline scenarios and event-log checks. Use for interruptions, pauses, tool calls, reconnects and finalization."
---

# Test a voice conversation

Test a realtime voice conversation in the developer's existing app or framework using offline scenarios and event-log assertions for interruptions, pauses, noise, tool calls, reconnects, and finalization. Use for conversation behavior regressions, rather than isolated TTS quality or STT accuracy benchmarks.

Use the developer's app, framework tests, and captured logs. Start offline with
existing fixtures and stub tools; this skill does not require an MCP tool, hosted
harness, provider call, microphone, or speaker playback. Live testing needs the
user's authorization for the specific app, provider cost, audio capture/playback,
and tool side effects. Never treat invoking this skill as permission to make real
bookings, send messages, train voices, change global settings, or replay production
audio. Keep business tools stubbed unless separately authorized.

1. Find the app entrypoint and its test command, transport (WebSocket/WebRTC),
   framework and installed version, VAD/turn owner, audio queue, cancellation
   path, tool dispatcher, reconnect policy, and cleanup path. Reuse them. If no
   app or log is available, run the bundled synthetic example and return the
   missing evidence; don't create another service. For a new integration, use
   `add-realtime` when available, then return here to test it.
2. Choose relevant cases from [scenarios.md](references/scenarios.md). State the
   expected behavior using the app's actual configuration. In particular, automatic
   interruption and tool continuation change which client messages are expected.
   Review [current Realtime facts](references/realtime-docs.md); recheck official
   docs before relying on a changed API contract. In framework apps, inspect actual
   callbacks/frames and map those signals instead of pretending they are wire events.
3. Capture or import redacted app test logs. Use the explicit adapter and coverage
   contract in [event-log.md](references/event-log.md). Retain case, connection epoch,
   response/item/call IDs, direction, and capture order. Log queue invalidation,
   enqueue/drop, tool-stub results, and cleanup only where those operations actually
   occur. Do not infer them from a transcript or a server audio delta. Mark unobserved
   capabilities absent. Keep existing logs intact; adapt a local redacted copy.
4. Copy [example-plan.json](assets/example-plan.json) into the app's existing test
   fixtures and replace its example identifiers/selectors with actual IDs. Use narrow
   case windows: a mid-utterance pause window differs from the completed user turn.
   Declare expected terminal response statuses and counts per response. Add checks
   for relevant observed `error` events, failed responses, duplicate tool execution,
   and pending responses at disconnect. The evaluator checks only declared assertions;
   it is not an automatic protocol validator or a conversation quality judge.
5. Run the evaluator locally (paths below are relative to this skill directory):

   ```sh
   node scripts/evaluate.mjs assets/example-log.json assets/example-plan.json
   # Actual app export, after adapting its schema and editing expectations:
   node scripts/evaluate.mjs /path/to/redacted-app-log.json /path/to/app-plan.json
   ```

   The included log is **synthetic** and contains no measured timestamps. Its pass
   verifies helper behavior only. Preserve that label in reports. Timing assertions
   require actual timestamps from a shared monotonic clock and an explicit budget;
   don't supply estimated timings to fill gaps.
6. Report each case's expectation, result, evidence row indices, provenance, and
   observation gaps. Separate `passed`, `failed`, `incomplete`, and `not_measured`.
   Retest the relevant existing app tests after a local fix. State separately whether
   any live session or human listening review occurred. Events can show generation,
   queue operations, and lifecycle handling; they cannot establish what a person
   heard or prove intelligibility, naturalness, or subjective quality. Recommend a
   scoped listening review only when those properties matter to the request.
