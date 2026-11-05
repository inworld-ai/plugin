# Install the Inworld agent plugin

Requires **Node.js 20+**. Claude Code and Codex can install directly from the public Git marketplace below. For Cursor, generated packages or local development, clone the source first:

```sh
git clone https://github.com/inworld-ai/plugin.git
cd plugin
```

The bundled runtime needs no npm dependency installation. Official marketplace listings and direct installation are separate.

## Claude Code

Directly from the public Git marketplace (a local clone is optional for this route):

```sh
claude plugin marketplace add inworld-ai/plugin
claude plugin install inworld@inworld
```

Configure the plugin's sensitive **Inworld API key** field. This registers the public Git marketplace for future refreshes. For a local development session instead, run `claude --plugin-dir ./inworld`.

## Codex

```sh
codex plugin marketplace add inworld-ai/plugin
codex plugin add inworld@inworld
```

Supply `INWORLD_API_KEY` through the approved launch environment. The manifest forwards only that named credential. Restart after changing the launch environment; a desktop app may not inherit terminal variables.

## Cursor

From the checkout root, generate a new package beside it:

```sh
node inworld/scripts/package-agents.mjs cursor ../inworld-cursor
```

In Cursor IDE, open **Customize → Plugins → Add → From Local Repository** and select the generated `inworld-cursor` directory. Configure its **Inworld API key** variable through the native Configure flow. Expect one Inworld MCP connection and 24 skills.

The Cursor Agents window uses the project integration route below. An installed skill list alone does not establish tool access there.

## Other harnesses

Generate the selected package from the checkout root:

```sh
node inworld/scripts/package-agents.mjs gemini ../inworld-gemini
```

Replace `gemini` with your package ID below and choose a corresponding output directory. Directories must be new and their parents must exist. Follow the generated README for the host's complete setup. Package generation does not install software, configure credentials or make API requests.

Native installation routes for generated packages:

| Harness | Package ID | Install |
| --- | --- | --- |
| Gemini CLI | `gemini` | `gemini extensions install /absolute/path/to/package` |
| GitHub Copilot CLI | `copilot-cli` | `copilot --plugin-dir /absolute/path/to/package` |
| OpenClaw | `openclaw` | `openclaw plugins install /absolute/path/to/package`, then configure native MCP settings |
| Hermes | `hermes` | Copy into the selected profile's `plugins/inworld-developer` directory only if absent, then explicitly enable in Hermes |
| Qwen Code | `qwen` | `qwen extensions install /absolute/path/to/package` |
| Pi | `pi` | `pi install --local /absolute/path/to/package`; skills and local checks only |

Goose uses project skills plus an explicit recipe. Review the recipe and configure its declared credential in Goose's secret settings, then run:

```sh
goose run --recipe /absolute/path/to/package/goose-recipe.json --params package_root=/absolute/path/to/package
```

OpenClaw's native MCP settings resolve credentials differently from its portable bundle. From its generated package:

```sh
node scripts/prepare-agent-mcp.mjs /absolute/path/to/new-native-mcp.json
```

Review and apply only its `mcp.servers` entries through the Control UI's `/settings/mcp` flow, preserving other servers. Supply the referenced credential through host-approved secret/environment settings. Do not stop a running Gateway automatically: CLI mutations/probes and the Control UI have different Gateway-state requirements.

## Project integration

For a project adapter or skills pack, run the explicit installer from its generated package:

```sh
node /absolute/path/to/package/scripts/install-agent-project.mjs --project /absolute/path/to/existing-project
```

It adds Inworld skills and a local runtime copy to the requested project. Where supported, it adds an MCP definition while preserving unrelated servers. It refuses existing Inworld destinations and conflicting configurations instead of overwriting them. It does not edit global settings or store credentials. Hermes requires native installation instead.

### Supported harnesses

Claude Code and Codex use the routes above. Every additional named target is listed here. Package availability does not establish that native UI, audio or authenticated workflows have passed in every host.

