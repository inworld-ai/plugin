# STT in LiveKit, Pipecat and existing voice stacks

Inspect dependencies and installed versions first. Read the installed integration
interface plus current [Inworld integration docs](https://docs.inworld.ai/tts/integrations.md)
and the framework's official docs. TTS support in a framework does not establish
STT support. Verify that the installed version actually exposes an Inworld STT
adapter; do not invent a class name from another vendor's package.

## Keep the existing transport and one endpointing owner

- If a maintained native Inworld STT adapter exists for the installed version,
  prefer it. Match its audio input contract and transcript/event outputs.
- If not, use the framework's documented custom-STT interface around the current
  Inworld API. Do not replace the whole agent pipeline just to change STT.
- Identify whether the framework VAD/turn detector or the STT service ends turns.
  Two independent detectors can prematurely split, double-finalize or delay a turn.
- With framework-controlled/manual STT turns, send endTurn at the framework's
  boundary while leaving the socket open. Observe the manual turn cap. At final
  shutdown, flush remaining audio and closeStream once; drain until server close.
- With STT-controlled turns, let Inworld's final events drive endpointing and
  configure the framework consistently. Do not append an extra endTurn after
  every final. Speech-start/stopped events are activity, not transcript completion.
- Barge-in must cancel queued TTS/playback in the app as well as mark recognition
  state. An STT speech event alone does not stop the speaker device.

## Preserve useful data

Forward interim/final status, word timings and optional speaker/profile results
through the framework's supported frames. If its adapter discards fields the app
needs, retain them in an explicit extension rather than inventing frame members.
Keep original timing origins/units; do not compare wall clocks to media offsets.

For telephony, inspect the decoded PCM rate and channel layout. Do not stream
mu-law bytes as LINEAR16. With a stereo call recording, confirm the app's channel
and speaker requirements before downmixing; diarization is not equivalent to
pre-separated channels. Reconnects need fresh browser tokens and an explicit
policy for buffered audio so retries do not silently lose or duplicate speech.

## Verify in the app

Use an ordinary utterance, hesitant speaker, interrupting caller, domain name,
quiet segment, abrupt hangup and network failure. Confirm final transcripts,
no duplicate turn commits, responsive interruption, released capture/connection,
and reported usage. Measure the full end-of-user-speech → agent response path
separately from STT first partial and finalization. Mark the exact adapter/version
and device transport tested; do not claim all framework versions work.

## LiveKit: verified native STT path

The official [Inworld STT plugin guide](https://docs.livekit.io/agents/models/stt/inworld/)
provides Python and Node adapters. Inspect installed versions before using them:

```sh
python -m pip show livekit-agents livekit-plugins-inworld
# or the project's Node package manager:
npm ls @livekit/agents @livekit/agents-plugin-inworld
```

Reuse the existing `AgentSession` and replace/configure only its STT component:

```python
from livekit.plugins import inworld
stt = inworld.STT(model="inworld/inworld-stt-1", language="en")
# Pass stt into the project's existing AgentSession; keep its LLM/TTS/transport.
```

```ts
import * as inworld from '@livekit/agents-plugin-inworld';
const stt = new inworld.STT({ model: 'inworld/inworld-stt-1', language: 'en' });
```

Use `INWORLD_API_KEY` server-side for the direct plugin. Inspect the exact
adapter options before passing Inworld REST fields through it; parameter casing,
feature exposure and defaults can differ. The current
[Node STT reference](https://docs.livekit.io/reference/agents-js/classes/plugins_agents_plugin_inworld.STT.html)
documents Voice Profile in `SpeechData.metadata.voiceProfile` and enables it by
default. Disable it explicitly via the installed version's supported option when
not used, or consume its ranked results if needed. Do not discard adapter metadata.

LiveKit Inference is a separate path with LiveKit credentials, billing and its
own supported-model/language list. Do not equate it with direct Inworld API access
or use one path's cost/feature claims for the other. Preserve the user's requested
path and label which path an evaluation used. Third-party guides can list legacy
model IDs; resolve supported models against current Inworld docs rather than
copying that list.

## Pipecat: verify STT support independently

The current official [Inworld service reference](https://reference-server.pipecat.ai/en/stable/api/pipecat.services.inworld.tts.html)
and example cover TTS. This research did not establish a native Inworld STT class.
Inspect the installed service modules before recommending one. If absent, use
Pipecat's current custom-STT/frame interface and the maintained streaming session
asset. Keep capture/resampling, cancellation and context aggregation under the
existing pipeline; use real frame types from that installed version. Do not copy
unrelated provider-specific settings, APIs or `mode` fields into an Inworld service.
