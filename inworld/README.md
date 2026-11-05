# Inworld AI

[Installation guide](https://github.com/inworld-ai/plugin/blob/main/INSTALL.md) · [Updates](https://github.com/inworld-ai/plugin/blob/main/UPDATING.md)

Build and test voice and AI experiences inside your coding agent. Describe the voice you want, audition it on your own script, and integrate natural speech into your app. Transcribe recordings or live audio, tune pronunciation and alphanumeric delivery, or prepare a consenting speaker's recordings for voice cloning.

Evaluate Inworld inference on your app's real requests, comparing latency, cost and quality before choosing a model. Configure model routing and fallbacks, or generate images and videos through the same Inworld connection.

## Try it in your coding agent

- “Find a warm British voice and let me hear it on my app's welcome message.”
- “Benchmark Inworld against the inference provider in this project using representative requests.”
- “Transcribe this recording with speaker labels and check names, dates and numbers.”

## What you can build

- **Find the right voice.** Describe the character, accent and delivery, then audition voices on the lines your app will actually say.
- **Build natural speech.** Add TTS and streaming audio, direct delivery with TTS Reasoning, and handle names, specialist terms and alphanumeric IDs.
- **Understand recorded and live audio.** Add transcription, speaker labels, vocabulary hints and turn detection; evaluate accuracy on your own audio.
- **Create a custom voice.** Prepare recordings from a consenting speaker, isolate speaker samples and work through instant or professional voice cloning.
- **Choose and test inference.** Benchmark real app requests, review latency, cost and quality, then configure models, routing and fallbacks.
- **Generate images and video.** Create or edit images and manage video generation jobs with Inworld's media models.

## Connect your account

[Create an Inworld account](https://platform.inworld.ai/signup?utm_source=other-agent&utm_medium=agent-plugin&utm_campaign=inworld-plugin&utm_content=readme) or [get your API key](https://platform.inworld.ai/api-keys?utm_source=other-agent&utm_medium=agent-plugin&utm_campaign=inworld-plugin&utm_content=readme), then configure it in your agent's approved Inworld credential settings. Keep the key out of chat and version control.

The plugin uses one Inworld connection for its supported tools; no second API key or feature-area package is needed. Preparing text and test scenarios can stay offline. Generation, uploads, voice training and other writes run only when requested. Native audio playback depends on your agent. It helps the agent build with Inworld; native providers powering the agent itself are separate integrations.

## Data and services

API tools send the selected text, audio, prompts and settings to Inworld; routing can use upstream model providers. Documentation search sends its query to Inworld's docs service. Local preparation stays local until an authorized upload. The coding agent's own data handling follows its host. Requests identify the plugin and host separately from the CLI SDK; no install beacon or additional analytics SDK is included.

[Documentation](https://docs.inworld.ai) · [Support](https://docs.inworld.ai/portal/support) · [Privacy](https://inworld.ai/privacy)
