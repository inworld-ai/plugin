// Shared media lifecycle: bounded requests, private files, no paid POST retries.
import { mkdtemp, chmod, open, writeFile, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { fetchWithPolicy } from './http.mjs';
import { responseFailure } from './recovery.mjs';
import { detectImage, validateMp4 } from './media-format.mjs';

const IMAGE_LIMIT = 20 * 1024 * 1024;
const VIDEO_LIMIT = 256 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const redactMediaError = (error, key = '') => {
  let text = String(error?.message ?? error);
  if (key) text = text.split(key).join('[credential]');
  return text.replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]').slice(0, 500);
};

export async function requestJson(apiBase, key, path, { method = 'GET', body, headers, timeoutMs = 60_000, fetcher = globalThis.fetch } = {}) {
  const base = new URL(apiBase);
  const target = new URL(path, base);
  if (target.origin !== base.origin || !path.startsWith('/')) throw new Error('API path must remain on the configured Inworld origin');
  const response = await fetchWithPolicy(target, {
    method, redirect: 'error',
    headers: { ...headers, Authorization: `Basic ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { timeoutMs, maxBytes: 64 * 1024 * 1024, fetcher });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch {
    if (!response.ok) throw responseFailure(response, method, `Inworld ${method} ${target.pathname} HTTP ${response.status}: ${redactMediaError(text, key)}`);
    throw new Error('Inworld returned invalid JSON');
  }
  if (!response.ok) throw Object.assign(responseFailure(response, method, `Inworld ${method} ${target.pathname} HTTP ${response.status}: ${redactMediaError(text, key)}`), { response: result });
  if (!object(result)) throw new Error('Inworld returned a non-object response');
  // Video jobs legitimately carry error when their lifecycle reaches failed.
  if (result.error && !(typeof result.id === 'string' && typeof result.status === 'string'))
    throw Object.assign(new Error(`Inworld API error: ${redactMediaError(JSON.stringify(result.error), key)}`), { response: result });
  return result;
}

export async function mediaModels(apiBase, key, modality, { fetcher = globalThis.fetch } = {}) {
  if (!['image', 'video'].includes(modality)) throw new Error('output_modality must be image or video');
  const data = await requestJson(apiBase, key, `/llm/v1alpha/models?output_modalities=${modality}`, { fetcher });
  if (!Array.isArray(data.models)) throw new Error('Model catalog is missing models');
  return data.models.filter(m => object(m) && typeof m.provider === 'string' && typeof m.model === 'string' &&
    m.isSupported === true && Array.isArray(m.spec?.outputModalities) && m.spec.outputModalities.includes(modality));
}

export async function requireModel(apiBase, key, id, modality, options = {}) {
  if (typeof id !== 'string' || !id.includes('/') || id.length > 512) throw new Error('Choose a full provider/model ID from list_media_models');
  const models = await mediaModels(apiBase, key, modality, options);
  const model = models.find(m => `${m.provider}/${m.model}` === id);
  if (!model) throw new Error(`Model is not currently supported for ${modality} output; call list_media_models`);
  return model;
}

export const MEDIA_CATALOG_TOOLS = [{
  name: 'list_media_models', title: 'Find Inworld image and video models',
  description: 'Read the live supported image/video output catalog with capabilities and available pricing. Image input alone does not imply image generation. No generation request is made.',
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  inputSchema: { type: 'object', properties: {
    output_modality: { type: 'string', enum: ['image', 'video'] },
    query: { type: 'string', maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  }, required: ['output_modality'], additionalProperties: false },
}];

export function createMediaCatalog({ apiBase, fetcher = globalThis.fetch }) {
  return { async listMediaModels(args, key) {
    const limit = args.limit ?? 30;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be 1–100');
    if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 200)) throw new Error('query must be a string up to 200 characters');
    const words = (args.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const all = (await mediaModels(apiBase, key, args.output_modality, { fetcher }))
      .filter(m => words.every(w => `${m.provider}/${m.model} ${m.modelCreator ?? ''}`.toLowerCase().includes(w)));
    const rows = all.slice(0, limit).map(m => ({ id: `${m.provider}/${m.model}`, creator: m.modelCreator,
      spec: m.spec, pricing: m.pricing ?? null, health: m.health ?? null }));
    const fetched_at = new Date().toISOString();
    return { content: [{ type: 'text', text: `${all.length} supported ${args.output_modality} models; showing ${rows.length}. Catalog fetched ${fetched_at}. Pricing fields retain their API units; missing prices are unknown. Check current model settings and per-image/per-second prices at https://inworld.ai/models before generating.\n${rows.map(m => m.id).join('\n')}` }],
      structuredContent: { output_modality: args.output_modality, models: rows, total: all.length, fetched_at } };
  } };
}

export async function newMediaDir(prefix = 'inworld-media-') {
  if (!/^[a-zA-Z0-9-]+-$/.test(prefix)) throw new Error('Invalid media directory prefix');
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await chmod(dir, 0o700);
  return dir;
}
export async function writeManifest(dir, data) {
  const path = join(dir, 'manifest.json');
  const temporary = join(dir, `.${randomUUID()}.json`);
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  return path;
}

