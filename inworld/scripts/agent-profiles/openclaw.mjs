// Host-specific contract; adding this file opts this host into packaging.
export default {
  id: "openclaw",
  label: "OpenClaw",
  format: "agent-plugin-v1",
  skillsPath: "skills",
  source: "openclaw-plugin",
  docs: "https://docs.openclaw.ai/plugins/bundles",
  installNotes: "Native route: openclaw plugins install /absolute/path/to/package, with a host version supporting Agent Plugins v1 bundles. Review consent before enabling. For credentials, run node scripts/prepare-agent-mcp.mjs /new/native-mcp.json from the installed package. Review its mcp.servers entries in OpenClaw Control UI /settings/mcp or the native mcp set command. The native settings resolve explicit environment references; portable bundle mcp.json does not. Supply the referenced credentials through the host-approved environment/secret configuration, never chat or command arguments. Preserve unrelated servers. This single Inworld connection includes all workflow tools. Then openclaw mcp probe inworld checks discovery without generating audio; it does not verify an authenticated API request. The project installer provides skills and the terminal bridge; it does not edit native provider settings.",
  renderConfig(servers) {
    return { mcp: { servers: Object.fromEntries(Object.entries(servers).map(([name, server]) => [name, {
      ...server,
      env: { ...server.env, ...(name === 'inworld'
        ? { INWORLD_API_KEY: '${INWORLD_API_KEY}' }
        : {}) },
    }])) } };
  },
  async emit({ out, manifest, bundlePackage, json, mkdir, join, servers }) {
    // Keep the developer bundle distinct from OpenClaw's native `inworld`
    // speech provider; installing tools must not shadow that provider plugin.
    await json(join(out, 'plugin.json'), { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...manifest, name: 'inworld-developer' });
    const mcpServers = Object.fromEntries(Object.entries(servers('${PLUGIN_ROOT}')).map(([name, server]) => [name, { type: 'stdio', ...server, cwd: '${PLUGIN_ROOT}' }]));
    await json(join(out, 'mcp.json'), { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers });
  },
};
