// Write a new, concrete host snippet. Never merge user/global settings or start tools.
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { profiles, serverConfigs, mcpConfiguration } from './agent-profiles.mjs';
const [destination,...extra]=process.argv.slice(2);
if (!destination || extra.length) throw Error('Usage: node scripts/prepare-agent-mcp.mjs /new/config.json');
const root=await realpath(fileURLToPath(new URL('../',import.meta.url)));
const metadata=JSON.parse(await readFile(join(root,'distribution.json'),'utf8'));
const profile=profiles[metadata.host];
if (!profile) throw Error('Run from a generated host package');
const servers=serverConfigs(profile,root.replaceAll('\\','/'));
await writeFile(resolve(destination),JSON.stringify(mcpConfiguration(profile,servers),null,2)+'\n',{flag:'wx',mode:0o600});
console.log('Wrote a new MCP snippet with absolute paths and credential placeholders or references, without secret values. Review it in the host; no server was started.');
