// package.json is the version source. Never bumps it or updates the CLI runtime.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

export async function syncVersions(root, { write = false } = {}) {
  const read = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
  const { version } = await read('inworld/package.json');
  const mismatches = [];
  for (const path of ['inworld/.claude-plugin/plugin.json', 'inworld/.codex-plugin/plugin.json', '.claude-plugin/marketplace.json']) {
    const data = await read(path);
    const entry = path.endsWith('marketplace.json') ? data.plugins.find(p => p.name === 'inworld') : data;
    if (!entry) throw new Error(`Missing Inworld entry in ${path}`);
    if (entry.version !== version) {
      mismatches.push(path);
      if (write) { entry.version = version; await writeFile(join(root, path), JSON.stringify(data, null, 2) + '\n'); }
    }
  }
  return { version, mismatches };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || !['--check', '--write'].includes(process.argv[2])) throw new Error('Usage: node scripts/sync-versions.mjs <--check|--write>');
  const write = process.argv[2] === '--write';
  const result = await syncVersions(fileURLToPath(new URL('../../', import.meta.url)), { write });
  console.log(JSON.stringify(result, null, 2));
  if (!write && result.mismatches.length) process.exitCode = 1;
}
