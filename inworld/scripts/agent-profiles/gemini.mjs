// Host-specific contract; adding this file opts this host into packaging.
export default {
  id: "gemini",
  configPath: ".gemini/settings.json",
  configKey: "mcpServers",
  label: "Gemini CLI",
  format: "gemini-extension",
  skillsPath: ".gemini/skills",
  source: "gemini-cli-plugin",
  docs: "https://geminicli.com/docs/extensions/reference/",
  installNotes: "Native route: gemini extensions install /absolute/path/to/package. The extension exposes an optional sensitive INWORLD_API_KEY setting; enter it only through the host-approved settings UI. Google model login is separate from this Inworld credential. If Google returns UNSUPPORTED_CLIENT, follow https://geminicli.com/docs/get-started/authentication/ to choose the supported Gemini API-key or eligible organization/Vertex route; reinstalling this extension will not repair Google account eligibility. Keep credentials local and do not enable billing or change accounts automatically. The project installer adds .gemini/skills and project MCP settings while preserving existing servers.",
  async emit({ out, manifest, bundlePackage, listing, json, mkdir, join, servers }) {
    const mcpServers = servers('${extensionPath}');
    mcpServers.inworld.env.INWORLD_API_KEY = '${INWORLD_API_KEY}';
    const settings = [{ name: 'Inworld API key', description: `${listing.apiKeyHelp} Required for API requests; documentation and local checks work without a key.`, envVar: 'INWORLD_API_KEY', sensitive: true }];

    await json(join(out, 'gemini-extension.json'), { ...manifest, mcpServers, settings });
  },
};
