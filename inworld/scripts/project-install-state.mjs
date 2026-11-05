// Ownership records contain paths/hashes only; never host configuration or keys.
import {readdir, lstat, readFile, writeFile, mkdir, cp, rename, rm, chmod} from 'node:fs/promises';
import {join, relative, dirname, basename, sep} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export async function snapshot(project, roots) {
  const entries = [];
  async function visit(path) {
    const rel = relative(project, path);
    if (!rel || rel === '..' || rel.startsWith('..' + sep)) throw Error('Owned path escapes project');
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw Error('Owned paths must not contain symbolic links');
    if (stat.isDirectory()) {
      entries.push([rel.replaceAll('\\', '/'), {directory: true, mode: stat.mode & 0o777}]);
      for (const name of (await readdir(path)).sort()) await visit(join(path, name));
    } else if (stat.isFile()) entries.push([rel.replaceAll('\\', '/'), {
      sha256: createHash('sha256').update(await readFile(path)).digest('hex'), mode: stat.mode & 0o777,
    }]);
    else throw Error('Owned paths must be regular files/directories');
  }
  for (const root of [...roots].sort()) await visit(root);
  return Object.fromEntries(entries);
}

export const receiptPath = (project, host) => join(project, '.inworld', 'agent-plugins', `${host}.installation.json`);
export async function installationRecord(project, host, profile, version, roots) {
  return {schema: 1, host, version, skillsPath: profile.skillsPath, configPath: profile.configPath ?? null,
    roots: roots.map(path => relative(project, path).replaceAll('\\', '/')).sort(), files: await snapshot(project, roots)};
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function updateProject({project, bundle, host, profile, skills, safe, renameTree = rename}) {
  const receipt = receiptPath(project, host);
  await safe(receipt);
  let stat;
  try { stat = await lstat(receipt); }
  catch (error) { if (error.code === 'ENOENT') throw Error('No installation ownership record. Use the documented manual migration; no files changed.'); throw error; }
  if (!stat.isFile() || stat.size > 1024 * 1024) throw Error('Invalid installation ownership record');
  const raw = await readFile(receipt, 'utf8'), old = JSON.parse(raw);
  if (old.schema !== 1 || old.host !== host || old.skillsPath !== profile.skillsPath || old.configPath !== (profile.configPath ?? null)) throw Error('Installation layout changed; manual migration required');
  const runtimeRel = `.inworld/agent-plugins/${host}`;
  if (!Array.isArray(old.roots) || !old.roots.includes(runtimeRel) || new Set(old.roots).size !== old.roots.length || old.roots.some(path =>
    typeof path !== 'string' || (path !== runtimeRel && !new RegExp(`^${profile.skillsPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/inworld-[a-z0-9-]+$`).test(path)))) throw Error('Invalid installation roots');
  const oldRoots = old.roots.map(path => join(project, path));
  for (const path of oldRoots) await safe(path);
  if (!same(await snapshot(project, oldRoots), old.files)) throw Error('Installed files have local changes. Preserve or merge them manually; no files changed.');
  const {version} = JSON.parse(await readFile(join(bundle, 'package.json'), 'utf8'));
  if (version === old.version) throw Error('This version is already installed. Each changed release must have a new version.');
  const runtime = join(project, runtimeRel), roots = [runtime, ...skills.map(name => join(project, profile.skillsPath, name))];
  for (const path of roots) {
    await safe(path);
    if (!oldRoots.includes(path)) {
      try { await lstat(path); throw Error('A new release destination already exists; no files changed.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  const lock = `${receipt}.lock`;
  await safe(lock);
  await mkdir(lock, {mode: 0o700});
  const staged = [], backups = [], installed = [];
  const token = randomUUID(), tempReceipt = `${receipt}.${token}.tmp`;
  let committed = false;
  try {
    for (const target of roots) {
      await mkdir(dirname(target), {recursive: true});
      const stage = join(dirname(target), `.${basename(target)}.inworld-update-${token}`);
      staged.push({stage, target});
      await cp(target === runtime ? bundle : join(bundle, 'skills', basename(target)), stage, {recursive: true, force: false, errorOnExist: true});
      if (oldRoots.includes(target)) await chmod(stage, (await lstat(target)).mode & 0o777);
      // Validate all staged entries, including links, before replacing anything.
      await snapshot(project, [stage]);
      if (target !== runtime) {
        const path = join(stage, 'SKILL.md');
        const bridge = relative(target, join(runtime, 'scripts/call-tool.mjs')).replaceAll('\\', '/');
        await writeFile(path, (await readFile(path, 'utf8')).replaceAll('node ../../scripts/call-tool.mjs --source=', `node ${bridge} --source=`));
      }
    }
    if (await readFile(receipt, 'utf8') !== raw || !same(await snapshot(project, oldRoots), old.files)) throw Error('Installation changed during staging; no files replaced.');
    for (const target of oldRoots) {
      const backup = join(dirname(target), `.${basename(target)}.inworld-backup-${token}`);
      await renameTree(target, backup); backups.push({target, backup});
    }
    for (const {stage, target} of staged) { await renameTree(stage, target); installed.push(target); }
    const record = await installationRecord(project, host, profile, version, roots);
    await writeFile(tempReceipt, JSON.stringify(record, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    await renameTree(tempReceipt, receipt);
    committed = true;
  } catch (error) {
    for (const path of installed.reverse()) await rm(path, {recursive: true, force: true});
    for (const {target, backup} of backups.reverse()) await rename(backup, target);
    throw error;
  } finally {
    await rm(tempReceipt, {force: true});
    for (const {stage} of staged) await rm(stage, {recursive: true, force: true});
    if (committed) for (const {backup} of backups) await rm(backup, {recursive: true, force: true});
    await rm(lock, {recursive: true});
  }
  return {from: old.version, to: version};
}
