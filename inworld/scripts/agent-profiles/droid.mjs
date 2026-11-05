// Reviewed host-specific discovery and MCP configuration; no provider registration.
export default {
  id: "droid",
  label: "Factory Droid",
  skillsPath: ".factory/skills",
  configPath: ".factory/mcp.json",
  configKey: "mcpServers",
  docs: "https://docs.factory.com/docs/harness/mcp",
  format: "project-integration",
  source: "droid-plugin",
  installNotes: "Project installation preserves existing .factory/mcp.json server entries and adds .factory/skills. Configure credentials in approved user-level settings; shared project definitions contain empty values.",
  renderServer(server) { return { type: 'stdio', ...server }; },
  async emit() {},
};
