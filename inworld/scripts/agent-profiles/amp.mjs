// Reviewed host-specific discovery and MCP configuration; no provider registration.
export default {
  id: "amp",
  label: "Amp",
  skillsPath: ".agents/skills",
  configPath: ".amp/settings.json",
  configKey: "amp.mcpServers",
  docs: "https://ampcode.com/docs/customize/mcp",
  format: "project-integration",
  source: "amp-plugin",
  installNotes: "Project installation adds shared skills and the literal amp.mcpServers setting in .amp/settings.json. Amp requires workspace MCP trust approval before starting these servers.",
  async emit() {},
};
