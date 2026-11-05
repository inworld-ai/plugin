// Reviewed host-specific discovery and MCP configuration; no provider registration.
export default {
  id: "kiro",
  label: "Kiro IDE and CLI V3",
  skillsPath: ".kiro/skills",
  configPath: ".kiro/settings/mcp.json",
  configKey: "mcpServers",
  docs: "https://kiro.dev/docs/mcp/configuration/",
  format: "project-integration",
  source: "kiro-plugin",
  installNotes: "Targets Kiro IDE 1.x / CLI V3 workspace skills and MCP configuration. Custom agents can restrict available skills and servers; review their configuration separately. Older Q Developer/CLI 2.x compatibility is not assumed.",
  async emit() {},
};
