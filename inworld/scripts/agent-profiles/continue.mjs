export default {
  id: 'continue', label: 'Continue IDE and CLI', format: 'skill-pack',
  skillsPath: '.continue/skills', source: 'continue-plugin', serverList: true,
  docs: 'https://github.com/continuedev/continue/blob/main/core/config/markdown/loadMarkdownSkills.ts',
  installNotes: 'Project installation adds native .continue/skills, verified against both official IDE and CLI loaders. Generate a concrete snippet with node scripts/prepare-agent-mcp.mjs /new/continue-mcp.json, then merge its named mcpServers list into the selected Continue config.yaml through the host configuration flow. JSON is valid YAML, but this adapter never overwrites an existing YAML config or selects a model/provider. Native config loading and UI acceptance remain unverified.',
  renderConfig(servers) { return { name: 'Inworld AI', version: '1.0.0', schema: 'v1', mcpServers: Object.entries(servers).map(([name, server]) => ({ name, ...server })) }; },
  async emit() {},
};
