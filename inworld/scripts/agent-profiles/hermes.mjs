// Host-specific contract; adding this file opts this host into packaging.
export default {
  id: "hermes",
  label: "Hermes",
  format: "agent-plugin-v1",
  projectInstall: false,
  skillsPath: ".hermes/skills",
  source: "hermes-plugin",
  docs: "https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins",
  installNotes: "Use Hermes Agent Plugins v1 support. Copy the package to the selected profile’s plugins/inworld-developer directory only if absent, then explicitly enable it through Hermes and review consent. Project-local discovery is unsupported; the project installer refuses this host.",
  async emit({ out, manifest, bundlePackage, json, mkdir, join, servers }) {
    await json(join(out, 'plugin.json'), { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...manifest, name: 'inworld-developer' });
    const mcpServers = Object.fromEntries(Object.entries(servers('${PLUGIN_ROOT}')).map(([name, server]) => [name, { type: 'stdio', ...server, cwd: '${PLUGIN_ROOT}' }]));
    await json(join(out, 'mcp.json'), { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers });
  },
};
