// Reviewed host-specific discovery and MCP configuration; no provider registration.
export default {
  id: "junie",
  label: "Junie CLI and JetBrains Air",
  skillsPath: ".junie/skills",
  configPath: ".junie/mcp/mcp.json",
  configKey: "mcpServers",
  docs: "https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html",
  format: "project-integration",
  source: "junie-plugin",
  installNotes: "Targets current Junie CLI / JetBrains Air skill discovery and project MCP files. Older JetBrains AI Assistant builds without Junie skills are not implied supported. Review /mcp and the host tool permission prompts.",
  async emit() {},
};
