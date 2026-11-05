import { emitPortablePlugin } from '../portable-plugin.mjs';
export default {
  id: 'qwen', label: 'Qwen Code', format: 'agent-plugin-v1',
  skillsPath: '.qwen/skills', source: 'qwen-plugin',
  docs: 'https://qwenlm.github.io/qwen-code-docs/en/users/extension/agent-plugins/', installNotes: "Native Agent Plugins v1 package. Use qwen extensions install /absolute/path/to/package, or link through the host extension command. The project installer adds skills only; the portable manifest carries native MCP definitions.",
  emit: emitPortablePlugin,
};
