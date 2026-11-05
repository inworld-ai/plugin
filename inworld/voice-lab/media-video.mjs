// Video jobs are asynchronous. Each invocation performs at most one job request;
// create attempts are never retried automatically, even after an uncertain result.
import { createHash } from 'node:crypto';
import { withRecovery, RequestFailure } from './recovery.mjs';
import {
  requestJson, newMediaDir, saveMedia, writeManifest, requireModel,
  validatePublicUrl, redactMediaError,
} from './media-common.mjs';

const STATUSES = ['queued', 'in_progress', 'completed', 'failed', 'cancelled'];
const RESOLUTIONS = ['480p', '720p', '768p', '1080p', '2k'];
const RATIOS = ['16:9', '21:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16', 'adaptive'];
const RECOVERY = 'No automatic retry was made. Reuse the exact idempotency_key and payload from the private manifest only while the original job is retained and has not been deleted. Video expiry alone does not release the key; deletion or automatic job removal does, so replay afterward can start a new paid job.';
// Manifests are caller-managed evidence, not an input or a reloaded history.
const HISTORY_SCOPE = { attempt_history_scope: 'current_process', prior_process_outcome: 'unknown' };
const urlSchema = { type: 'object', properties: { url: { type: 'string', maxLength: 4096 } }, required: ['url'], additionalProperties: false };
const idSchema = { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9_-]+$' };
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const annotations = readOnlyHint => ({ readOnlyHint, destructiveHint: false, openWorldHint: true });
export const VIDEO_TOOLS = [
  { name: 'create_video', title: 'Create an Inworld video job',
    description: 'Start one paid asynchronous video job, without retries or polling. Choose a live full provider/model ID. Set a stable user/agent UUID idempotency_key BEFORE the first attempt and keep it with the exact payload across restarts. Model defaults apply to omitted settings; the API validates exact model compatibility. Frame/reference URLs must be public HTTPS. Video references must be MP4/MOV up to 100 MB, within model duration/count limits. A private request manifest is written before network access. Input signed URLs, if supplied, are retained privately for exact replay. Output signed URLs are never returned or stored.',
    annotations: annotations(false), inputSchema: schema({
      model: { type: 'string', maxLength: 512 }, prompt: { type: 'string', minLength: 1, maxLength: 7000 },
      seconds: { type: 'integer', minimum: 1, maximum: 30 },
      resolution: { type: 'string', description: 'Case-insensitive; exact support depends on model.' },
      aspect_ratio: { type: 'string', enum: RATIOS },
      frame_images: { type: 'array', minItems: 1, maxItems: 2, items: { ...schema({
        type: { const: 'image_url', type: 'string' }, image_url: urlSchema,
        frame_type: { type: 'string', enum: ['first_frame', 'last_frame'] },
      }, ['type', 'image_url', 'frame_type']) } },
      input_references: { type: 'array', minItems: 1, items: { oneOf: ['image_url', 'video_url', 'audio_url'].map(type => schema({ type: { type: 'string', const: type }, [type]: urlSchema }, ['type', type])) } },
      idempotency_key: { type: 'string', minLength: 1, maxLength: 255, description: 'Required stable request key set before attempting creation. Never generate a replacement merely because a request failed.' },
    }, ['model', 'prompt', 'idempotency_key']) },
  { name: 'get_video', title: 'Check a video job once', description: 'Retrieve status once, including failure details. No polling or download links in the result. Call again later (normally 10–20 seconds) for pending jobs.', annotations: annotations(true), inputSchema: schema({ video_id: idSchema }, ['video_id']) },
  { name: 'list_videos', title: 'List a page of video jobs', description: 'Retrieve one page, newest first. Pass last_id as after when has_more is true. Expired completed jobs are omitted; this is not permanent history.', annotations: annotations(true), inputSchema: schema({ limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, after: idSchema }) },
  { name: 'cancel_video', title: 'Cancel a video job', description: 'Call only when cancellation was explicitly requested. Attempt cancellation once; never delete. Cancellation may fail even for queued jobs once submission starts; a 409 does not mean cancelled.', annotations: { ...annotations(false), destructiveHint: true }, inputSchema: schema({ video_id: idSchema }, ['video_id']) },
  { name: 'download_video', title: 'Save a completed video privately', description: 'Retrieve the job fresh once, then download its actual MP4 into a private folder with a manifest. Requires completed status and unexpired output. Bounded to 256 MiB and 180 seconds per download request. No signed links or base64 are exposed.', annotations: annotations(false), inputSchema: schema({ video_id: idSchema }, ['video_id']) },
];

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function fields(value, allowed, label) {
  if (!object(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new Error(`Invalid ${label} fields`);
}
function videoId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(id)) throw new Error('video_id must contain 1–256 letters, digits, underscores or hyphens');
  return id;
}
function requestBody(args) {
  fields(args, ['model', 'prompt', 'seconds', 'resolution', 'aspect_ratio', 'frame_images', 'input_references', 'idempotency_key'], 'create_video');
  if (typeof args.idempotency_key !== 'string' || !args.idempotency_key.trim() || args.idempotency_key.length > 255 || /[^\x21-\x7e]/.test(args.idempotency_key)) throw new Error('Set a stable idempotency_key (1–255 printable non-space ASCII characters) before the first attempt');
  if (typeof args.model !== 'string' || !args.model.includes('/') || args.model.length > 512) throw new Error('Choose a full provider/model ID from the live video catalog');
  if (typeof args.prompt !== 'string' || !args.prompt.trim() || [...args.prompt].length > 7000) throw new Error('prompt must contain 1–7000 characters; exact model limits are validated by the API');
  if (args.seconds !== undefined && (!Number.isInteger(args.seconds) || args.seconds < 1 || args.seconds > 30)) throw new Error('seconds must be an integer from 1 to 30');
  if (args.resolution !== undefined && (typeof args.resolution !== 'string' || !RESOLUTIONS.includes(args.resolution.toLowerCase()))) throw new Error('Unsupported documented resolution');
  if (args.aspect_ratio !== undefined && !RATIOS.includes(args.aspect_ratio)) throw new Error('Unsupported documented aspect_ratio');
  if (args.frame_images !== undefined && args.input_references !== undefined) throw new Error('frame_images and input_references are mutually exclusive');
  for (const name of ['frame_images', 'input_references']) {
    if (args[name] === undefined) continue;
    if (!Array.isArray(args[name]) || !args[name].length) throw new Error(`${name} must be a nonempty array`);
    if (name === 'frame_images' && args[name].length > 2) throw new Error('At most one first_frame and one last_frame');
    const frames = new Set();
    for (const item of args[name]) {
      const types = name === 'frame_images' ? ['image_url'] : ['image_url', 'video_url', 'audio_url'];
      if (!object(item) || !types.includes(item.type)) throw new Error(`Invalid ${name} reference type`);
      fields(item, ['type', item.type, ...(name === 'frame_images' ? ['frame_type'] : [])], name);
      fields(item[item.type], ['url'], 'reference URL');
      validatePublicUrl(item[item.type].url);
      if (name === 'frame_images') {
        if (!['first_frame', 'last_frame'].includes(item.frame_type) || frames.has(item.frame_type)) throw new Error('At most one first_frame and one last_frame');
        frames.add(item.frame_type);
      }
    }
    if (name === 'frame_images' && !frames.has('first_frame')) throw new Error('last_frame requires first_frame');
  }
  if (args.frame_images && args.aspect_ratio !== undefined && args.aspect_ratio !== 'adaptive') throw new Error('frame_images requires omitted or adaptive aspect_ratio');
  const body = Object.fromEntries(Object.entries(args).filter(([k, v]) => k !== 'idempotency_key' && v !== undefined));
  if (Buffer.byteLength(JSON.stringify(body)) > 128 * 1024) throw new Error('Video request body exceeds 128 KiB');
  // Freeze the exact JSON payload against caller mutation while awaiting I/O.
  return JSON.parse(JSON.stringify(body));
}
const result = (data, message, isError = false) => ({ ...(isError ? { isError: true } : {}), content: [{ type: 'text', text: message }], structuredContent: data });
function jobSummary(raw, key) {
  videoId(raw?.id);
  if (!STATUSES.includes(raw.status)) throw new Error('Video response is missing a valid job status');
  const out = { id: raw.id, status: raw.status };
  for (const field of ['object', 'model', 'created_at', 'completed_at', 'expires_at', 'seconds', 'resolution', 'aspect_ratio', 'operation']) {
    if (typeof raw[field] === 'number') out[field] = raw[field];
    else if (typeof raw[field] === 'string') out[field] = redactMediaError(raw[field], key);
  }
  const error = raw.error;
  if (error) out.error = { code: redactMediaError(error.code ?? 'unknown', key), message: redactMediaError(error.message ?? 'Video generation failed', key) };
  return out;
}

