// Offline: build all adapters from the same source; never install or run an agent.
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { profiles } from './agent-profiles.mjs';
import { syncVersions } from './sync-versions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const versions = await syncVersions(fileURLToPath(new URL('../../', import.meta.url)));
assert.deepEqual(versions.mismatches, [], 'Run npm run sync:versions after changing the source version');
const skills = (await readdir(join(root, 'skills'), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runtime = hash(await readFile(join(root, 'build/index.js')));
const base = await mkdtemp(join(tmpdir(), 'inworld-distribution-'));
const results = [];
try {
  for (const host of ['claude', 'codex', ...Object.keys(profiles)]) {
    const primary = ['claude', 'codex'].includes(host);
    const out = join(base, host);
    const proc = spawnSync(process.execPath, [join(root, 'scripts', primary ? 'package-plugin.mjs' : 'package-agents.mjs'), host, out], {
      encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, HOME: base },
    });
    assert.equal(proc.status, 0, `${host}: ${proc.stderr}`);
    const metadata = JSON.parse(await readFile(join(out, primary ? 'release.json' : 'distribution.json'), 'utf8'));
    assert.equal(metadata.version ?? metadata.sourceVersion, versions.version, host);
    const manifestPath = primary ? `.${host === 'claude' ? 'claude' : 'codex'}-plugin/plugin.json`
      : ({ cursor: '.cursor-plugin/plugin.json', gemini: 'gemini-extension.json', 'copilot-cli': 'plugin.json', qwen: 'plugin.json', goose: 'plugin.json', hermes: 'plugin.json', openclaw: 'plugin.json' })[host];
    if (manifestPath) assert.equal(JSON.parse(await readFile(join(out, manifestPath), 'utf8')).version, versions.version, host);
    const definition = JSON.parse(await readFile(join(out, primary ? (host === 'claude' ? '.mcp.json' : '.codex-plugin/plugin.json') : 'mcp.example.json'), 'utf8'));
    const profile = metadata.profile;
    const entries = primary ? definition.mcpServers : definition.mcp?.servers ?? definition[profile.configKey ?? 'mcpServers'];
    const connections = profile?.serverList ? Object.fromEntries(entries.map(server => [server.name, server])) : entries;
    assert.deepEqual(Object.keys(connections), ['inworld'], `${host}: exactly one connection`);
    const connection = connections.inworld;
    const environment = connection.env ?? connection.environment;
    assert.equal(environment.INWORLD_PLUGIN_API_KEY, undefined, `${host}: no second credential`);
    const command = Array.isArray(connection.command) ? connection.command : [connection.command, ...connection.args];
    assert.ok(command.some(value => value.endsWith('/launcher.mjs')), `${host}: unified entry point`);
    await readFile(join(out, 'runtime/server.mjs'));
    await readFile(join(out, 'voice-lab/server.mjs'));
    assert.equal(metadata.skills, skills.length, host);
    const packaged = (await readdir(join(out, 'skills'))).sort();
    assert.deepEqual(packaged, primary ? skills : skills.map(s => `inworld-${s}`).sort(), host);
    assert.equal(hash(await readFile(join(out, 'build/index.js'))), runtime, host);
    for (let i = 0; i < skills.length; i++) {
      const path = join(out, 'skills', primary ? skills[i] : `inworld-${skills[i]}`, 'SKILL.md');
      const text = await readFile(path, 'utf8');
      assert.ok(text.startsWith('---\n'), `${host}: skill frontmatter missing`);
      assert.match(text, /\ndescription:/, `${host}: description missing`);
    }
    results.push({ host, format: primary ? `${host}-plugin` : profiles[host].format, skills: skills.length, status: 'offline-package-checked', liveHostAcceptance: 'not-established' });
  }
  console.log(JSON.stringify({ version: versions.version, runtimeSha256: runtime, packages: results }, null, 2));
} finally { await rm(base, { recursive: true, force: true }); }
