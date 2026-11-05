// Host-specific contract; adding this file opts this host into packaging.
export default {
  id: "cursor",
  label: "Cursor",
  format: "cursor-plugin",
  skillsPath: ".cursor/skills",
  configPath: ".cursor/mcp.json",
  configKey: "mcpServers",
  source: "cursor-plugin",
  docs: "https://cursor.com/docs/reference/plugins",
  installNotes: "Cursor IDE: in Customize > Plugins > Add > From Local Repository, select this generated package folder. Its .cursor-plugin/marketplace.json lists the root plugin; .cursor-plugin/plugin.json and mcp.json supply its components. Set the declared Inworld variables through the dashboard Plugins > Configure for this plugin; values are never stored in the package. Manual project installation is separate and does not use plugin dashboard variables. Open the project in the IDE and verify the plugin MCP connections before invoking tools. Cursor Agents window: use the explicit project installer for .cursor/skills and .cursor/mcp.json, then enable the project servers in Customize > MCPs. The Agents window's plugin-prefixed connection was unavailable in desktop UI testing; an installed plugin or skill list alone does not establish tool access.",
  async emit({ out, manifest, bundlePackage, listing, json, mkdir, join, servers }) {
    await mkdir(join(out, '.cursor-plugin'));
    const configured = servers('${CURSOR_PLUGIN_ROOT}');
    const cursorManifest = { ...manifest,
      displayName: listing.displayName, logo: 'assets/icon.png', homepage: 'https://inworld.ai',
      category: 'developer-tools', keywords: ['voice', 'tts', 'stt', 'inference', 'benchmarking', 'inworld'] };
    const properties = {};
    for (const server of Object.values(configured)) {
      for (const name of ['INWORLD_API_KEY']) {
        if (!Object.hasOwn(server.env ?? {}, name)) continue;
        server.env[name] = '${' + name + '}';
        properties[name] = { type: 'string', title: 'Inworld API key', description: listing.apiKeyHelp, minLength: 1 };
      }
    }
    await json(join(out, '.cursor-plugin/plugin.json'), { ...cursorManifest, variables: { type: 'object', properties, required: Object.keys(properties) } });
    await json(join(out, '.cursor-plugin/marketplace.json'), {
      name: 'inworld', owner: { name: 'Inworld AI' },
      plugins: [{ name: manifest.name, source: '.', description: cursorManifest.description }],
    });
    await json(join(out, 'mcp.json'), { mcpServers: configured });
  },
};
