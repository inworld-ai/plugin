// Agent Plugins 1.0: shared skills and MCP, without host-native provider hooks.
export async function emitPortablePlugin({ out, manifest, json, join, servers }) {
  await json(join(out, 'plugin.json'), {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    ...manifest, name: 'inworld-developer',
  });
  await json(join(out, 'mcp.json'), {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: Object.fromEntries(Object.entries(servers('${PLUGIN_ROOT}')).map(([name, server]) => [name, { type: 'stdio', ...server, cwd: '${PLUGIN_ROOT}' }])),
  });
}
