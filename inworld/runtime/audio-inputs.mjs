import {lstat} from 'node:fs/promises';
import {RequestFailure} from '../voice-lab/recovery.mjs';

// Plugin resource constraints, not claims about backend acceptance limits.
const TRANSCRIBE_BYTES = 16_000_000;
const CLONE_SAMPLE_BYTES = 4_000_000;
const CLONE_TOTAL_BYTES = 16_000_000;
const CLONE_SAMPLES = 16;
const notes = {
  transcribe_audio: 'Plugin upload preflight requires one nonempty regular file (no final-component symlink), at most 16,000,000 bytes. Larger recordings need the asynchronous transcription workflow.',
  clone_voice: 'Plugin resource constraints: 1–16 nonempty regular files (no final-component symlinks), at most 4,000,000 bytes each and 16,000,000 bytes total. These are local plugin bounds, not a statement of backend limits.',
};

export function describeAudioInputLimits(tool) {
  return Object.hasOwn(notes, tool.name) ? {...tool, description: `${tool.description ?? ''} ${notes[tool.name]}`} : tool;
}

function reject(reason) {
  throw new RequestFailure(`Plugin audio upload preflight: ${reason} No upload was sent.`,
    {method: 'POST', dispatched: false, kind: 'input'});
}

async function fileSize(path, limit, label) {
  if (typeof path !== 'string' || !path.trim()) reject(`${label} needs a nonempty local file path.`);
  let info;
  try { info = await lstat(path); }
  catch { reject(`${label} is missing or its file metadata cannot be read.`); }
  if (!info.isFile()) reject(`${label} must be a regular file; directories, symlinks and special files are not accepted.`);
  if (!info.size) reject(`${label} must not be empty.`);
  if (info.size > limit) reject(`${label} exceeds the plugin limit of ${limit.toLocaleString('en-US')} bytes.`);
  return info.size;
}

// Metadata preflight only: preserve the caller's exact paths and cwd semantics.
// The pinned core subsequently opens and rereads them. This is NOT a bounded
// reader or a race-free snapshot: replacement/growth after lstat can bypass the
// checks (including replacement with a FIFO). Ancestor symlinks are followed.
// Reject existing special files without opening them; never open a FIFO here.
export async function preflightAudioInputs(name, args = {}) {
  if (name === 'transcribe_audio') {
    await fileSize(args.input_file, TRANSCRIBE_BYTES, 'Transcription input');
  } else if (name === 'clone_voice') {
    if (!Array.isArray(args.audio_files) || !args.audio_files.length || args.audio_files.length > CLONE_SAMPLES)
      reject('Clone input must contain 1–16 samples under the plugin resource policy.');
    let total = 0;
    for (const path of args.audio_files) {
      total += await fileSize(path, CLONE_SAMPLE_BYTES, 'Clone sample');
      if (total > CLONE_TOTAL_BYTES) reject('Clone samples exceed the plugin aggregate limit of 16,000,000 bytes.');
    }
  }
}
