import { readFile } from 'node:fs/promises';
const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
export const pluginVersion = metadata.version;
export const pluginDisplayName = "Inworld AI";
export function clientApplication(source = 'other-agent') {
  const host = /^[a-z0-9-]{1,80}$/.test(source) ? source.replace(/-plugin$/, '') : 'other-agent';
  return `inworld-${host}-plugin`;
}
export function pluginClientInfo(source = process.env.INWORLD_CLIENT_SOURCE) {
  const os = ({darwin: 'macos', win32: 'windows'})[process.platform] ?? process.platform;
  return `sdk/plugin-lab sdk-version/${pluginVersion} os/${os} runtime/node-${process.versions.node.split('.')[0]} app/${clientApplication(source)} app-version/${pluginVersion}`;
}

// Acquisition links are explicit navigation only; constructing one sends no event.
const acquisitionContents = new Set(['connect-skill', 'credential-dialog', 'credential-help', 'tool-error', 'readme']);
function acquisitionUrl(path, source, content) {
  const url = new URL(path, 'https://platform.inworld.ai');
  url.search = new URLSearchParams({
    utm_source: clientApplication(source).slice('inworld-'.length, -'-plugin'.length),
    utm_medium: 'agent-plugin',
    utm_campaign: 'inworld-plugin',
    utm_content: acquisitionContents.has(content) ? content : 'connect-skill',
  }).toString();
  return url.href;
}
export const pluginSignupUrl = (source, content = 'connect-skill') => acquisitionUrl('/signup', source, content);
export const pluginApiKeysUrl = (source, content = 'credential-help') => acquisitionUrl('/api-keys', source, content);
export function credentialGuidance(source = process.env.INWORLD_CLIENT_SOURCE, name = 'INWORLD_API_KEY') {
  return `Configure ${name} in this host's approved secret settings. Get your API key: ${pluginApiKeysUrl(source, 'tool-error')}. Need an account? ${pluginSignupUrl(source, 'tool-error')}. Keep keys out of chat. A visit or login is not a new signup.`;
}
