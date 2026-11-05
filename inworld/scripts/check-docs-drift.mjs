// Review signal only. Never rewrites skills or vendors a new CLI automatically.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const sources = [
  'https://docs.inworld.ai/llms.txt',
  'https://docs.inworld.ai/tts/tts-models.md',
  'https://docs.inworld.ai/stt/quickstart.md',
  'https://docs.inworld.ai/router/quickstart.md',
];
export async function fingerprint(url, fetcher = fetch) {
  if (!sources.includes(url)) throw new Error('Unapproved documentation source');
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'text/markdown, text/plain' } });
  if (!response.ok || !response.body) throw new Error(`Documentation request failed: ${url}`);
  const type = response.headers.get('content-type') ?? '';
  if (!/text\/(markdown|plain)/i.test(type)) { await response.body.cancel(); throw new Error(`Expected Markdown/plain text: ${url}`); }
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new Error(`Documentation exceeds size limit: ${url}`);
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString('utf8').replaceAll('\r\n', '\n').trim();
  if (!text || /<!doctype html|<html[\s>]/i.test(text.slice(0, 500))) throw new Error(`Invalid documentation content: ${url}`);
  return { url, sha256: createHash('sha256').update(text).digest('hex') };
}
export function changedSources(baseline, current) {
  return current.filter(source => baseline.find(old => old.url === source.url)?.sha256 !== source.sha256).map(source => source.url);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || !['--check', '--record-baseline'].includes(process.argv[2])) throw new Error('Usage: node scripts/check-docs-drift.mjs <--check|--record-baseline>');
  const path = new URL('../docs-sources.json', import.meta.url);
  // Public docs only: no API keys, credential stores, host config or telemetry.
  const current = await Promise.all(sources.map(url => fingerprint(url)));
  if (process.argv[2] === '--record-baseline') {
    await writeFile(path, JSON.stringify({ capturedAt: new Date().toISOString(), sources: current }, null, 2) + '\n');
    console.log('Recorded documentation fingerprints. This does not establish skill/API parity; review the corresponding guidance.');
  } else {
    const baseline = JSON.parse(await readFile(path, 'utf8'));
    const changed = changedSources(baseline.sources, current);
    console.log(JSON.stringify({ baselineCapturedAt: baseline.capturedAt, checkedAt: new Date().toISOString(), changed, action: changed.length ? 'Review affected skills and tests before recording a new baseline.' : 'No change in the monitored documents; other docs and live catalog compatibility are not covered.' }, null, 2));
    if (changed.length) process.exitCode = 1;
  }
}
