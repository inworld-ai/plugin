#!/usr/bin/env node
// Portable, one-shot MCP bridge. stdin: {server, name?, arguments?}.
// No command/entry overrides; no retries (a timed-out mutation may have succeeded).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { access, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { clientApplication, pluginVersion } from './client-info.mjs';
import { profiles } from './agent-profiles.mjs';

const INPUT_LIMIT = 1024 * 1024;
const OUTPUT_LIMIT = 16 * 1024 * 1024;
const SERVERS = new Map([
  ['inworld', new URL('../launcher.mjs', import.meta.url)],
  ['voice-lab', new URL('../launcher.mjs', import.meta.url)],
]);
// Explicit profiles only: values are never interpreted as commands or paths.
const SOURCES = new Map(Object.entries(profiles).map(([id, profile]) => [id, profile.source]));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };

function options() {
  let timeout = 180000, source;
  const seen = new Set();
  for (const arg of process.argv.slice(2)) {
    const match = /^(--timeout-ms|--source)=(.+)$/.exec(arg);
    if (!match || seen.has(match[1])) fail('Invalid CLI options.');
    seen.add(match[1]);
    if (match[1] === '--source') {
      if (!SOURCES.has(match[2])) fail('Unknown source profile.');
      source = match[2];
    } else {
      if (!/^\d+$/.test(match[2])) fail('Invalid timeout.');
      timeout = Number(match[2]);
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600000)
        fail('Timeout must be between 1 and 600000 ms.');
    }
  }
  return { timeout, source };
}

function readInput(signal) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const finish = (error, value) => {
      process.stdin.removeListener('data', data);
      process.stdin.removeListener('end', end);
      process.stdin.removeListener('error', errorHandler);
      signal.removeEventListener('abort', abort);
      process.stdin.pause();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(signal.reason);
    const errorHandler = () => finish(new Error('Cannot read stdin.'));
    const data = chunk => {
      size += chunk.length;
      if (size > INPUT_LIMIT) finish(new Error('Input exceeds 1 MiB.'));
      else chunks.push(chunk);
    };
    const end = () => {
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (!object(value) || Object.keys(value).some(k => !['server', 'name', 'arguments'].includes(k)))
          fail('Expected {server, name?, arguments?}.');
        if (!SERVERS.has(value.server)) fail('Unknown server.');
        if (Object.hasOwn(value, 'name') && (typeof value.name !== 'string' || !value.name.trim()))
          fail('Tool name must be a nonempty string.');
        if (Object.hasOwn(value, 'arguments') && !object(value.arguments))
          fail('Tool arguments must be an object.');
        finish(null, value);
      } catch (error) {
        finish(new Error(error instanceof SyntaxError || error instanceof TypeError
          ? 'Invalid JSON input.' : error.message));
      }
    };
    process.stdin.on('data', data).once('end', end).once('error', errorHandler);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

function connect(server, source, signal, credentialHome, metadataOnly, labAreas) {
  const child = spawn(process.execPath, [fileURLToPath(SERVERS.get(server))], {
    // Construct from constants and adapter-owned paths: never inspect shell keys,
    // provider/proxy settings, NODE_OPTIONS, or the user's credential directories.
    env: {
      PATH: dirname(process.execPath), HOME: credentialHome, USERPROFILE: credentialHome,
      XDG_CONFIG_HOME: credentialHome, APPDATA: credentialHome, LOCALAPPDATA: credentialHome,
      INWORLD_SESSION_FILE: join(credentialHome, 'absent-session.json'),
      INWORLD_API_KEY: '', INWORLD_PLUGIN_API_KEY: '',
      INWORLD_CLIENT_SOURCE: SOURCES.get(source) ?? 'other-agent',
      INWORLD_CLIENT_APP: clientApplication(SOURCES.get(source)), INWORLD_CLIENT_APP_VERSION: pluginVersion, INWORLD_SKILL_PREFIX: 'inworld-',
      ...(metadataOnly ? { INWORLD_SKIP_AUTH: '1' } : {}),
      ...(server === 'inworld' ? { INWORLD_MCP_TOOLSET: 'runtime' } : { INWORLD_LAB_AREAS: labAreas.join(',') }),
    },
    cwd: credentialHome,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  let sequence = 0, buffer = '', stdoutBytes = 0, stderrBytes = 0, failure;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const pending = new Map();
  let killTimer;
  const stop = () => {
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 250);
    }
  };
  const fatal = error => {
    failure ??= error;
    for (const { reject } of pending.values()) reject(failure);
    pending.clear();
    stop();
  };
  const abort = () => fatal(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  child.once('error', () => fatal(new Error('Cannot start MCP server.')));
  child.once('exit', () => fatal(new Error('MCP server exited before completion.')));
  child.once('close', () => {
    clearTimeout(killTimer);
    signal.removeEventListener('abort', abort);
  });
  child.stdin.on('error', () => fatal(new Error('MCP input pipe failed.')));
  child.stdout.on('error', () => fatal(new Error('MCP output pipe failed.')));
  child.stderr.on('error', () => fatal(new Error('MCP diagnostic pipe failed.')));
  // Never forward child diagnostics, RPC error messages, or exception details:
  // those can contain authorization headers, environment values, or input text.
  child.stderr.on('data', chunk => {
    stderrBytes += chunk.length;
    if (stderrBytes > INPUT_LIMIT) fatal(new Error('MCP diagnostics exceed limit.'));
  });
  child.stdout.on('data', chunk => {
    if (failure) return;
    try {
      stdoutBytes += chunk.length;
      if (stdoutBytes > OUTPUT_LIMIT) fail('MCP output exceeds limit.');
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const msg = JSON.parse(line);
        if (!object(msg) || msg.jsonrpc !== '2.0') fail('Invalid MCP response.');
        if (!Object.hasOwn(msg, 'id')) {
          if (typeof msg.method !== 'string' || Object.hasOwn(msg, 'result') || Object.hasOwn(msg, 'error'))
            fail('Invalid MCP notification.');
          continue;
        }
        const waiting = pending.get(msg.id);
        if (!waiting || Object.hasOwn(msg, 'method') ||
            Object.hasOwn(msg, 'result') === Object.hasOwn(msg, 'error')) fail('Unexpected MCP response.');
        if (Object.hasOwn(msg, 'error')) fail('MCP request failed.');
        if (!object(msg.result)) fail('Invalid MCP result.');
        pending.delete(msg.id);
        waiting.resolve(msg.result);
      }
    } catch {
      fatal(new Error('Invalid or excessive MCP output.'));
    }
  });
  const send = msg => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    if (failure || signal.aborted) return reject(failure ?? signal.reason);
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    send({ id, method, params });
  });
  if (signal.aborted) abort();
  return { rpc, closed, notify: method => send({ method }), stop,
    check: () => { if (failure || signal.aborted) throw failure ?? signal.reason; } };
}

