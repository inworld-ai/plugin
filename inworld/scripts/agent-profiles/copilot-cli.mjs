import { emitPortablePlugin } from '../portable-plugin.mjs';
export default {
  id: 'copilot-cli', label: 'GitHub Copilot CLI', format: 'agent-plugin-v1',
  skillsPath: '.github/skills', source: 'copilot-cli-plugin',
  docs: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating', installNotes: "Native Agent Plugins 1.0 package. For a local review package, run copilot --plugin-dir /absolute/path/to/package; inspect it first with copilot --plugin-dir /absolute/path/to/package plugin list. Review the plugin/MCP permission prompts. Persistent installation from a repository or marketplace is a separate choice. The project installer adds skills only; it does not write ~/.copilot/mcp-config.json.",
  emit: emitPortablePlugin,
};
