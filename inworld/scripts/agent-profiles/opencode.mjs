// Host-specific contract; adding this file opts this host into packaging.
export default {
  id: "opencode",
  label: "OpenCode",
  format: "project-integration",
  skillsPath: ".opencode/skills",
  configPath: "opencode.json",
  configAlternatives: ["opencode.jsonc"],
  configKey: "mcp",
  source: "opencode-plugin",
  docs: "https://opencode.ai/docs/mcp-servers/",
  installNotes: "The project installer adds skills and the local runtime to opencode.json. An existing opencode.jsonc requires a manual merge so comments and unrelated configuration survive.",
  renderServer(server) { return { type: 'local', command: [server.command, ...server.args], environment: server.env, enabled: true }; },
  async emit({ out, manifest, bundlePackage, json, mkdir, join, servers }) {
    // Skill discovery and optional project MCP config are handled by the shared installer.
  },
};
