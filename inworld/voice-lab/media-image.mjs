import {
  requestJson, newMediaDir, readImageReference, saveMedia, writeManifest, requireModel, redactMediaError,
} from './media-common.mjs';

export const IMAGE_TOOLS = [{
  name: 'generate_image',
  title: 'Generate and save images',
  description: 'Generate images using an explicit live provider/model ID. Saves every returned image and a manifest locally. Each invocation can incur a charge; failed or timed-out generations are never retried automatically.',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'Fully qualified provider/model ID with image output in the live catalog.' },
      prompt: { type: 'string', minLength: 1, maxLength: 32000 },
      reference_files: {
        type: 'array', maxItems: 8,
        items: { type: 'string', minLength: 1 },
        description: 'Local PNG, JPEG or WebP paths. The model must support image input.',
      },
      image_config: { type: 'object', description: 'Model-specific image settings, such as aspect_ratio or image_size.' },
    },
    required: ['model', 'prompt'],
    additionalProperties: false,
  },
}];

const plainObject = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

// Settings stay under image_config; they can never replace model/messages/stream.
function jsonCopy(value, depth = 0) {
  if (depth > 32) throw new Error('image_config is too deeply nested or circular');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.map(item => jsonCopy(item, depth + 1));
  if (!plainObject(value)) throw new Error('image_config must contain only JSON values');
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonCopy(item, depth + 1)]));
}

// Never echo an inline image payload in an MCP result or diagnostic.
const safeText = value => String(value ?? '').replace(/data:[^\s"'<>]+/gi, '[inline media omitted]');
// Response text and metadata can reflect credentials or signed links too. Keep
// full ordinary text (the common error helper intentionally truncates errors).
function safeResponse(value, key) {
  if (typeof value === 'string') return safeText(key ? value.split(key).join('[credential]') : value)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]');
  if (Array.isArray(value)) return value.map(item => safeResponse(item, key));
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [safeResponse(name, key), safeResponse(item, key)]));
  return value;
}
function messageText(content) {
  if (typeof content === 'string') return safeText(content);
  if (!Array.isArray(content)) return '';
  return content.filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => safeText(part.text)).join('\n');
}