function outputEstimate(pricing, parameters) {
  const rates = pricing?.video?.outputPerSecond;
  const seconds = parameters.seconds;
  const resolution = parameters.resolution;
  if (!Array.isArray(rates) || !Number.isInteger(seconds) || seconds <= 0 || typeof resolution !== 'string') return null;
  const rate = rates.find(r => typeof r.resolution === 'string' && r.resolution.toLowerCase() === resolution.toLowerCase());
  if (!rate || typeof rate.price !== 'number' || !Number.isFinite(rate.price) || rate.price < 0) return null;
  return {
    amount: Number((seconds * rate.price).toPrecision(12)), seconds, resolution,
    price_per_output_second: rate.price,
    ...(typeof pricing.currency === 'string' ? { currency: pricing.currency } : {}),
    note: 'Output-only estimate in catalog price units, not billed cost. Excludes reference/frame/image/video/audio input charges, taxes and any other charges or adjustments. Unknown input charges are not zero.',
  };
}

export function createVideoTools({ apiBase, fetcher = globalThis.fetch }) {
  const attempts = new Map();
  const call = (key, path, options = {}) => requestJson(apiBase, key, path, { ...options, fetcher });
  const scope = (key, id) => createHash('sha256').update(JSON.stringify([apiBase, key, id])).digest('hex');
  async function snapshot(job, action) {
    const dir = await newMediaDir('inworld-video-');
    const manifest = await writeManifest(dir, { kind: 'video', action, recorded_at: new Date().toISOString(), job });
    return { dir, manifest };
  }
  async function retrieve(args, key) {
    fields(args, ['video_id'], 'video job');
    const id = videoId(args.video_id);
    const raw = await call(key, `/v1/videos/${encodeURIComponent(id)}`);
    const job = jobSummary(raw, key);
    if (job.id !== id) throw new Error('Video response job ID does not match requested job');
    return { raw, job };
  }
  async function createVideo(args, key) {
    const body = requestBody(args);
    const idempotency_key = args.idempotency_key;
    const slot = scope(key, idempotency_key);
    const serialized = JSON.stringify(body);
    const existing = attempts.get(slot);
    if (existing?.busy) throw new Error('This idempotency_key is already being processed; wait and inspect its private manifest');
    // A rejection covers this invocation, not submissions before this process.
    // Without prior history, it cannot establish that the key is unused.
    if (existing && existing.serialized !== serialized) throw new Error('This idempotency_key already has a different payload. Reuse the exact original payload; use a new key only for an intentionally new video.');
    if (existing?.data.job) return result({ ...existing.data.job, manifest: existing.manifest, pricing_snapshot: existing.data.pricing_snapshot, output_only_estimate: existing.data.output_only_estimate, estimate_note: existing.data.estimate_note }, `Job already recorded: ${existing.data.job.id} (${existing.data.job.status}). Use get_video to retrieve it once.`);
    const entry = existing ?? { serialized, data: { kind: 'video', action: 'create', request: body, idempotency_key, created_at: new Date().toISOString(), ...HISTORY_SCOPE, submission_history: [], has_uncertain_submission: false } };
    // Reserve the key synchronously, before directory allocation or any I/O.
    entry.busy = true;
    attempts.set(slot, entry);
    let submitted = false, submission;
    try {
      entry.dir ??= await newMediaDir('inworld-video-');
      delete entry.data.error;
      entry.data.attempt_state = entry.data.has_uncertain_submission ? 'uncertain' : 'prepared';
      entry.manifest = await writeManifest(entry.dir, entry.data);
      // Same-process recovery replays the already verified, exact original payload.
      // A fresh process has no verified history and still requires the catalog.
      if (!entry.data.has_uncertain_submission) {
        const model = await requireModel(apiBase, key, body.model, 'video', { fetcher });
        entry.data.pricing_snapshot = { model: body.model, fetched_at: new Date().toISOString(), pricing: model.pricing ?? null };
      }
      entry.data.output_only_estimate = outputEstimate(entry.data.pricing_snapshot?.pricing, body);
      submission = { started_at: new Date().toISOString(), state: 'submitting', request: body, pricing_snapshot: entry.data.pricing_snapshot };
      entry.data.submission_history.push(submission);
      entry.data.last_attempt_state = 'submitting';
      entry.data.attempt_state = entry.data.has_uncertain_submission ? 'uncertain' : 'submitting';
      entry.manifest = await writeManifest(entry.dir, entry.data);
      submitted = true;
      const raw = await call(key, '/v1/videos', { method: 'POST', body, headers: { 'Idempotency-Key': idempotency_key }, timeoutMs: body.input_references?.some(r => r.type === 'video_url') ? 90_000 : 60_000 });
      const job = jobSummary(raw, key);
      entry.data.job = job;
      const sameModel = raw.model === body.model;
      entry.data.output_only_estimate = sameModel ? outputEstimate(entry.data.pricing_snapshot?.pricing, job) : null;
      if (!sameModel) entry.data.estimate_note = 'Returned job model differs from the requested catalog model; its output-only estimate is unknown.';
      else delete entry.data.estimate_note;
      submission.state = 'recorded';
      submission.job = job;
      entry.data.last_attempt_state = 'recorded';
      entry.data.attempt_state = 'recorded';
      entry.manifest = await writeManifest(entry.dir, entry.data);
      return result({ ...job, manifest: entry.manifest, pricing_snapshot: entry.data.pricing_snapshot, output_only_estimate: entry.data.output_only_estimate, estimate_note: entry.data.estimate_note }, `Video job ${job.id}: ${job.status}. Private request and status saved to ${entry.manifest}. ${entry.data.estimate_note ?? ''} Use get_video later; no polling was performed.`);
    } catch (error) {
      const rejected = submitted && [400, 429].includes(error.status);
      const currentState = submitted ? (rejected ? 'rejected' : 'uncertain') : 'not_submitted';
      if (currentState === 'uncertain') entry.data.has_uncertain_submission = true;
      entry.data.last_attempt_state = currentState;
      entry.data.attempt_state = entry.data.has_uncertain_submission ? 'uncertain' : currentState;
      entry.data.error = redactMediaError(error, key);
      if (submission) {
        submission.state = currentState;
        submission.error = entry.data.error;
        if (Number.isInteger(error.status)) submission.http_status = error.status;
      }
      try { entry.manifest = await writeManifest(entry.dir, entry.data); } catch { /* Preserve the pre-request manifest if the update fails. */ }
      const recovery = entry.data.has_uncertain_submission ? RECOVERY : rejected
        ? `This invocation was rejected with HTTP ${error.status}. Earlier submissions from another process remain unknown; this rejection does not establish that the key is unused. Preserve the original manifest, key and exact payload, and reconcile any prior uncertain submission before another attempt. Do not change the unresolved payload or replace its key to bypass this rejection. No automatic retry was made.`
        : 'No video create request was sent by this invocation. Earlier submissions from another process are unknown; not_submitted does not establish that this key is unused. Preserve the original manifest and reconcile any prior uncertain submission before another attempt. Do not replace the key or payload to bypass this failure.';
      return withRecovery(result({ status: entry.data.attempt_state, last_attempt_state: currentState, ...HISTORY_SCOPE, has_uncertain_submission: entry.data.has_uncertain_submission, ...(entry.data.job ? { job: entry.data.job } : {}), manifest: entry.manifest, idempotency_key, pricing_snapshot: entry.data.pricing_snapshot, output_only_estimate: entry.data.output_only_estimate ?? null, error: entry.data.error }, `${entry.data.error}\nPrivate request manifest: ${entry.manifest ?? entry.dir}. ${recovery}`, true), error, { tool: 'create_video', args });
    } finally { entry.busy = false; }
  }
  async function getVideo(args, key) {
    const { raw, job } = await retrieve(args, key);
    if (job.status === 'completed') job.output_available = Boolean(raw.output?.videos?.[0]?.url) && !(typeof job.expires_at === 'number' && job.expires_at <= Date.now() / 1000);
    const { manifest } = await snapshot(job, 'retrieve');
    return result({ ...job, manifest }, `Video job ${job.id}: ${job.status}${job.error ? ` (${job.error.code}: ${job.error.message})` : ''}. Status saved to ${manifest}. ${job.output_available === false ? 'Completed job has no available output; it may have expired. ' : ''}Download links are intentionally omitted.`);
  }
  async function listVideos(args = {}, key) {
    fields(args, ['limit', 'after'], 'list_videos');
    const limit = args.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100');
    const query = new URLSearchParams({ limit: String(limit) });
    if (args.after !== undefined) query.set('after', videoId(args.after));
    const raw = await call(key, `/v1/videos?${query}`);
    if (!Array.isArray(raw.data) || raw.data.length > limit || typeof raw.has_more !== 'boolean') throw new Error('Invalid video pagination response');
    const page = { object: 'list', data: raw.data.map(row => jobSummary(row, key)), has_more: raw.has_more };
    for (const name of ['first_id', 'last_id']) if (raw[name] !== undefined) page[name] = videoId(raw[name]);
    if (page.has_more && !page.last_id) throw new Error('Video pagination response is missing last_id');
    const dir = await newMediaDir('inworld-video-');
    const manifest = await writeManifest(dir, { kind: 'video', action: 'list', page });
    return result({ ...page, manifest }, `${page.data.length} video jobs. ${page.has_more ? `More available: pass after=${page.last_id}.` : 'No more jobs on this page.'} Expired videos are omitted; this list is not permanent history.`);
  }
  async function cancelVideo(args, key) {
    fields(args, ['video_id'], 'cancel_video');
    const id = videoId(args.video_id);
    const job = jobSummary(await call(key, `/v1/videos/${encodeURIComponent(id)}/cancel`, { method: 'POST' }), key);
    if (job.id !== id) throw new Error('Video cancellation response ID mismatch');
    const { manifest } = await snapshot(job, 'cancel');
    return result({ ...job, manifest }, `Cancellation attempted once. Video job ${job.id}: ${job.status}. No job was deleted.`);
  }
  async function downloadVideo(args, key) {
    const { raw, job } = await retrieve(args, key);
    const { dir, manifest } = await snapshot(job, 'download');
    const data = { kind: 'video', action: 'download', job };
    try {
      if (job.status !== 'completed') throw new Error(`Video job is ${job.status}; download requires completed status`);
      const now = Date.now() / 1000;
      if (typeof job.expires_at === 'number' && job.expires_at <= now) throw new RequestFailure('Video output has expired; the completed job may remain retained without output', { kind: 'output_expired' });
      const video = raw.output?.videos?.[0];
      if (!video?.url) throw new RequestFailure('Completed video has no downloadable output; it may have expired', { kind: 'output_unavailable' });
      if (typeof video.url_expires_at === 'number' && video.url_expires_at <= now) throw new RequestFailure('Freshly retrieved download link has already expired; no download attempted', { kind: 'link_expired' });
      const media = await saveMedia(dir, 0, video.url, { kind: 'video', fetcher });
      data.media = media;
      if (Number.isSafeInteger(video.bytes) && video.bytes > 0 && video.bytes !== media.bytes) {
        data.expected_bytes = video.bytes;
        throw new Error(`Downloaded MP4 size mismatch: expected ${video.bytes} bytes, received ${media.bytes}. The local file is retained for inspection`);
      }
      data.download_state = 'saved';
      await writeManifest(dir, data);
      return result({ ...job, ...media, manifest }, `Saved MP4 to ${media.file} (${media.bytes} bytes, SHA-256 ${media.sha256}). Private manifest: ${manifest}.`);
    } catch (error) {
      data.download_state = 'failed';
      data.error = redactMediaError(error, key);
      try { await writeManifest(dir, data); } catch { /* Original status manifest remains available. */ }
      return withRecovery(result({ ...job, ...(data.media ?? {}), manifest, download_state: 'failed', error: data.error }, `Video download failed: ${data.error}. Manifest: ${manifest}. No retry was made.`, true), error, { tool: 'download_video', args });
    }
  }
  // Generic errors also cross the MCP boundary only after credential/URL scrubbing.
  return Object.fromEntries(Object.entries({ createVideo, getVideo, listVideos, cancelVideo, downloadVideo }).map(([name, handler]) => [name, async (args, key) => {
    try { return await handler(args, key); }
    catch (error) { throw Object.assign(new Error(redactMediaError(error, key)), { status: error.status, recoveryDetails: error.recoveryDetails }); }
  }]));
}
