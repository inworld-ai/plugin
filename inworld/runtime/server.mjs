// One public MCP connection; the published CLI remains an internal dependency.
import {openCore} from './core-client.mjs';
import {searchDocs} from './docs-search.mjs';
import {describeAudioInputLimits, preflightAudioInputs} from './audio-inputs.mjs';
import {projectCoreTool, coreCallParams} from './core-contracts.mjs';
import {credentialGuidance, pluginDisplayName, pluginVersion} from '../scripts/client-info.mjs';
import {withRecovery, RequestFailure} from '../voice-lab/recovery.mjs';

// An unresolved host placeholder is not a configured API key.
if (process.env.INWORLD_API_KEY?.trim() === '${INWORLD_API_KEY}') process.env.INWORLD_API_KEY = '';
process.env.INWORLD_LAB_AREAS = 'voice,inference,media';
const {dispatchWorkflow, useUnifiedCredential} = await import('../voice-lab/server.mjs');
useUnifiedCredential();
const credential = process.env.INWORLD_API_KEY?.trim() || '';
const requests = new Map();
let core, corePromise, tools, workflowNames;
let closing = false, initializing = false, closePromise;

function redact(value) {
  if (!credential) return value;
  if (typeof value === 'string') return value.split(credential).join('[credential]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redact(item)]));
  }
  return value;
}
function send(value) {
  if (!process.stdout.destroyed) process.stdout.write(JSON.stringify(value) + '\n');
}
function protocolError(message, code = -32602) {
  return Object.assign(Error(message), {code});
}
async function initialize(params) {
  if (!corePromise) corePromise = openCore(params).then(value => (core = value));
  const workflows = await dispatchWorkflow({method: 'initialize', params});
  await corePromise;
  const coreTools = [], seen = new Set();
  let cursor;
  do {
    const page = await core.rpc('tools/list', cursor ? {cursor} : {});
    coreTools.push(...page.tools);
    cursor = page.nextCursor;
    if (cursor) {
      if (seen.has(cursor) || seen.size >= 100) throw Error('Invalid core pagination');
      seen.add(cursor);
    }
  } while (cursor);
  const extra = (await dispatchWorkflow({method: 'tools/list'})).tools;
  workflowNames = new Set(extra.map(tool => tool.name));
  // Design/publish use the enhanced workflow contract. Other core tools retain
  // their original schemas; duplicate short names never escape to the host.
  tools = [...coreTools.filter(tool => !workflowNames.has(tool.name)).map(projectCoreTool).map(describeAudioInputLimits), ...extra];
  return {
    ...workflows,
    protocolVersion: core.initialized.protocolVersion,
    serverInfo: {name: 'inworld', title: pluginDisplayName, version: pluginVersion},
    instructions: 'Use the registered schemas. This connection covers voice, transcription, inference, routing, images and video with one explicitly configured Inworld key. Tool availability is not permission to generate, upload, train, publish, change routers or compare external providers. Follow the user request and normal host approvals.',
  };
}
async function handle(msg, signal) {
  if (msg.method === 'initialize') {
    if (initializing || tools) throw protocolError('Already initialized', -32600);
    initializing = true;
    try { return await initialize(msg.params || {}); }
    finally { initializing = false; }
  }
  if (msg.method === 'ping') return {};
  if (!tools) throw protocolError('Initialize Inworld before calling tools.', -32002);
  if (msg.method === 'tools/list') return {tools};
  if (msg.method === 'tools/call') {
    const args = msg.params?.arguments;
    if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
      throw protocolError('Invalid arguments');
    }
    const name = msg.params?.name;
    if (!tools.some(tool => tool.name === name)) throw protocolError('Unknown Inworld tool');
    if (!credential && !['search_docs', 'check_speech_text'].includes(name)) {
      return withRecovery({content: [{type: 'text', text: credentialGuidance()}]},
        new RequestFailure('Missing configured credential', {status: 401, dispatched: false}));
    }
    // The bundled CLI's public search handler can consult the native keychain.
    // Keep this unauthenticated action outside its credential resolution path.
    if (name === 'search_docs') return searchDocs(args, signal);
    if (workflowNames.has(name)) return dispatchWorkflow(msg, signal);
    try { await preflightAudioInputs(name, args); }
    catch (error) {
      return withRecovery({content: [{type: 'text', text: error.message}]}, error, {tool: name, args});
    }
    const result = await core.rpc(msg.method, coreCallParams(msg.params), signal);
    // Validate the pinned core's artifact metadata at the public boundary. An
    // empty file is not usable audio, even when the service returned HTTP 200.
    if (name === 'synthesize_speech' && !result.isError) {
      for (const item of result.content ?? []) {
        if (item.type !== 'text') continue;
        let artifact;
        try { artifact = JSON.parse(item.text); } catch { continue; }
        if (artifact?.size_bytes === 0) {
          return withRecovery({content: [{type: 'text', text:
            'Speech generation returned an empty audio file. No playable audio was produced; do not retry automatically.'}],
            structuredContent: {artifact, valid_audio: false}},
            new RequestFailure('Empty generated audio', {method: 'POST', dispatched: true}), {tool: name, args});
        }
      }
    }
    return result;
  }
  if (msg.method.startsWith('resources/')) return dispatchWorkflow(msg, signal);
  throw protocolError('Method not found', -32601);
}
function dispatch(line) {
  let msg;
  try { msg = JSON.parse(line); }
  catch { send({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'Parse error'}}); return; }
  if (!msg || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' ||
      (msg.id !== undefined && msg.id !== null && !['number', 'string'].includes(typeof msg.id)) ||
      (msg.params !== undefined && (!msg.params || typeof msg.params !== 'object' || Array.isArray(msg.params)))) {
    send({jsonrpc: '2.0', id: null, error: {code: -32600, message: 'Invalid Request'}});
    return;
  }
  if (msg.method === 'notifications/cancelled') {
    requests.get(msg.params?.requestId)?.abort();
    return;
  }
  if (msg.id === undefined) return; // Notifications never dispatch a tool.
  if (closing || requests.has(msg.id) || requests.size >= 64) {
    send({jsonrpc: '2.0', id: msg.id, error: {code: -32600, message: 'Connection busy or duplicate request ID'}});
    return;
  }
  const controller = new AbortController();
  requests.set(msg.id, controller);
  Promise.resolve(handle(msg, controller.signal)).then(result => {
    if (result !== undefined) send({jsonrpc: '2.0', id: msg.id, result: redact(result)});
  }, error => {
    const detail = String(error.message).includes('retry')
      ? 'Do not retry an uncertain operation.' : 'Check the installed tool schema and connection.';
    send({jsonrpc: '2.0', id: msg.id, error: {code: error.code ?? -32603, message: 'Inworld request failed. ' + detail}});
  }).finally(() => {
    if (requests.get(msg.id) === controller) requests.delete(msg.id);
  });
}
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  if (Buffer.byteLength(buffer) > 1024 * 1024) {
    send({jsonrpc: '2.0', id: null, error: {code: -32600, message: 'Request exceeds 1 MiB'}});
    buffer = '';
    return;
  }
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end).trim();
    buffer = buffer.slice(end + 1);
    if (line) dispatch(line);
  }
});
function close() {
  if (closePromise) return closePromise;
  closing = true;
  for (const request of requests.values()) request.abort();
  closePromise = (async () => {
    try { if (corePromise) await corePromise; await core?.close(); } catch {}
  })();
  return closePromise;
}
process.stdin.on('end', close);
process.on('SIGTERM', () => close().finally(() => process.exit(0)));
process.on('SIGINT', () => close().finally(() => process.exit(0)));
process.stdout.on('error', close);
