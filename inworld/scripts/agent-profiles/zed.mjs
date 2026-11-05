// Reviewed host-specific discovery and MCP configuration; no provider registration.
export default {
  id: "zed",
  label: "Zed",
  skillsPath: ".agents/skills",
  configKey: "context_servers",
  docs: "https://zed.dev/docs/ai/mcp",
  format: "skill-pack",
  source: "zed-plugin",
  installNotes: "Project installation adds native .agents/skills. Generate an absolute context_servers snippet with node scripts/prepare-agent-mcp.mjs /new/snippet.json, then merge it through Zed Settings > AI > MCP Servers. No global settings or approval policies are edited; external ACP agents have their own configuration boundaries.",
  async emit() {},
};
