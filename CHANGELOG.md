# Changelog

## 1.0.0 — 2026-11-05

First public release of the shared Inworld plugin.

- Voice discovery, auditions with TTS Reasoning, speech integration, pronunciation and voice-cloning preparation.
- Recorded and streaming transcription, conversation tests, inference benchmarks and model routing.
- Image and video workflows through the same Inworld connection.
- Shared source with Claude Code and Codex packages and adapters for the other supported harnesses. See [installation](INSTALL.md) for each host's capabilities and credential route.
- Explicit project updates with ownership checks: locally changed files block replacement; host configuration and credentials stay untouched.

Requires Node.js 20+. Bundles the pinned `@inworld/cli` 1.5.0 artifact; the plugin and CLI have independent versions. Direct installation is separate from official marketplace availability.

See [updating](UPDATING.md) before replacing an existing installation.
