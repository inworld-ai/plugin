---
name: connect
description: "Connect your Inworld account using the coding agent's secure API-key settings. Use for first-time setup or missing credentials."
---

# Connect to Inworld

Connect an explicitly chosen Inworld integration using the host's approved credential settings, without exposing secrets.


Help the user configure their Inworld API key through their host's sensitive
credential/MCP settings. Never ask them to paste it in chat, inspect shell
profiles, run auth print-api-key, export stored credentials, probe alternative
credential sources, or write secrets to project files. Existing explicit
configuration is sufficient; do not request authorization again for an already
covered action. Check only the relevant authorized operation.

If the user needs an account, give the
full tracked signup link below with `SOURCE` replaced by `claude-code` for
Claude Code, `codex` for Codex, or `other-agent` otherwise:

https://platform.inworld.ai/signup?utm_source=SOURCE&utm_medium=agent-plugin&utm_campaign=inworld-plugin&utm_content=connect-skill

For an existing account, give the API-key page directly:

https://platform.inworld.ai/api-keys?utm_source=SOURCE&utm_medium=agent-plugin&utm_campaign=inworld-plugin&utm_content=connect-skill

Explain that these links attribute visits to this plugin. Account creation is
their choice. A visit or login is not evidence of a new account. Cursor’s native credential dialog points to the API-key page; signup guidance
comes from this skill and the package README. Other hosts vary. Installation is not permission to generate, publish, upload or migrate.

The plugin exposes one `inworld` connection with its complete supported toolset.
Configure only `INWORLD_API_KEY`; no second lab key or feature-area package is
required. Tool availability does not authorize paid calls or writes.

Claude Code uses the plugin's sensitive API-key field. Codex local execution
forwards the named `INWORLD_API_KEY` from the launcher’s explicit environment;
Codex does not expand Claude `user_config` or provide that key dialog. A separately
launched desktop app may not share a terminal’s environment. If its launcher has
no supported credential input, report the limitation rather than inspecting
stores or editing cached manifests.

Native Cursor plugins declare `INWORLD_API_KEY` in their variables schema;
configure it through the dashboard Plugins → Configure. Project MCP configuration
is a separate route with its own approved settings. Do not copy another host’s
credential syntax. Neither plugin stores nor packages key values.

For OpenClaw, generate a native settings snippet from the installed package with
`node scripts/prepare-agent-mcp.mjs /new/native-mcp.json`. Apply only the selected
`mcp.servers` entries through OpenClaw's `/settings/mcp` UI or native `mcp set`
command when configuring that integration is authorized; preserve other servers.
Use the Control UI while the Gateway is running; native CLI mutations and probes
require it to be stopped. Do not stop a running Gateway without authorization.
The snippet references `INWORLD_API_KEY`. Configure it in the approved host environment/secret
flow. Do not put these references into portable bundle `mcp.json`: that route
passed them literally in testing. `openclaw mcp probe inworld` verifies MCP
discovery without generating content; authentication needs a separately
authorized API request. Never turn a connection check into a synthesis request.

For Gemini CLI, Google model authentication and Inworld tool credentials are
separate. If Google returns `UNSUPPORTED_CLIENT`, report the host-login failure;
reinstalling this plugin is not a remedy. Offer the supported Google AI Studio
`GEMINI_API_KEY` route or an eligible organization/Vertex setup, following
https://geminicli.com/docs/get-started/authentication/. Keep Google credentials
in the local auth flow, never chat. Do not create projects, enable billing or
change the user's account automatically. Retry the live tool test after the
chosen Google authentication succeeds; extension discovery alone is not a pass.

Never promise native playback controls or measured activation. Explain where
the selected action sends data and preserve external-provider comparison opt-in.
