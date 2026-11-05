// Host-specific contract; adding this file opts this host into packaging.
export default {
  id: "roo",
  label: "Roo Code",
  format: "project-integration",
  skillsPath: ".roo/skills",
  configPath: ".roo/mcp.json",
  configKey: "mcpServers",
  source: "roo-code-plugin",
  docs: "https://roocodeinc.github.io/Roo-Code/features/skills/",
  installNotes: "The explicit project installer adds .roo/skills and the core runtime in .roo/mcp.json. Review Roo’s tool permissions before starting it.",
  async emit({ out, manifest, bundlePackage, json, mkdir, join, servers }) {
    // Skill discovery and optional project MCP config are handled by the shared installer.
  },
};
