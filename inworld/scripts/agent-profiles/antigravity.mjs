// Reviewed host-specific discovery and MCP configuration; no provider registration.
export default {
  id: "antigravity",
  label: "Google Antigravity App, CLI and IDE",
  skillsPath: ".agents/skills",
  configPath: ".agents/mcp_config.json",
  configKey: "mcpServers",
  docs: "https://antigravity.google/docs/mcp",
  format: "project-integration",
  source: "antigravity-plugin",
  installNotes: "Targets current Antigravity project .agents/skills and .agents/mcp_config.json. Native plugin marketplace packaging is a separate submission path; this package uses the documented project configuration route, without assuming plugin-root interpolation.",
  async emit() {},
};
