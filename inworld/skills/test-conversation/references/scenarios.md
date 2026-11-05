# Choose cases in the existing app

Use the app's existing audio fixtures/test framework. Stub provider events for
offline execution; feed prerecorded audio to a provider only when authorized.
Record source, test command, configuration, fixture hash/path, relevant IDs, and
whether the run is synthetic, recorded, or unknown. Change one turn setting at a
time when comparing behavior. No universal timing thresholds are assumed here.

| Case | Exercise | Event-level expectation and limits |
| --- | --- | --- |
| Interruption | Start an assistant turn, inject user speech while output is queued, then deliver an old output chunk after cancellation. | With automatic interruption enabled, observe cancellation and the app stopping/clearing queued output. Otherwise check the app's explicit cancel path. Check stale output is dropped and never enqueued after invalidation for that response/epoch. Late network delivery alone is not a failure. Use a separate scenario if interruption is intentionally disabled or protected. |
| Mid-turn pause | Split one user utterance around a local silence fixture; also test a true end-of-turn in a separate window. | For the app's chosen pause fixture/configuration, check no premature response during the pause window; then check one intended response after the full turn. Do not require all pauses to be ignored. The example covers only the no-response window. Actual VAD behavior requires recorded provider evidence, not synthetic speech boundary events. |
| Noise / empty input | Reuse local room-noise, breath/click, and silence fixtures individually. | Declare the expected behavior for each fixture, often no response or tool call. Record fixture start/end and complete wire observation. Absence of speech events cannot prove silence/noise was sent or correctly recognized. A response count alone does not score STT quality. |
| Tool success / slow / error | Stub a deterministic result, a delayed result, then a tool error. Add a duplicate call replay if the app supports idempotency. | Correlate call IDs through dispatcher execution, output submission, and intended continuation; assert execution/output counts. Check one continuation in automatic mode, explicit creation in manual mode. Check the app's intended error/cancel behavior; a submitted output does not establish that a business action happened. Do not run the real business tool. |
| Reconnect | Drop the existing test transport during an active response, reconnect through the app's policy, then inject an old callback. | Check old queue invalidation, distinct connection epoch, new session configuration acknowledgment, and old-epoch output rejection. Test the app's retry/backoff limit with its fake clock, not a live retry loop. Do not count a new socket opening as proof that context was restored. If restoration is intended, assert its actual app events/items. |
| Finalization / early close | Stop after a normal response; separately stop mid-response or during a pending tool call. | Check each expected response terminal status, audio drain or intentional discard, microphone/capture release, and transport closure. A cancelled turn can be correct. A failed response is different from a truncated capture. Pending tools/responses without terminal evidence leave capture incomplete unless a closed fully observed window proves an expectation failed. A close event alone is insufficient. |

Translate expectations into narrow plan assertions with actual correlation IDs.
Add `count` checks for duplicate execution/follow-up and for forbidden errors/statuses
within each scenario. The sample tool check fixes one call ID and follow-up ID;
it does not discover all calls or validate argument semantics. Generate a check per
actual expected call/response from the app fixture, rather than using a broad
"some response finished" selector.

Measure, when available, speech-stop receipt → first output delivery and
interruption notification → player invalidation as different metrics. Neither
is mouth-to-ear latency. Use playback callback timestamps for a playback metric,
and retain their clock identity and measurement method. Human review of saved
audio, when authorized, is a separate result with its own rubric.