async function main() {
  const { timeout, source } = options();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Adapter deadline exceeded; outcome may be uncertain. Do not retry mutations automatically.')), timeout);
  const onInt = () => controller.abort(new Error('Adapter interrupted; outcome may be uncertain.'));
  const onTerm = () => controller.abort(new Error('Adapter terminated; outcome may be uncertain.'));
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  let client, credentialHome;
  try {
    const input = await readInput(controller.signal);
    // Terminal execution is metadata/offline-only. Authenticated actions must
    // use native MCP with a credential explicitly configured and approved there.
    if (input.name !== undefined && input.name !== 'check_speech_text')
      fail('Terminal authentication gate blocked: use host-approved native MCP credential configuration for this action.');
    try { await access(SERVERS.get(input.server)); }
    catch { fail('The Inworld server is not bundled.'); }
    const labAreas = []; // Legacy server selector is an alias, never another connection.
    credentialHome = await mkdtemp(join(tmpdir(), 'inworld-adapter-empty-home-'));
    client = connect(input.server, source, controller.signal, credentialHome, input.name === undefined, labAreas);
    const init = await client.rpc('initialize', {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'inworld-terminal-adapter', version: '1.0.0' },
    });
    if (!['2024-11-05', '2025-03-26', '2025-06-18'].includes(init.protocolVersion) ||
        !object(init.capabilities) || !object(init.capabilities.tools) || !object(init.serverInfo) ||
        typeof init.serverInfo.name !== 'string' || typeof init.serverInfo.version !== 'string')
      fail('Invalid MCP initialization.');
    client.notify('notifications/initialized');
    const tools = [], cursors = new Set();
    let cursor, listed;
    do {
      listed = await client.rpc('tools/list', cursor === undefined ? {} : { cursor });
      if (!Array.isArray(listed.tools) || listed.tools.some(t => !object(t) || typeof t.name !== 'string' || !object(t.inputSchema)))
        fail('Invalid MCP tool list.');
      for (const tool of listed.tools) tools.push(tool);
      cursor = listed.nextCursor;
      if (cursor !== undefined) {
        if (typeof cursor !== 'string' || !cursor || cursors.has(cursor) || cursors.size >= 100)
          fail('Invalid MCP tool pagination.');
        cursors.add(cursor);
      }
    } while (cursor !== undefined);
    let result = { ...listed, tools };
    delete result.nextCursor;
    if (input.name !== undefined) {
      if (!tools.some(tool => tool.name === input.name)) fail('Unknown tool.');
      result = await client.rpc('tools/call', { name: input.name, arguments: input.arguments ?? {} });
      if (!Array.isArray(result.content) || (Object.hasOwn(result, 'isError') && typeof result.isError !== 'boolean'))
        fail('Invalid MCP tool result.');
    }
    client.check();
    const output = JSON.stringify(result) + '\n';
    if (Buffer.byteLength(output) > OUTPUT_LIMIT) fail('Result exceeds output limit.');
    process.stdout.write(output);
    if (result.isError === true) process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    client?.stop();
    if (client) await client.closed;
    if (credentialHome) await rm(credentialHome, { recursive: true, force: true });
  }
}

process.stdout.on('error', () => { process.exitCode = 1; });
main().catch(error => {
  // All raised messages are adapter-owned constants, never server-supplied text.
  process.stderr.write(`call-tool: ${error.message}\n`);
  process.exitCode = 1;
});