export async function readImageReference(path) {
  if (typeof path !== 'string' || !path || path.length > 4096) throw new Error('Invalid local image reference path');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error('Image references must be regular files up to 8 MiB each');
    const buffer = Buffer.alloc(8 * 1024 * 1024 + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 8 * 1024 * 1024) throw new Error('Image reference grew beyond 8 MiB');
    const data = buffer.subarray(0, size);
    const mimeType = detectImage(data);
    return { url: `data:${mimeType};base64,${data.toString('base64')}`, sha256: sha256(data), mimeType, bytes: data.length };
  } finally { await handle.close(); }
}

// Conservative: public DNS names only, resolved IPs must also be public. Reject
// literal IPs, private/metadata ranges and local names even before submission.
export function validatePublicUrl(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 4096) throw new Error('Reference/download URL must be HTTPS, up to 4096 bytes');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid HTTPS media URL'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash ||
      isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || host.endsWith('.') ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example|home|lan)$/.test(host) ||
      /^(?:localhost|metadata)(?:\.|$)/.test(host)) throw new Error('Media URLs must use public HTTPS hosts, without credentials, fragments or nonstandard ports');
  return url;
}

export function isPublicAddress(address) {
  // IPv6 is deliberately conservative: global unicast only, no mapped IPv4,
  // documentation, 6to4 or Teredo prefixes.
  if (isIP(address) === 6) {
    const parts = address.toLowerCase().split(':');
    return /^[23]/i.test(address) && !address.toLowerCase().startsWith('2002:') &&
      parts[0] !== '3fff' &&
      !(parts[0] === '2001' && ((parseInt(parts[1] || '0', 16) < 0x200) || parseInt(parts[1] || '0', 16) === 0xdb8));
  }
  if (isIP(address) !== 4) return false;
  const [a,b,c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}

// Pin vetted addresses in the connection's lookup, so a second DNS resolution
// cannot rebind a public download to a local service. No API credentials sent.
export function publicDownloadFetch(url, init, { requester = httpsRequest } = {}) {
  return new Promise((resolve, reject) => {
    const request = requester(url, { method: 'GET', agent: false, signal: init.signal,
      headers: { 'x-user-agent': init.headers.get('x-user-agent') },
      lookup(host, options, callback) {
        lookup(host, { all: true, verbatim: true }, (error, addresses) => {
          if (error) return callback(error);
          if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) return callback(new Error('Download DNS resolved to a non-public address'));
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        });
      },
    }, response => {
      try {
        const bodyless = [204,205,304].includes(response.statusCode);
        if (bodyless) response.resume();
        resolve(new Response(bodyless ? null : Readable.toWeb(response), { status: response.statusCode, headers: response.headers }));
      } catch (error) { response.destroy(); reject(error); }
    });
    request.on('error', reject);
    request.end();
  });
}

async function mediaBytes(source, kind, fetcher) {
  const limit = kind === 'image' ? IMAGE_LIMIT : VIDEO_LIMIT;
  if (typeof source !== 'string') throw new Error('Media output is missing a URL');
  if (source.startsWith('data:')) {
    if (kind !== 'image') throw new Error('Videos must use a public HTTPS download URL');
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
    if (!match || match[2].length > Math.ceil(limit / 3) * 4 || match[2].length % 4 === 1) throw new Error('Invalid or oversized image data URL');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > limit || bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) throw new Error('Invalid image base64 bytes');
    return { bytes, claimedType: match[1] };
  }
  let url = validatePublicUrl(source);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const res = await fetchWithPolicy(url, { redirect: 'manual' }, { timeoutMs: 180_000, maxBytes: limit,
      fetcher: fetcher === globalThis.fetch ? publicDownloadFetch : fetcher });
    if ([301,302,303,307,308].includes(res.status)) {
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location || redirects === 3) throw new Error('Media download redirect limit exceeded');
      url = validatePublicUrl(new URL(location, url).href); continue;
    }
    if (!res.ok) { await res.body?.cancel(); throw responseFailure(res, 'GET', `Media download HTTP ${res.status}`, { download: true }); }
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, claimedType: res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() };
  }
}

export async function saveMedia(dir, index, source, { kind, fetcher = globalThis.fetch } = {}) {
  if (!['image','video'].includes(kind) || !Number.isInteger(index) || index < 0 || index > 100) throw new Error('Invalid media output kind/index');
  const { bytes, claimedType } = await mediaBytes(source, kind, fetcher);
  let mimeType, extension;
  if (kind === 'image') {
    mimeType = detectImage(bytes);
    if (claimedType && claimedType !== 'application/octet-stream' && claimedType !== mimeType) throw new Error('Image content type does not match its bytes');
    extension = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[mimeType];
  } else {
    validateMp4(bytes);
    if (claimedType && !['video/mp4','application/octet-stream'].includes(claimedType)) throw new Error('Expected MP4 media type');
    mimeType = 'video/mp4'; extension = '.mp4';
  }
  const file = join(dir, `${kind}-${index + 1}${extension}`);
  await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
  return { file, mimeType, bytes: bytes.length, sha256: sha256(bytes) };
}