| Harness | Package ID | Installation and credentials |
| --- | --- | --- |
| Cursor | `cursor` | Native plugin variables in IDE; project MCP settings for the Agents window |
| Gemini CLI | `gemini` | Native extension with sensitive API-key setting; Google model login is separate |
| GitHub Copilot CLI | `copilot-cli` | Native plugin; explicitly configure its MCP credential in the host |
| OpenClaw | `openclaw` | Native bundle plus native MCP settings; see above |
| Hermes | `hermes` | Native plugin and host-approved MCP credential; no project installation |
| Qwen Code | `qwen` | Native plugin and host-approved MCP credential |
| Goose | `goose` | Project skills and explicit recipe with declared credential names |
| Pi | `pi` | Native skills package; app credentials belong in the app being built |
| Google Antigravity | `antigravity` | Project `.agents/skills` and `.agents/mcp_config.json` |
| GitHub Copilot in VS Code | `copilot` | Project `.github/skills` and `.vscode/mcp.json`; review MCP trust |
| OpenCode | `opencode` | Project `.opencode/skills` and `opencode.json`; existing JSONC requires manual merge |
| Amp | `amp` | Project `.agents/skills` and `.amp/settings.json`; workspace MCP trust required |
| Factory Droid | `droid` | Project `.factory/skills` and `.factory/mcp.json` |
| Kiro IDE and CLI V3 | `kiro` | Project `.kiro/skills` and `.kiro/settings/mcp.json` |
| Junie CLI / JetBrains Air | `junie` | Project `.junie/skills` and `.junie/mcp/mcp.json` |
| Roo Code | `roo` | Project `.roo/skills` and `.roo/mcp.json` |
| Cline | `cline` | Project `.cline/skills`; configure optional native MCP through Cline |
| Continue IDE and CLI | `continue` | Project `.continue/skills`; manually merge generated MCP list into host YAML settings |
| Kimi Code CLI | `kimi` | Project `.agents/skills`; explicit private MCP config file and host launch environment |
| Windsurf / Devin Desktop | `windsurf` | Targets `.devin/skills`; legacy Windsurf directories are not assumed; native MCP setup is manual |
| Zed | `zed` | Project `.agents/skills`; manually merge generated `context_servers` snippet through approved settings |

For another Agent Skills-compatible host, use package ID `agents`. This fallback supplies skills and local checks; it does not add native MCP support.

Where native MCP configuration is manual, `prepare-agent-mcp.mjs` writes a new snippet with absolute paths and no secret values. Empty `INWORLD_API_KEY` overrides intentionally prevent ambient credential inheritance; exporting a key does not override an explicit empty value. Follow the generated README for the selected host, rather than another host's credential syntax.

## Runtime-only setup

For an MCP-capable host without a plugin installer, configure one local stdio
server running `node /absolute/path/to/checkout/inworld/launcher.mjs`, with the
Inworld API key supplied through the host's approved secret settings. This adds
the tools; it does not install the skills. The generated host snippets provide
the appropriate configuration shape.

You can also install a local runtime package with
`npm install /absolute/path/to/checkout/inworld`, or install a prepared npm
tarball. Its `inworld-agent-plugin` launcher starts the same stdio runtime.
Installing the npm package does not register a plugin, skills or MCP settings
in an agent. This release candidate has not been published to the npm registry;
do not assume an unqualified registry install command selects this build.

`npm run` commands execute the scripts in the current directory's
`package.json`; they are not package-registry links. Repository maintenance
commands live at the checkout root. The installable runtime package exposes
only `npm start`.

## Credentials

[Create an Inworld account](https://platform.inworld.ai/signup?utm_source=other-agent&utm_medium=agent-plugin&utm_campaign=inworld-plugin&utm_content=readme) or [get your API key](https://platform.inworld.ai/api-keys?utm_source=other-agent&utm_medium=agent-plugin&utm_campaign=inworld-plugin&utm_content=readme). Use the selected host's approved secret settings. Never paste keys into chat, command arguments or shared project configuration. This release uses API keys; it does not provide native MCP OAuth sign-in or import a CLI login.

The terminal bridge supports discovery and the offline `check_speech_text` tool. It never forwards shell credentials or substitutes for authenticated native MCP. Skills-only installations can still help implement Inworld APIs in your app.

## Verify and troubleshoot

1. Confirm the host loaded Inworld skills and, for native tools, one `inworld` MCP connection with 28 tools.
2. Ask: “Check this sentence for speech: Your reference is AB12.” This local check needs no key or paid request.
3. Configure credentials separately. Discovery and offline checks do not prove authentication. Generate speech or upload audio only when you intend that action.

If Node is missing, install Node.js 20+ using your usual package manager. If a key is missing, check the host's credential field and restart after environment changes. If a package output exists, choose a new directory rather than deleting an existing integration.

Gemini's Google account eligibility and billing are separate from Inworld credentials. A host login error is not fixed by reinstalling this plugin. Audio controls also vary by host; use the supported file playback route when inline controls are unavailable.

## Updates

See [the update guide](UPDATING.md) for native marketplace refreshes, local packages and managed project updates. Project installations made with this release record ownership and support explicit `--update`; earlier untracked installs require manual migration. Credentials, host configuration and locally edited files are preserved.
