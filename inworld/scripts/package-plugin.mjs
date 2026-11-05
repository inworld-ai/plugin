// Build a standalone host package from explicit inputs without publishing.
// Preserve upstream runtime bytes and host credential configuration.
import { cp, mkdir, readFile, writeFile, readdir, lstat, realpath } from 'node:fs/promises';
import { resolve, join, relative, basename, dirname, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRuntimeInputs, readSkillInputs } from './release-inputs.mjs';
import {readListing,renderListingReadme} from './listing.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [host, destination, ...extra] = process.argv.slice(2);
const flag = extra[0];
const labAreas = flag?.startsWith('--lab-areas=') ? [...new Set(flag.slice(12).split(',').map(s => s.trim()).filter(Boolean))] : [];
if (!['claude', 'codex'].includes(host) || !destination || extra.length > 1 || (extra.length && !labAreas.length)) {
  throw new Error('Usage: node scripts/package-plugin.mjs <claude|codex> <new-output-directory> (parent must exist)');
}
if (labAreas.length) {
  const { areas } = await import('../voice-lab/areas.mjs');
  if (labAreas.some(name => name !== 'voice' && !Object.hasOwn(areas, name))) throw new Error('Unavailable lab area');
}
const output = resolve(destination);
// Resolve aliases before checking containment. mkdir below refuses existing
// directories, files and symlinks, including dangling symlinks.
const physicalOutput = join(await realpath(dirname(output)), basename(output));
const fromRoot = relative(await realpath(root), physicalOutput);
if (!fromRoot || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))) {
  throw new Error('Output must be outside the plugin source tree.');
}
const excluded = new Set(['node_modules', '__pycache__', 'tests', 'hooks', 'experimental', 'AGENTS.md', 'CLAUDE.md']);
const filter = path => {
  const name = basename(path);
  return !name.startsWith('.') && !excluded.has(name) && !/^(?:internal|notes)(?:[._-]|$)/i.test(name);
};
async function preflight(path, applyFilter = true) {
  if (applyFilter && !filter(path)) return;
  const stat = await lstat(path);
  if (!stat.isDirectory() && !stat.isFile()) {
    throw new Error('Release inputs must be regular files or directories; symbolic links are unsupported.');
  }
  if (stat.isDirectory()) {
    for (const entry of await readdir(path)) await preflight(join(path, entry));
  }
}
async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
// Allowlist top-level inputs; source tests, hooks, notes and future servers are
// never swept into a release. Optional assets may be absent on older bases.
const entries = ['build/index.js', 'runtime', 'voice-lab', 'launcher.mjs', 'vendor-source.json', 'scripts/client-info.mjs', 'skills', 'README.md', 'package.json', 'scripts/smoke.mjs', 'scripts/vendor.sh'];
if (await exists(join(root, 'assets'))) entries.push('assets');

const manifest = host === 'claude' ? '.claude-plugin' : '.codex-plugin';
if (host === 'claude') entries.push('.mcp.json', 'logo.png');
entries.push(`${manifest}/plugin.json`);
// Check the parents too: a link at build/, scripts/ or the manifest directory
// must not let a regular descendant bypass the input link check.
for (const parent of ['build', 'scripts', manifest]) {
  const stat = await lstat(join(root, parent));
  if (!stat.isDirectory()) throw new Error('Input directories must be real directories; symbolic links are unsupported.');
}
for (const entry of entries) await preflight(join(root, entry), false);
await preflight(join(root, '../LICENSE'), false);
await assertRuntimeInputs(root);
const listing = await readListing(root);
const skillNames = (await readdir(join(root, 'skills'), { withFileTypes: true }))
  .filter(entry => filter(entry.name) && entry.isDirectory()).map(entry => entry.name).sort();
const skillInputs = await readSkillInputs(root, skillNames);
const projectedSkills = new Map();
if (host === 'codex') {
  for (const name of skillNames) {
    const text = skillInputs.get(name);
    const match = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(text);
    if (!match) throw new Error(`Missing skill frontmatter: ${name}`);
    // Only these known Claude fields are removed, only inside frontmatter.
    // Keep unknown fields and the entire body verbatim, including examples.
    const header = match[2].replace(/^(?:argument-hint|allowed-tools):[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*(?:\r?\n|$)/gm, '');
    // Codex reads task context directly; Claude argument substitution is not portable.
    const body = text.slice(match[0].length).replace(/\$ARGUMENTS\b/g, "the user's request");
    projectedSkills.set(name, match[1] + header + match[3] + body);
  }
}
await mkdir(physicalOutput);
for (const entry of entries) {
  await mkdir(dirname(join(physicalOutput, entry)), { recursive: true });
  await cp(join(root, entry), join(physicalOutput, entry), {
    recursive: true,
    // Explicit hidden manifests/config are allowed; children still use filter.
    filter: source => source === join(root, entry) || filter(source),
  });
}
await cp(join(root, '../LICENSE'), join(physicalOutput, 'LICENSE'));
await writeFile(join(physicalOutput,'README.md'),renderListingReadme(listing,{
  label:host==='claude'?'Claude Code':'Codex',source:host==='claude'?'claude-code-plugin':'codex-plugin',
  installNotes:host==='claude'?'Load this package with Claude Code’s plugin installer or --plugin-dir. Configure the sensitive Inworld API-key field in the plugin settings.':'Install this package through Codex’s plugin marketplace flow. Its local launcher forwards only the named INWORLD_API_KEY environment variable; it does not provide a Claude-style secret prompt. Restart the host after changing its launch environment.',
}));
for (const [name, text] of projectedSkills) {
  await writeFile(join(physicalOutput, 'skills', name, 'SKILL.md'), text);
}
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
// Installed packages expose runnable user commands, not absent repo tooling.
await writeFile(join(physicalOutput, 'package.json'), JSON.stringify({ ...pkg, files: [...entries.filter(path => path !== 'package.json'), 'LICENSE', 'release.json', ...pkg.files.filter(path => path.startsWith('!'))], scripts: { start: pkg.scripts.start } }, null, 2) + '\n');
await writeFile(join(physicalOutput, 'release.json'), JSON.stringify({
  name: pkg.name, version: pkg.version, host, skills: skillNames.length, workflowAreas: ['voice','inference','media'],
  runtime: 'Node.js >=20', distribution: 'Standalone host package; generation does not publish or install it',
}, null, 2) + '\n');
console.log(`Packaged ${host}: ${physicalOutput}`);
