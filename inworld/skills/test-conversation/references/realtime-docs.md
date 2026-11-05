# Official Realtime contract notes

Verified against public Inworld docs on 2026-10-17. These are Inworld Realtime
facts, not a claim that every OpenAI-compatible provider or framework behaves the
same. Check the current docs and installed framework before changing app behavior.

- [Overview](https://docs.inworld.ai/realtime/overview): one Realtime connection
  carries input and response events. The plugin's batch MCP process is not the
  app's voice transport.
- [Managing conversations](https://docs.inworld.ai/realtime/usage/managing-conversations):
  speech boundary events are `input_audio_buffer.speech_started` and
  `input_audio_buffer.speech_stopped`. With `interrupt_response: true`, detected
  speech automatically cancels the active response. An explicit `response.cancel`
  is therefore not required in every interruption trace.
- [Configuring models](https://docs.inworld.ai/realtime/usage/using-realtime-models):
  VAD silence settings are thresholds, not response latency promises.
  `response.done` can report cancellation or failure. Generation completion does
  not mean the playback queue is empty. `force_uninterruptible` affects automatic
  interruption; explicit cancellation/replacement still applies. A
  `conversation.item.truncate` may follow stopped playback even after generation
  has finished. Derive its audio offset from the player's actual position, never
  bytes received or a guessed duration.
- [Tool calling](https://docs.inworld.ai/realtime/usage/tool-calling): correlate
  `response.function_call_arguments.done` and the submitted `function_call_output`
  using `call_id`. Inworld's `providerData.auto_tool_response` defaults to `true`:
  adding the output starts continuation, so also sending `response.create` risks
  duplication. With `false`, the client starts continuation. Test the configured
  mode rather than imposing an OpenAI client's default on Inworld.

The app markers in the sample are **local instrumentation conventions**. They
are not Inworld events. New connection epochs and recovery of app state must be
observed; this skill makes no claim of transparent server session resumption.
WebRTC audio may arrive on a media track without WebSocket audio delta events.
Use framework/player observations or report that dimension as not measured.
