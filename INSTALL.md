# Install Inworld

Choose your coding agent below. Claude Code and Codex install directly from this Git repository. For skills without MCP tools, use the skills installer. Cursor and the other host adapters use a local checkout.

The local tools require **Node.js 20+**. The Inworld API key is separate from your coding agent's own login. Official marketplace approval is not required for these direct installation routes.

- [Claude Code](#claude-code)
- [Codex](#codex)
- [Skills only](#skills-only)
- [Cursor](#cursor)
- [Other supported hosts](#other-supported-hosts)
- [Check the installation](#check-the-installation)
- [Updates](UPDATING.md)

## Claude Code

Run in your terminal:

```sh
claude plugin marketplace add inworld-ai/plugin
claude plugin install inworld@inworld
```

`inworld-ai/plugin` is the GitHub repository; `inworld@inworld` is the plugin name and its catalog name. This adds our repository as a source, not a listing in Anthropic's official marketplace.

Configure **Inworld API key** in the plugin's sensitive configuration field, then start a new session. Choose user or project scope through the host as appropriate; do not change a team's configuration without intending to.

For a temporary local-development session, clone the repo using [Local checkout](#local-checkout), then run `claude --plugin-dir ./inworld` from the checkout root. This reads that directory for the invocation rather than installing a Git-managed copy.

## Codex

Run in your terminal:

```sh
codex plugin marketplace add inworld-ai/plugin
codex plugin add inworld@inworld
```

The repository and plugin identifiers mean the same things as above. This is a direct Git installation, separate from OpenAI's public directory approval.

The local launcher forwards `INWORLD_API_KEY` from the environment in which Codex starts. Configure it through your existing secret/launch setup and restart Codex. This plugin does not provide a Claude-style API-key dialog. A desktop app opened separately may not inherit a terminal's environment; do not assume setting a terminal variable configured the desktop app.

## Skills only

Run from the project where you want to use Inworld:

```sh
npx skills add inworld-ai/plugin
```

Choose your coding agent and the skills to install. This uses the [open skills installer](https://github.com/vercel-labs/skills), which requires Node.js 22.20+. Its default scope is the current project; select only the agents you intend to configure. Install all Inworld skills to retain links between related workflows.

This installs skill instructions and their supporting scripts, not the Inworld MCP server or credential settings. Your agent can use them to build an integration in your app. For voice auditions and other authenticated plugin tools, use a native plugin installation or the matching host adapter below. Avoid installing the same skills through both routes in one host.

## Cursor

1. Follow [Local checkout](#local-checkout) to prepare the `cursor` adapter.
2. In Cursor IDE, choose **Customize > Plugins > Add > From Local Repository** and select the generated `inworld-cursor` directory. Select that directory, not this repository's root folder.
3. Configure **Inworld API key** in the plugin's native configuration flow and start a new agent session.

Cursor IDE's native plugin and the Agents window's project integration are different installation routes. For the project route, follow the package README and [Project integration](#project-integration); seeing skills in the UI alone does not confirm MCP tool access.

## Other supported hosts

Use the skills-only route above for integration guidance, or prepare a host adapter from a [local checkout](#local-checkout) for the components listed below. The adapter's README contains its installation commands and credential configuration.

| Host | Package ID | Route |
| --- | --- | --- |
| Gemini CLI | `gemini` | Native extension; Google model login is separate from the Inworld key |
| GitHub Copilot CLI | `copilot-cli` | Native plugin |
| OpenClaw | `openclaw` | Native plugin plus native MCP configuration |
| Hermes | `hermes` | Native plugin in the selected profile; no project installer |
| Qwen Code | `qwen` | Native extension |
| Pi | `pi` | Native skills package; no authenticated MCP tools |
| Goose | `goose` | Project skills plus the package's explicit recipe |
| Google Antigravity | `antigravity` | Project integration |
| GitHub Copilot in VS Code | `copilot` | Project skills and workspace MCP configuration |
| OpenCode | `opencode` | Project integration; JSONC requires manual merging |
| Amp | `amp` | Project integration; review workspace MCP trust |
| Factory Droid | `droid` | Project integration |
| Kiro IDE and CLI V3 | `kiro` | Project integration |
| Junie CLI / JetBrains Air | `junie` | Project integration |
| Roo Code | `roo` | Project integration |
| Cline | `cline` | Project skills; optional native MCP setup is manual |
| Continue IDE and CLI | `continue` | Project skills; merge native MCP settings manually |
| Kimi Code CLI | `kimi` | Project skills and explicit native MCP configuration |
| Windsurf / Devin Desktop | `windsurf` | Project skills and manual native MCP setup |
| Zed | `zed` | Project skills and manual native MCP setup |
| Other Agent Skills-compatible hosts | `agents` | Skills and local checks; no native MCP configuration |

Package availability does not mean every host has passed live API, audio and native UI acceptance. Follow the selected package's documented route rather than another agent's secret syntax.

### Project integration

Only use this route when the selected package's README calls for it. Run its installer against an existing project:

```sh
node /absolute/path/to/host-adapter/scripts/install-agent-project.mjs --project /absolute/path/to/project
```

Replace both example paths with your actual directories. The installer copies the Inworld runtime and skills and, where supported, adds project MCP settings while preserving unrelated servers. A fresh installation refuses existing Inworld destinations. It does not edit global settings or store API-key values. For an existing installation, use [the update guide](UPDATING.md).

Some hosts require a manual MCP configuration step after installation. Use the package's `prepare-agent-mcp.mjs` helper only as described in its README. Do not paste a generated snippet into another host's configuration.

## API key

[Create an account](https://platform.inworld.ai/signup?utm_source=other-agent&utm_medium=agent-plugin&utm_campaign=inworld-plugin&utm_content=readme) or [get your API key](https://platform.inworld.ai/api-keys?utm_source=other-agent&utm_medium=agent-plugin&utm_campaign=inworld-plugin&utm_content=readme), then configure it through the selected host's credential route. Keep the value out of chat, command arguments and version control.

This release uses API keys. It does not provide native MCP OAuth or automatically import a CLI login. The terminal bridge supports discovery and the offline `check_speech_text` tool; it does not forward shell credentials for paid API calls. Skills-only packages can still help implement the APIs in your app.

## Check the installation

1. Start a new agent session. Confirm Inworld skills are available. Hosts configured for native MCP should have one `inworld` connection with 28 tools; skills-only packages do not have that connection.
2. With native MCP configured, ask: “Check this sentence for speech: Your reference is AB12.” The local check needs no API key and makes no paid request. For a skills-only install, instead ask the agent to find the Inworld workflow for your task; that route does not add this MCP tool.
3. When you want to try the API, ask for a short speech generation or another specific operation. A local check does not prove API authentication, audio playback or recognition quality.

If a host login fails, resolve that login separately. Reinstalling Inworld will not fix Google or another host's account eligibility. For a missing key, check the selected host's configuration and restart after launch-environment changes. Generate adapters into a new directory rather than deleting an installation.

Audio controls depend on the host. Follow the tool's file/playback instructions instead of assuming every agent renders a play button.

## Updates

Follow [Update Inworld](UPDATING.md) for your installation route. Updating a Git checkout does not update copies already installed into another project or host cache.

## Local checkout

For Cursor and other host adapters, clone the repository and prepare the directory your host expects. No dependency installation is needed:

```sh
git clone https://github.com/inworld-ai/plugin.git
cd plugin
node inworld/scripts/package-agents.mjs cursor ../inworld-cursor
```

Replace `cursor` with a package ID from the table and choose a new output directory whose parent exists. Follow the generated directory's README to install it in your host. Preparing an adapter does not install anything or make API requests.

For local development, Claude Code can load `./inworld` directly. Standalone Claude and Codex directories can also be prepared with `node inworld/scripts/package-plugin.mjs claude ../inworld-claude` or `codex` with its own new destination.

### Runtime without skills

For a host that supports MCP but not plugins, configure one stdio server running `node /absolute/path/to/checkout/inworld/launcher.mjs`, with credentials supplied by the host's secret settings. This adds the tools only, not the skills.

A local `npm install /absolute/path/to/checkout/inworld` installs that runtime package; it does not register a plugin or host configuration. This plugin is not published on the npm registry. Repository `npm run` commands execute local maintenance scripts; the installable runtime package exposes only `npm start`.
