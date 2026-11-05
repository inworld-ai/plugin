# Install Inworld in the user's coding agent

Use [INSTALL.md](INSTALL.md) as the single installation guide. Identify the actual host and requested scope before choosing its route. Prefer its native Git/plugin installation where supported. For skills only, use the documented skills installer; for other tool-enabled integrations, prepare the matching adapter from a local checkout. Do not treat every host as supporting the repository root or an authenticated MCP connection.

- Preserve the user's chosen user/project scope, other plugins, providers and credentials. Native host installation can be user-scoped; the project installer changes only the selected project. Do not infer organization-wide permission.
- Keep keys out of chat, command arguments and project files. Use the selected host's documented credential flow. Do not inspect credential stores, export saved CLI keys or edit cached manifests to make setup pass.
- For an existing installation, follow [UPDATING.md](UPDATING.md). Do not delete local edits or ownership records to bypass a conflict.
- Verify loaded skills and, where supported, native MCP tool discovery. An offline speech-text check proves local execution, not authentication or audio quality. Report exactly what passed and what remains unverified.
- Installation does not authorize synthesis, uploads, training, paid benchmarks, provider changes or publication. Existing authorization for those tasks still applies.

After setup, offer a relevant first task from the project's needs: audition a voice, add transcription or plan an inference benchmark.
