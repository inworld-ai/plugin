<img src="inworld/assets/icon.png" alt="Inworld AI" width="64" />

# Inworld plugin

Build, hear and test voice and AI experiences inside your coding agent. Find a voice for your app, transcribe audio, benchmark inference on your own workload, and integrate the result.

24 skills and one MCP connection with 28 tools. Works across Claude Code, Codex, Cursor and [other supported harnesses](INSTALL.md#supported-harnesses), with native packages, project adapters or skills-only support depending on the host.

## Install

Requires **Node.js 20+**. Install directly from the public Git repository below; official marketplace approval is separate. The [installation guide](INSTALL.md) includes local-checkout and generated-package routes.

### Claude Code

Install directly from the public Git repository:

```sh
claude plugin marketplace add inworld-ai/plugin
claude plugin install inworld@inworld
```

Configure the **Inworld API key** in the plugin's sensitive credential field.

### Codex

```sh
codex plugin marketplace add inworld-ai/plugin
codex plugin add inworld@inworld
```

The package forwards the explicitly configured `INWORLD_API_KEY` from Codex's launch environment. Desktop apps may not share your terminal environment. See [credentials](INSTALL.md#credentials).

### Cursor and other harnesses

Follow the [installation guide](INSTALL.md) for your host. This source distribution includes package generators; Cursor and the other adapters currently require a generated host package. The guide lists the commands and credential route for each target.

Installing through another agent? Give it [INSTALL_FOR_AGENTS.md](INSTALL_FOR_AGENTS.md).

## Try it

Ask your agent in the project you're already building:

> Find a warm British voice for our travel concierge. Let me hear a few options on our welcome message.

> Benchmark Inworld against this app's current inference provider using representative requests. Show latency, failures, cost and quality before changing anything.

> Add transcription for this recording. I need speaker labels and accurate names, dates and reference numbers.

The agent can choose a skill from your request. Native audio playback depends on the host; a generated file alone does not prove listening quality.

## What you can do

| Your task | Skills |
| --- | --- |
| Find a voice and compare it on real product lines | [Find voice](inworld/skills/find-voice/SKILL.md), [test voice](inworld/skills/test-voice/SKILL.md) |
| Add speech and control delivery with TTS Reasoning | [Add voice](inworld/skills/add-voice/SKILL.md), [streaming TTS](inworld/skills/add-streaming-tts/SKILL.md) |
| Handle names, pronunciation dictionaries and alphanumeric IDs | [Pronunciation](inworld/skills/pronunciation/SKILL.md), [speakable text](inworld/skills/speakable-text/SKILL.md) |
| Transcribe recorded or live audio and evaluate accuracy | [Transcription](inworld/skills/add-transcription/SKILL.md), [streaming STT](inworld/skills/add-streaming-stt/SKILL.md), [benchmark STT](inworld/skills/benchmark-stt/SKILL.md) |
| Prepare consenting speaker recordings for instant or professional cloning | [Custom voice](inworld/skills/custom-voice/SKILL.md) |
| Build a realtime conversation and test interruptions | [Realtime](inworld/skills/add-realtime/SKILL.md), [test conversation](inworld/skills/test-conversation/SKILL.md), [latency](inworld/skills/latency/SKILL.md) |
| Choose inference models and configure routing and fallbacks | [Benchmark models](inworld/skills/benchmark-models/SKILL.md), [add LLM](inworld/skills/add-llm/SKILL.md), [configure router](inworld/skills/configure-router/SKILL.md) |
| Generate or edit images and manage video jobs | [Images](inworld/skills/generate-image/SKILL.md), [video](inworld/skills/generate-video/SKILL.md) |
| Add structured decisions or move an existing integration | [Decisions](inworld/skills/add-decisions/SKILL.md), [migrate](inworld/skills/migrate/SKILL.md) |
| Connect, set up a project or diagnose an integration | [Connect](inworld/skills/connect/SKILL.md), [setup](inworld/skills/setup/SKILL.md), [doctor](inworld/skills/doctor/SKILL.md), [troubleshoot](inworld/skills/troubleshoot/SKILL.md) |

## Connect to Inworld

[Create an account](https://platform.inworld.ai/signup?utm_source=other-agent&utm_medium=agent-plugin&utm_campaign=inworld-plugin&utm_content=readme) or [get your API key](https://platform.inworld.ai/api-keys?utm_source=other-agent&utm_medium=agent-plugin&utm_campaign=inworld-plugin&utm_content=readme), then configure it through your host's approved secret settings. Keep keys out of chat and version control.

One key covers the supported API tools. Documentation search and local speech-text checks work without a key. Recording preparation may also need Python 3 and ffmpeg/ffprobe; the relevant skill checks its requirements.

The plugin helps your agent build with Inworld. Using Inworld as the host's own conversation voice or underlying model is a separate provider integration.

## Data and permissions

API tools send the selected text, audio, prompts and settings to Inworld. Routing may use Inworld-hosted or upstream model providers; documentation search sends its query to Inworld's docs service. Local preparation stays local until an authorized upload. External benchmark providers and judges require separate authorization for the workload and spend.

Installation does not authorize generation, uploads, training, publishing or provider changes. Requests identify the plugin and host separately from the bundled CLI SDK. No install beacon or additional analytics SDK is included. The coding agent's own data handling follows its host.

[Documentation](https://docs.inworld.ai) · [Installation](INSTALL.md) · [Support](https://docs.inworld.ai/portal/support) · [Privacy](https://inworld.ai/privacy) · [MIT license](LICENSE)

## Releases and updates

See [release notes](CHANGELOG.md) and [updating](UPDATING.md). All harness packages share one plugin version; the bundled CLI is pinned independently. Git tags identify reproducible releases. Marketplace refresh, local package replacement and project updates use different paths.
