// Reviewed host-specific discovery and MCP configuration; no provider registration.
export default {
  id: "kimi",
  label: "Kimi Code CLI",
  skillsPath: ".agents/skills",
  configKey: "mcpServers",
  docs: "https://moonshotai.github.io/kimi-cli/en/customization/mcp.html",
  format: "skill-pack",
  source: "kimi-plugin",
  installNotes: "Project installation adds native .agents/skills. Generate a concrete MCP file with node scripts/prepare-agent-mcp.mjs /new/private/kimi-mcp.json outside the project and version control. Generated snippets set INWORLD_API_KEY to an empty string, blocking environment inheritance by default. If you explicitly choose environment forwarding, use this private, user-owned snippet: remove only the empty INWORLD_API_KEY override from mcpServers.inworld.env, then supply INWORLD_API_KEY through the host-approved environment when launching kimi --mcp-config-file /absolute/path/to/private/kimi-mcp.json. Never put the key in chat, command arguments or the snippet. Keep other server settings unchanged. Regenerating a snippet restores the empty override; packaged examples and shared defaults remain isolated. This adapter never edits ~/.kimi/mcp.json or discovers or stores keys.",
  async emit() {},
};
