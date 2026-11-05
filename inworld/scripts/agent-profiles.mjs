// Profiles are opt-in source modules. Infrastructure alone enables no hosts.
import { clientApplication, pluginVersion } from './client-info.mjs';
import { readdir, lstat } from 'node:fs/promises';
export const profiles = {};
const directory = new URL('./agent-profiles/', import.meta.url);
let files;
let directoryStat;
try { directoryStat = await lstat(new URL('./agent-profiles', import.meta.url)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (directoryStat) {
  if (!directoryStat.isDirectory()) throw new Error('Agent profiles must use a real directory, not symlinks');
  files = await readdir(directory);
} else files = [];
const modules = files.filter(name => /^[a-z-]+\.mjs$/.test(name)).sort();
// Validate the entire selected set before executing any profile module.
for (const file of modules) {
  if (!(await lstat(new URL(file, directory))).isFile()) throw new Error('Agent profiles must be regular files, not symlinks');
}
for (const file of modules) {
  const { default: profile } = await import(new URL(file, directory));
  const id = file.slice(0, -4);
  if (!profile || profile.id !== id || typeof profile.emit !== 'function') throw new Error('Invalid agent profile');
  profiles[id] = profile;
}
export function serverConfigs(profile, runtimeRoot) {
  const server = { command: 'node', args: [`${runtimeRoot}/launcher.mjs`], env: {
    INWORLD_CLIENT_SOURCE: profile.source, INWORLD_CLIENT_APP: clientApplication(profile.source),
    INWORLD_CLIENT_APP_VERSION: pluginVersion, INWORLD_API_KEY: '', INWORLD_SKILL_PREFIX: 'inworld-',
  } };
  return { inworld: profile.renderServer ? profile.renderServer(server) : server };
}

export function mcpConfiguration(profile, servers) {
  return profile.renderConfig ? profile.renderConfig(servers) : { [profile.configKey ?? 'mcpServers']: servers };
}
