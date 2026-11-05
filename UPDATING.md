# Update Inworld

Check [release notes](CHANGELOG.md) before updating. Plugin versions are shared across harnesses; the bundled CLI has its own version. Start a new agent session after updating so it loads the new files.

## Claude Code

For an installation from our Git marketplace, refresh it and update the plugin:

```sh
claude plugin marketplace update inworld
claude plugin update inworld@inworld
```

These commands assume the marketplace is registered as `inworld`. Automatic updates depend on the marketplace's auto-update setting; third-party marketplaces may have it disabled. A local `--plugin-dir` invocation instead reads your selected checkout. Update that checkout, then launch a new session.

## Codex

For a registered Git marketplace:

```sh
codex plugin marketplace upgrade inworld
```

Refresh/restart the host to load the updated installed copy. For a marketplace registered from a local path, update that checkout first and refresh the plugin in the host. Updating the Git catalog alone does not prove a running session loaded the new version.

## Cursor and other native packages

Use the host's plugin update/refresh flow. A Git-imported Cursor team marketplace supports manual Refresh or configured Auto Refresh; this is different from a local generated package. For generated packages, update this checkout, generate a new versioned directory and install it using the host's native flow. Preserve its credential settings and start a new session.

For native Gemini, Copilot CLI, OpenClaw, Hermes, Qwen and Pi packages, follow the host's own update mechanism. Do not use the project updater to replace a native installation. Host login, cached packages and UI support vary; a package version does not establish live acceptance in every host.

## Update a project integration

The project updater applies only to integrations installed using `install-agent-project.mjs` with an ownership record. First generate a new package from an updated checkout, then run its installer with `--update`:

```sh
# Example: updating an OpenCode project; choose a new output directory.
node inworld/scripts/package-agents.mjs opencode ../inworld-opencode-new
node ../inworld-opencode-new/scripts/install-agent-project.mjs --project /absolute/path/to/project --update
```

Close sessions using the old runtime and avoid editing installation files during the update. The updater checks the installed runtime and skill files against its previous ownership record, stages the new payload, and restores the old files if replacement fails. It removes retired owned skills. It never rewrites MCP configuration, API keys, other servers or unrelated project files.

If an owned file was edited, an unexpected file was added, a path is a symbolic link, or the layout changed, it stops. Preserve your edits and reconcile them manually. It does not force an overwrite. Do not delete an ownership record to bypass this check.

Pre-1.0 installations may have no `.inworld/agent-plugins/<host>.installation.json` record. Those require a manual migration: preserve the old installation and configuration, generate the new package separately, and review the differences before replacing only the intended Inworld files. Do not relabel an unknown installation as managed.

## Local checkout and pinned versions

For a clean checkout tracking public `main`:

```sh
git pull --ff-only
```

Then reload the selected directory or regenerate the host package. Project-local copies do not follow the checkout automatically.

For a reproducible installation, select a published `vX.Y.Z` Git tag. That pin does not move when a new release ships; fetch tags and explicitly select the next release when ready. Do not force-reset a checkout with local edits.

## Verify and recover

Check the version displayed by your host or the installed package's `package.json`, then run the offline speech-text check from [installation](INSTALL.md#verify-and-troubleshoot). This proves local tool execution, not API authentication or audio quality. Keep existing credentials in the host's secret settings.

If a release is broken, use the previous tagged native package where the host supports selecting a version. For managed project copies, reconcile local changes before explicitly updating from the chosen previous package. Maintainers should restore the working payload in a new patch release rather than move a published tag.

References: [Claude updates](https://code.claude.com/docs/en/plugins/install), [Codex marketplaces](https://developers.openai.com/plugins/build/plugins), [Cursor refresh](https://cursor.com/docs/plugins).