export function createImageTools({ apiBase, fetcher = globalThis.fetch }) {
  async function generateImage(args, key) {
    const diagnostic = error => safeText(redactMediaError(error, key));
    if (!plainObject(args)) throw new Error('generate_image arguments must be an object');
    const allowed = new Set(['model', 'prompt', 'reference_files', 'image_config']);
    if (Object.keys(args).some(name => !allowed.has(name))) throw new Error('Unknown generate_image argument');
    if (typeof args.model !== 'string' || !/^[^/\s]+\/[^\s]+$/.test(args.model)) {
      throw new Error('model must be an explicit fully qualified provider/model ID');
    }
    if (typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 32000) {
      throw new Error('prompt must contain 1–32000 characters');
    }
    const paths = args.reference_files === undefined ? [] : args.reference_files;
    if (!Array.isArray(paths) || paths.length > 8 || paths.some(path => typeof path !== 'string' || !path.trim())) {
      throw new Error('reference_files must contain at most 8 local PNG/JPEG/WebP paths');
    }
    let config;
    if (args.image_config !== undefined) {
      if (!plainObject(args.image_config)) throw new Error('image_config must be a plain object');
      config = jsonCopy(args.image_config);
    }
    // Read every reference before any paid request, including format/signature validation.
    const references = [];
    let model;
    try {
      for (const path of paths) references.push({ path, ...await readImageReference(path) });
      model = await requireModel(apiBase, key, args.model, 'image', { fetcher });
    } catch (error) { throw new Error(diagnostic(error)); }
    if (references.length && !model.spec?.inputModalities?.includes('image')) {
      throw new Error('The selected model does not support image reference input');
    }
    const body = {
      model: args.model,
      messages: [{ role: 'user', content: references.length
        ? [{ type: 'text', text: args.prompt }, ...references.map(ref => ({ type: 'image_url', image_url: { url: ref.url } }))]
        : args.prompt }],
      modalities: ['text', 'image'],
      stream: false,
      ...(config !== undefined ? { image_config: config } : {}),
    };
    let dir;
    try { dir = await newMediaDir('inworld-image-'); }
    catch (error) { throw new Error(diagnostic(error)); }
    const files = [], errors = [], choices = [];
    let imageIndex = 0;
    let result;
    try {
      result = await requestJson(apiBase, key, '/v1/chat/completions', {
        method: 'POST', body, timeoutMs: 300000, fetcher,
      });
    } catch (error) {
      result = error.response;
      errors.push(`Generation request failed; completion may be unknown: ${diagnostic(error)}. Do not retry automatically.`);
    }
    if (result) {
      if (result.error) errors.push('Generation response contains an error');
      if (!Array.isArray(result.choices) || !result.choices.length) errors.push('No image choices returned');
      for (const [choiceIndex, choice] of (Array.isArray(result.choices) ? result.choices : []).entries()) {
        const message = choice?.message;
        const refusalPart = Array.isArray(message?.content) && message.content.find(part => part?.type === 'refusal');
        const refusal = message?.refusal || (refusalPart && (refusalPart.refusal || refusalPart.text || 'Refusal'));
        choices.push({ index: choiceIndex, finishReason: choice?.finish_reason ?? null,
          text: messageText(message?.content), refusal: refusal ? safeText(refusal) : null });
        if (choice?.finish_reason !== 'stop') errors.push(`Choice ${choiceIndex} did not finish with stop (${safeText(choice?.finish_reason ?? 'missing')})`);
        if (choice?.error || message?.error) errors.push(`Choice ${choiceIndex} contains an error`);
        if (refusal) errors.push(`Choice ${choiceIndex} refused generation`);
        if (message?.images !== undefined && !Array.isArray(message.images)) errors.push(`Choice ${choiceIndex} has invalid images`);
        if (!Array.isArray(message?.images) || !message.images.length) errors.push(`Choice ${choiceIndex} returned no images`);
        for (const image of (Array.isArray(message?.images) ? message.images : [])) {
          // Keep saving subsequent images even when another image fails.
          const index = imageIndex++;
          if (typeof image?.image_url?.url !== 'string' || !image.image_url.url) {
            errors.push(`Image ${index + 1} has no image_url.url`);
            continue;
          }
          try {
            files.push(await saveMedia(dir, index, image.image_url.url, { kind: 'image', fetcher }));
          } catch (error) {
            errors.push(`Image ${index + 1} could not be saved: ${diagnostic(error)}`);
          }
        }
      }
    }
    if (!files.length) errors.push('No image files saved');
    const data = safeResponse({
      kind: 'image', status: errors.length ? (files.length ? 'partial' : 'failed') : 'complete',
      model: args.model, servedModel: result?.model ?? null,
      requestId: result?.request_id ?? result?.id ?? null,
      usage: result?.usage ?? null,
      text: choices.map(choice => choice.text).filter(Boolean).join('\n'),
      choices, files, errors,
    }, key);
    let manifest;
    try {
      manifest = await writeManifest(dir, {
        ...data, prompt: args.prompt, ...(config !== undefined ? { image_config: config } : {}),
        references: references.map(({ path, sha256, mimeType, bytes }) => ({ path, sha256, mimeType, bytes })),
      });
    } catch (error) {
      errors.push(`Manifest could not be written: ${diagnostic(error)}`);
      data.status = files.length ? 'partial' : 'failed';
    }
    data.errors = safeResponse(errors, key);
    return {
      ...(errors.length ? { isError: true } : {}),
      content: [{ type: 'text', text: [
        errors.length ? `Image generation ${data.status}: ${data.errors.join('; ')}` : `Saved ${files.length} generated image(s).`,
        ...files.map(file => file.file),
        manifest ? `Manifest: ${manifest}` : `Output directory: ${dir}`,
        data.text,
      ].filter(Boolean).join('\n') }],
      structuredContent: { ...data, manifest: manifest ?? null, directory: dir },
    };
  }
  return { generateImage };
}
