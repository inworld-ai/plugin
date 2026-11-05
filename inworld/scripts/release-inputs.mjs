// Required runtime files are identical across host packages. Check these before
// creating an output so a partial source checkout cannot become a broken release.
import {lstat, readFile} from 'node:fs/promises';
import {join} from 'node:path';

export const requiredRuntimeInputs = [
  'build/index.js', 'launcher.mjs', 'package.json', 'vendor-source.json',
  'scripts/client-info.mjs', 'runtime/server.mjs', 'runtime/core-client.mjs', 'runtime/docs-search.mjs',
  'runtime/audio-inputs.mjs', 'runtime/core-contracts.mjs',
  ...[
    'areas.mjs', 'bench.mjs', 'http.mjs', 'inference-area.mjs',
    'media-area.mjs', 'media-common.mjs', 'media-format.mjs', 'media-image.mjs',
    'media-video.mjs', 'next-steps.mjs', 'playback.mjs', 'recovery.mjs',
    'router.mjs', 'server.mjs', 'speech-text.mjs', 'tts-reasoning.mjs',
    'voice-compare.html',
  ].map(name => `voice-lab/${name}`),
];

export async function assertRuntimeInputs(root) {
  for (const input of requiredRuntimeInputs) {
    let stat;
    try { stat = await lstat(join(root, input)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(`Missing required runtime input: ${input}`);
    }
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Required runtime input must be a nonempty regular file: ${input}`);
    }
  }
}

// Validate entrypoints for every host before writing any output. This checks
// presence/frontmatter boundaries, not full host-specific YAML acceptance.
export async function readSkillInputs(root, names) {
  const texts = new Map();
  for (const name of names) {
    const text = await readFile(join(root, 'skills', name, 'SKILL.md'), 'utf8');
    if (!/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(text)) {
      throw new Error(`Missing or malformed skill frontmatter: ${name}`);
    }
    texts.set(name, text);
  }
  return texts;
}
