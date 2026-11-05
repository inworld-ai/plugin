// Host-specific contract; adding this file opts this host into packaging.
export default {
  id: "cline",
  label: "Cline",
  format: "skill-pack",
  skillsPath: ".cline/skills",
  source: "cline-plugin",
  docs: "https://docs.cline.bot/customization/skills",
  installNotes: "The project installer adds .cline/skills and the terminal bridge. Merge mcp.example.json manually through the approved Cline MCP settings if native tools are desired; no global settings file is edited.",
  async emit({ out, manifest, bundlePackage, json, mkdir, join, servers }) {
    // Skill discovery and optional project MCP config are handled by the shared installer.
  },
};
