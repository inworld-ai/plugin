// Generate review packages, never install/publish or rewrite host settings.
import { cp, mkdir, readFile, writeFile, readdir, lstat, realpath } from 'node:fs/promises';
import { resolve, join, dirname, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRuntimeInputs, readSkillInputs } from './release-inputs.mjs';
import {readListing,renderListingReadme} from './listing.mjs';
import { profiles, serverConfigs, mcpConfiguration } from './agent-profiles.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [host, destination, ...extra] = process.argv.slice(2);
if (!host || !destination || extra.length > 1 || !['all', ...Object.keys(profiles)].includes(host)) throw new Error('Usage: node scripts/package-agents.mjs <all|enabled-profile> /new/output [--lab-areas=voice,inference,media]');
const labAreas = extra.length && extra[0].startsWith('--lab-areas=') ? [...new Set(extra[0].slice(12).split(',').map(s => s.trim()).filter(Boolean))] : [];
if (extra.length) {
  const { areas } = await import('../voice-lab/areas.mjs');
  if (!labAreas.length || labAreas.some(name => name !== 'voice' && !Object.hasOwn(areas, name))) throw new Error('Unavailable lab area');
}
if (labAreas.length) await lstat(join(root, 'voice-lab/server.mjs'));
const output = resolve(destination);
const physical = join(await realpath(dirname(output)), basename(output));
const fromRoot = relative(await realpath(root), physical);
if (!fromRoot || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')))) throw new Error('Output must be outside the plugin source tree');
const excluded = new Set(['node_modules', '__pycache__', 'tests', 'hooks', 'experimental', 'AGENTS.md', 'CLAUDE.md']);
const filter = path => {
  const name = basename(path);
  return !name.startsWith('.') && !excluded.has(name) && !/^(?:internal|notes)(?:[._-]|$)/i.test(name);
};
async function preflight(path) {
  if (!filter(path)) return;
  const stat = await lstat(path);
  if (!stat.isDirectory() && !stat.isFile()) throw new Error('Package inputs must be regular files/directories, not symlinks');
  if (stat.isDirectory()) for (const entry of await readdir(path)) await preflight(join(path, entry));
}
// Check parents as well as selected descendants so links cannot bypass checks.
for (const directory of ['build', 'runtime', 'skills', 'scripts', 'voice-lab']) await preflight(join(root, directory));
const entries = [];
const optional = new Set(['assets', 'scripts/agent-profiles']);
for (const entry of [
  'assets', 'build/index.js', 'runtime', 'skills', 'voice-lab', 'launcher.mjs', 'vendor-source.json',
  'scripts/agent-profiles', 'scripts/agent-profiles.mjs', 'scripts/portable-plugin.mjs',
  'scripts/client-info.mjs', 'scripts/call-tool.mjs', 'scripts/install-agent-project.mjs',
  'scripts/project-install-state.mjs',
  'scripts/prepare-agent-mcp.mjs', 'scripts/start-goose-server.mjs',
]) {
  try { await preflight(join(root, entry)); entries.push(entry); }
  catch (error) { if (error.code !== 'ENOENT' || !optional.has(entry)) throw error; }
}
await preflight(join(root, '../LICENSE'));
await assertRuntimeInputs(root);
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const listing = await readListing(root);
const names = (await readdir(join(root, 'skills'), { withFileTypes: true })).filter(e => e.isDirectory() && filter(e.name)).map(e => e.name);
const skillInputs = await readSkillInputs(root, names);
const known = new Set(names);
const json = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');

function projectText(text, name, profile) {
  text = text.replaceAll('\r\n', '\n');
  const end = text.indexOf('\n---', 4);
  if (!text.startsWith('---\n') || end < 0) throw new Error('Invalid skill frontmatter');
  const front = text.slice(0, end).replace(/^name:.*$/m, `name: inworld-${name}`).replace(/^(?:argument-hint|allowed-tools):[^\n]*(?:\n|$)/gm, '');
  let body = text.slice(end);
  if (name === 'connect' && ['pi','agents'].includes(profile.id)) {
    body = body.replace(/The plugin exposes one `inworld` connection[^]*?paid calls or writes\./,
      "This package provides integration skills and local checks. Its terminal adapter does not forward API keys or make authenticated API calls. Configure app credentials in your app’s secret settings when implementing an integration; native MCP tools require a separately configured MCP-capable host. Installation does not authorize paid calls or writes.");
  }
  body = body.replace(/\/inworld:([a-z-]+)/g, 'inworld-$1').replace(/\$ARGUMENTS\b/g, "the user's request");
  body = body.replace(/(\]\((?:\.\.\/)+)([a-z-]+)(\/)/g, (match, lead, target, slash) => known.has(target) ? `${lead}inworld-${target}${slash}` : match);
  body = body.replaceAll('utm_source=SOURCE', `utm_source=${profile.source.replace(/-plugin$/, '')}`);
  body = body.replace(/1\. Sign up: give this link exactly, with `SOURCE` set to `claude-code` if you are\n   Claude Code, `codex` if you are Codex, or `other-agent` otherwise:/, '1. Sign up: give this host-specific link exactly:');
  body = body.replace(/full tracked signup link below with `SOURCE` replaced by `claude-code` for\nClaude Code, `codex` for Codex, or `other-agent` otherwise:/, 'full tracked signup link below for this host:');
  body = body.replaceAll('in Claude or Codex', 'in this host').replaceAll('current Claude or Codex host', 'current host');
  body = body.replace(/The Claude Code plugin already\nhandles auth[^]*?re-paste it\./, 'Configure INWORLD_API_KEY explicitly in this host’s approved MCP settings. Never paste credentials into chat.');
  return front + body;
}

// Complete every host's entrypoint projection before creating any output.
const targets = host === 'all' ? Object.keys(profiles) : [host];
const projectedSkills = new Map(targets.map(target => [target,
  new Map(names.map(name => [name, projectText(skillInputs.get(name), name, profiles[target])])),
]));

async function emit(target, out) {
  const profile = profiles[target];
  const skillsOnly = target === 'pi' || target === 'agents';
  await mkdir(out); // Existing paths are never mixed with a new package.
  for (const entry of entries.filter(e => e !== 'skills')) {
    await mkdir(dirname(join(out, entry)), { recursive: true });
    await cp(join(root, entry), join(out, entry), { recursive: true, filter });
  }
  await cp(join(root, '../LICENSE'), join(out, 'LICENSE'));
  await mkdir(join(out, 'skills'));
  for (const name of names) {
    const folder = join(out, 'skills', `inworld-${name}`);
    await cp(join(root, 'skills', name), folder, { recursive: true, filter });
    async function projectMarkdown(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await projectMarkdown(path);
        else if (entry.name === 'openai.yaml' && basename(dir) === 'agents') {
          const text = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
          await writeFile(path, text.replace(/\$([a-z-]+)/g, (match, name) => known.has(name) ? `$inworld-${name}` : match));
        }
        else if (entry.name.endsWith('.md')) {
          let text = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
          if (entry.name === 'SKILL.md' && dir === folder) {
            text = projectedSkills.get(target).get(name);
            const offset = text.indexOf('\n---', 4) + 4;
            const bridge = `\n\n## Tools in this host\n\nUse the installed Inworld MCP tools when available; inspect their actual schemas. If the host has terminal execution but no Inworld MCP tools, use the bundled adapter, relative to this skill directory: \`node INWORLD_BRIDGE_RELATIVE_PATH --source=${target}\`. Send one JSON object through stdin: \`{"server":"inworld"}\`. Omit name to inspect that server's tools; server is \`inworld\`. The single Inworld server contains the full supported voice, inference and media toolset and uses INWORLD_API_KEY. Use a JSON file or a safely quoted heredoc; never put credentials in arguments. Terminal authentication gate blocked: authenticated actions require host-approved native MCP credentials. The terminal adapter permits metadata discovery and only the offline Inworld check_speech_text action; it never reads or forwards shell credentials. It makes an allowed offline call without retries; an error, cancellation or timeout never authorizes repeating a paid operation. Normal host permissions and the user's existing authorization still apply. Do not automatically publish a voice, switch providers or treat generated audio as human listening evidence.\n\n`;
            const bridgePath = relative(folder, join(out, 'scripts/call-tool.mjs')).replaceAll('\\', '/');
            text = text.slice(0, offset) + bridge.replaceAll('INWORLD_BRIDGE_RELATIVE_PATH', bridgePath) + text.slice(offset);
          } else {
            text = text.replace(/(\]\((?:\.\.\/)+)([a-z-]+)(\/)/g, (match, lead, dest, slash) => known.has(dest) ? `${lead}inworld-${dest}${slash}` : match);
          }
          await writeFile(path, text);
        }
      }
    }
    await projectMarkdown(folder);
  }
  const description = listing.summary;
  const manifest = { name: 'inworld', version: pkg.version, description, author: { name: 'Inworld AI' }, license: 'MIT' };
  const bundlePackage = { name: `inworld-${target}-plugin`, version: pkg.version, description: listing.summary, private: true, type: 'module', license: 'MIT', engines: { node: '>=20' } };
  // Keep the complete generated bundle while excluding caches created after packaging.
  bundlePackage.files = ['**', ...pkg.files.filter(path => path.startsWith('!'))];
  await profile.emit({ out, manifest, bundlePackage, listing, json, mkdir, writeFile, join,
    servers: root => serverConfigs(profile, root) });
  await json(join(out, 'package.json'), bundlePackage);
  await json(join(out, 'distribution.json'), { host: target, profile, sourceVersion: pkg.version, skills: names.length, workflowAreas: ['voice','inference','media'],
    runtimeToolset: 'runtime', toolDiscovery: 'tools/list', validation: 'Offline packaging only; native host acceptance is separate.' });
  await json(join(out, 'mcp.example.json'), mcpConfiguration(profile, serverConfigs(profile, '/ABSOLUTE/PATH/TO/THIS/PACKAGE')));
  const setup = `${profile.installNotes ?? ''}

${profile.projectInstall === false ? 'Use the native installation route above; project installation is unsupported.' : 'For a manual project install: node scripts/install-agent-project.mjs --project /existing/project. To update a previously managed installation from this new package, add --update; locally changed files block replacement, and host configuration/credentials stay untouched. Older installs without ownership records require manual migration.'} ${skillsOnly?"For app integrations, configure INWORLD_API_KEY in your app’s secret settings. This skills-only package has no native MCP credential flow.":"Configure INWORLD_API_KEY through this host's approved MCP settings."} Native installation and credential flows differ by host; do not copy another host's secret syntax. Authenticated actions require native MCP credentials; the terminal adapter supports only discovery and the offline speech-text check.`;
  await writeFile(join(out,'README.md'),renderListingReadme(listing,{label:profile.label,source:profile.source,installNotes:setup,skillsOnly}));
}

if (host === 'all') {
  await mkdir(output);
  for (const target of Object.keys(profiles)) await emit(target, join(output, target));
} else await emit(host, output);
console.log(`Built ${host} packages: ${output}`);
