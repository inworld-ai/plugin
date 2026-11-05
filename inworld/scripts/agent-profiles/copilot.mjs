// Host-specific contract; adding this file opts this host into packaging.
export default {
  id: "copilot",
  label: "GitHub Copilot (VS Code)",
  format: "project-integration",
  skillsPath: ".github/skills",
  configPath: ".vscode/mcp.json",
  configKey: "servers",
  source: "github-copilot-plugin",
  docs: "https://docs.github.com/en/copilot/concepts/agents/about-agent-skills",
  installNotes: "The explicit project installer adds .github/skills and the core runtime under servers in .vscode/mcp.json. Review VS Code MCP trust and tool prompts before starting it.",
  renderServer(server) { return { type: 'stdio', ...server }; },
  async emit({ out, manifest, bundlePackage, json, mkdir, join, servers }) {
    // Skill discovery and optional project MCP config are handled by the shared installer.
  },
};
