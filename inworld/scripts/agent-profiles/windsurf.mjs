// Host-specific contract; adding this file opts this host into packaging.
export default {
  id: "windsurf",
  label: "Windsurf / Devin Desktop",
  format: "skill-pack",
  skillsPath: ".devin/skills",
  source: "windsurf-plugin",
  docs: "https://docs.devin.ai/desktop/cascade/skills",
  installNotes: "This profile targets the documented Devin Desktop skill directory .devin/skills. Legacy Windsurf directory support is not assumed. The project installer provides skills and the terminal bridge; generate a concrete snippet with prepare-agent-mcp.mjs and merge it manually in host-approved MCP settings if needed.",
  async emit({ out, manifest, bundlePackage, json, mkdir, join, servers }) {
    // Skill discovery and optional project MCP config are handled by the shared installer.
  },
};
