// Host-specific contract; adding this file opts this host into packaging.
export default {
  id: "agents",
  label: "Agent Skills compatible hosts",
  format: "skill-pack",
  skillsPath: ".agents/skills",
  source: "other-agent",
  docs: "https://agentskills.io/specification",
  installNotes: "This is a portable Agent Skills pack using .agents/skills. Generic Agent Skills compatibility does not imply native MCP support. Use the terminal bridge or manually adapt mcp.example.json to the selected host’s approved configuration.",
  async emit({ out, manifest, bundlePackage, json, mkdir, join, servers }) {
    // Skill discovery and optional project MCP config are handled by the shared installer.
  },
};
