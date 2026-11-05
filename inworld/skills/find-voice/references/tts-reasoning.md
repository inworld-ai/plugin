# TTS Reasoning integration

Reasoning asks the service to generate a delivery instruction from the text and
optional scene/character context. It is separate from LLM reasoning effort.

```json
{
  "text": "We made it. I honestly didn't think we would.",
  "voiceId": "Dennis",
  "modelId": "inworld-tts-2",
  "deliveryMode": "CREATIVE",
  "synthesisContext": {
    "reasoning": "REASONING_ON",
    "reasoningContext": "A relieved teammate after a difficult rescue."
  }
}
```

Use native REST `/tts/v1/voice` or HTTP `/tts/v1/voice:stream`. The API also documents Reasoning on async synthesis. WebSocket duplex does not expose these controls; batch support is documented as forthcoming. Do not silently change the app's transport
or latency budget. Context is at most 600 characters, never spoken; earlier turns
belong in `previousRequests`. Preserve existing synthesis context when adding
these fields. An explicit request instruction takes precedence; inline tags take
over from their position. Do not combine manual steering and generated steering
in an experiment without labeling that condition.

The response's `reasoningInstruction` reports the instruction applied. On HTTP
streams, capture it from the first response message even if that message has no
audio. Read through EOF and preserve trailing errors. An absent instruction does
not distinguish abstention, workspace enablement, timeout or fallback.

`REASONING_UNSPECIFIED`/omission preserves workspace policy, which can opt in to
Reasoning by default. There is no documented OFF enum; never invent one. For a
controlled off/on study, verify the workspace default is off before interpreting
the baseline as off. Otherwise label it default/requested and report that limit.

Delivery mode and Reasoning are separate controls. The audition tool defaults Reasoning comparisons to CREATIVE for both conditions; callers can explicitly select another supported delivery mode. Keep that setting fixed when comparing clips rather than treating variation as a Reasoning effect. Use the public model ID `inworld-tts-2`; Flash is unsupported. Report API rejection without automatically retrying a paid request.

Sources: [synchronous synthesis](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech), [HTTP streaming synthesis](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-stream). The public reference describes `REASONING_UNSPECIFIED` as not running Reasoning. The plugin's omitted/default setting is not an explicit OFF control; preserve server behavior and report returned evidence rather than promising an off/on experiment.
