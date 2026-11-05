// Explicit project install only. No global files, key storage, provider switches,
// automatic approval rules, package downloads or server startup.
import { cp, mkdir, readFile, readdir, realpath, lstat, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { profiles, serverConfigs } from './agent-profiles.mjs';
import {installationRecord, receiptPath, updateProject} from './project-install-state.mjs';

const bundle = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (![2, 3].includes(args.length) || args[0] !== '--project' || (args.length === 3 && args[2] !== '--update')) throw new Error('Usage: node scripts/install-agent-project.mjs --project /existing/project [--update]');
const project = await realpath(resolve(args[1]));
if (!(await lstat(project)).isDirectory()) throw new Error('Project must be an existing directory');
const { host } = JSON.parse(await readFile(join(bundle, 'distribution.json'), 'utf8'));
const profile = profiles[host];
if (!profile || !/^[a-z-]+$/.test(host)) throw new Error('Run this script from a generated host package');
if (profile.projectInstall === false) throw new Error('Use this host\'s native plugin installer; project-local skill discovery is not assumed');
const skills = (await readdir(join(bundle, 'skills'), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
if (!skills.length || skills.some(n => !/^inworld-[a-z0-9-]+$/.test(n))) throw new Error('Invalid packaged skills');
const inside = path => { const r = relative(project, path); if (r.startsWith('..') || resolve(path) === project) throw new Error('Install path escapes project'); };
const safe = async path => {
  inside(path);
  let current = project;
  for (const part of relative(project, path).split(/[\\/]/)) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Install paths must not contain symbolic links'); }
    catch (e) { if (e.code === 'ENOENT') break; throw e; }
  }
};
const exists = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const runtime = join(project, '.inworld', 'agent-plugins', host);
const bundleRelative = relative(bundle, runtime);
if (!bundleRelative || (!bundleRelative.startsWith('..') && !bundleRelative.startsWith('/'))) throw new Error('Install destination must be outside the package source');
const skillPaths = skills.map(n => join(project, profile.skillsPath, n));
if (args[2] === '--update') {
  const result = await updateProject({project, bundle, host, profile, skills, safe});
  console.log(`Updated Inworld for ${profile.label}: ${result.from} → ${result.to}. Host configuration and credentials were not changed.`);
  process.exit(0);
}
const receipt = receiptPath(project, host);
for (const path of [runtime, ...skillPaths, receipt]) {
  await safe(path);
  if (await exists(path)) throw new Error('Install destination already exists; refusing to overwrite an existing integration');
}
let configPath, original, config, next;
if (profile.configPath) {
  configPath = join(project, profile.configPath);
  await safe(configPath);
  for (const alternate of profile.configAlternatives ?? []) {
    if (await exists(join(project, alternate))) throw new Error('Existing alternate config requires a manual merge; no files changed');
  }
  original = await exists(configPath) ? await readFile(configPath, 'utf8') : null;
  try { config = original === null ? {} : JSON.parse(original); }
  catch { throw new Error('Existing config is not strict JSON; merge the supplied server snippet manually'); }
  if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('Existing config must be a JSON object');
  const key = profile.configKey;
  if (config[key] !== undefined && (!config[key] || typeof config[key] !== 'object' || Array.isArray(config[key]))) throw new Error('Existing server map must be an object');
  const servers = serverConfigs(profile, runtime.replaceAll('\\', '/'));
  if (Object.keys(servers).some(k => Object.hasOwn(config[key] ?? {}, k))) throw new Error('An Inworld server already exists; refusing to replace it');
  next = { ...config, [key]: { ...config[key], ...servers } };
}
const copyInto = async (source, target) => {
  for (const name of await readdir(source)) await cp(join(source, name), join(target, name), { recursive: true, errorOnExist: true, force: false });
};
const created = [];
let temp;
try {
  await mkdir(dirname(runtime), { recursive: true });
  await mkdir(runtime, { mode: 0o700 }); created.push(runtime);
  await copyInto(bundle, runtime);
  for (let i = 0; i < skills.length; i++) {
    await mkdir(dirname(skillPaths[i]), { recursive: true });
    await mkdir(skillPaths[i]); created.push(skillPaths[i]);
    await copyInto(join(bundle, 'skills', skills[i]), skillPaths[i]);
    const bridge = relative(skillPaths[i], join(runtime, 'scripts', 'call-tool.mjs')).replaceAll('\\', '/');
    const path = join(skillPaths[i], 'SKILL.md');
    const text = await readFile(path, 'utf8');
    await writeFile(path, text.replaceAll('node ../../scripts/call-tool.mjs --source=', `node ${bridge} --source=`));
  }
  const {version} = JSON.parse(await readFile(join(bundle, 'package.json'), 'utf8'));
  const record = await installationRecord(project, host, profile, version, [runtime, ...skillPaths]);
  await writeFile(receipt, JSON.stringify(record, null, 2) + '\n', {flag: 'wx', mode: 0o600}); created.push(receipt);
  if (configPath) {
    await mkdir(dirname(configPath), { recursive: true });
    const current = await exists(configPath) ? await readFile(configPath, 'utf8') : null;
    if (current !== original) throw new Error('Config changed during installation; refusing to overwrite it');
    temp = `${configPath}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temp, configPath); temp = undefined;
  }
} catch (e) {
  if (temp) await rm(temp, { force: true });
  for (const path of created.reverse()) await rm(path, { recursive: true, force: true });
  throw e;
}
console.log(`Installed ${skills.length} Inworld skills for ${profile.label} in the requested project.`);
console.log(configPath ? 'Project MCP definitions added; review/start the servers in the host.' : 'Terminal adapter available; native MCP configuration was not changed.');
console.log('No inference/speech provider, global settings or credentials were changed.');
