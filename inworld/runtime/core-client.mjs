// Internal client for the exact published CLI artifact. Authenticated calls use
// an explicit key; public docs search bypasses its credential-store fallback.
// Child diagnostics stay private, and requests are never retried.
import {StringDecoder} from 'node:string_decoder';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {clientApplication, pluginVersion} from '../scripts/client-info.mjs';

export async function openCore(params) {
  const home = await mkdtemp(join(tmpdir(), 'inworld-runtime-'));
  const env = {
    PATH: dirname(process.execPath), HOME: home, USERPROFILE: home,
    XDG_CONFIG_HOME: home, APPDATA: home, LOCALAPPDATA: home,
    INWORLD_SKIP_AUTH: '1', INWORLD_API_KEY: process.env.INWORLD_API_KEY?.trim() || '',
    INWORLD_MCP_TOOLSET: 'runtime', INWORLD_SESSION_FILE: join(home, 'absent-session.json'),
    INWORLD_CLIENT_SOURCE: process.env.INWORLD_CLIENT_SOURCE || 'other-agent',
    INWORLD_CLIENT_APP: clientApplication(process.env.INWORLD_CLIENT_SOURCE),
    INWORLD_CLIENT_APP_VERSION: pluginVersion,
  };
  if (process.env.INWORLD_API_BASE) env.INWORLD_API_BASE = process.env.INWORLD_API_BASE;
  const child = spawn(process.execPath, [
    '--import', fileURLToPath(new URL('../build/index.js', import.meta.url)), '--eval', '',
  ], {
    env,
    // Credential isolation belongs to HOME/config paths, not file resolution.
    // Keep the host's working directory so relative inputs and outputs behave
    // like the public MCP process, and survive credential-home cleanup.
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map(), decoder = new StringDecoder('utf8');
  let seq = 0, buffer = '', failure, stopping = false, closePromise;
  const done = new Promise(resolve => child.once('close', resolve));
  function fail() {
    failure = Error('Inworld core runtime unavailable. Do not retry an uncertain operation.');
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  }
  child.on('error', fail);
  child.on('exit', () => { if (!stopping) fail(); });
  child.stdin.on('error', fail);
  child.stderr.on('data', () => {});
  child.stdout.on('data', bytes => {
    buffer += decoder.write(bytes);
    if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) { fail(); child.kill(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id === undefined) continue;
        const request = pending.get(msg.id);
        if (!request) continue;
        pending.delete(msg.id);
        if (msg.jsonrpc !== '2.0' || (msg.error === undefined && msg.result === undefined)) {
          request.reject(Error('Invalid core response'));
          fail(); child.kill(); return;
        }
        if (msg.error) request.reject(Error('Inworld core request failed; operation was not retried.'));
        else request.resolve(msg.result);
      } catch { fail(); child.kill(); }
    }
  });
  const rpc = (method, request = {}, signal) => new Promise((resolve, reject) => {
    if (failure || stopping) return reject(failure || Error('Runtime closed'));
    if (pending.size >= 64) return reject(Error('Too many pending Inworld requests'));
    if (signal?.aborted) return reject(Error('Request cancelled; operation was not retried.'));
    const id = ++seq;
    const finish = fn => value => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      fn(value);
    };
    const abort = () => {
      // Reject the caller, but keep the slot until the child replies or closes.
      // The pinned core may ignore cancellation during an upstream HTTP call.
      child.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: id, reason: 'Caller cancelled'}}) + '\n');
      finish(reject)(Error('Request cancelled; operation may have completed. Do not retry automatically.'));
    };
    const timer = setTimeout(() => {
      child.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: id, reason: 'Deadline expired'}}) + '\n');
      finish(reject)(Error('Core request deadline exceeded; operation may have completed. Do not retry automatically.'));
    }, method === 'initialize' ? 10000 : 120000);
    pending.set(id, {resolve: finish(resolve), reject: finish(reject)});
    signal?.addEventListener('abort', abort, {once: true});
    child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params: request}) + '\n');
  });
  function close() {
    if (closePromise) return closePromise;
    stopping = true;
    fail();
    child.stdin.destroy();
    child.kill('SIGTERM');
    closePromise = (async () => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 500);
      try { await done; }
      finally { clearTimeout(timer); await rm(home, {recursive: true, force: true}); }
    })();
    return closePromise;
  }
  try {
    const initialized = await rpc('initialize', params);
    child.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');
    return {rpc, close, initialized};
  } catch (error) { await close(); throw error; }
}
