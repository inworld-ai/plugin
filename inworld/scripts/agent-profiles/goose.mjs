export default {
  id: 'goose', label: 'Goose', format: 'goose-plugin-and-recipe',
  skillsPath: '.agents/skills', source: 'goose-plugin',
  docs: 'https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/context-engineering/plugins.md',
  installNotes: 'Project installation adds .agents/skills. Goose native plugins load skills/hooks, not portable MCP definitions: plugin.json contains skills only. To use native tools, explicitly run goose run --recipe /absolute/path/to/package/goose-recipe.json --params package_root=/absolute/path/to/package. Review the recipe first and configure its declared credential names through Goose-approved secret settings. Do not set Goose model/provider options. The recipe requires its package_root parameter after moving the package.',
  async emit({ out, manifest, listing, json, join, servers }) {
    await json(join(out, 'plugin.json'), { name: 'inworld-developer', version: manifest.version, description: manifest.description });
    await json(join(out, 'goose-recipe.json'), {
      version: '1.0.0', title: listing.displayName,
      description: listing.summary,
      instructions: 'Use the installed Inworld skills for the requested app task. Inspect tool schemas. Tool availability is not authorization for paid calls, uploads, training, publishing, or provider changes. Keep credentials out of prompts and reports.',
      parameters: [{ key: 'package_root', input_type: 'string', requirement: 'required', description: 'Absolute path to this generated package, with no credentials.' }],
      extensions: Object.keys(servers('{{ package_root }}')).map(name => ({
        type: 'stdio', name, cmd: 'node',
        args: ['{{ package_root }}/scripts/start-goose-server.mjs', name], timeout: 300,
        env_keys: ['INWORLD_API_KEY'],
      })),
    });
  },
};
