// Shared lifecycle policy: no retries (POST acceptance can be uncertain).
import { pluginClientInfo } from '../scripts/client-info.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { RequestFailure } from './recovery.mjs';
const scope = new AsyncLocalStorage();
export const withRequestSignal = (signal, fn) => scope.run(signal, fn);
let active = 0;
const queue = [];
const MAX_ACTIVE = 4;
const MAX_QUEUED = 32;
export function clientSource(env = process.env) {
  return ['claude-code-plugin', 'codex-plugin'].includes(env.INWORLD_CLIENT_SOURCE)
    ? env.INWORLD_CLIENT_SOURCE : 'other-agent';
}
export async function fetchWithPolicy(url, init = {}, { timeoutMs = 60_000, maxBytes = 16 * 1024 * 1024, fetcher = globalThis.fetch } = {}) {
  if (!(timeoutMs > 0) || !(maxBytes > 0)) throw new Error('Invalid HTTP policy');
  const controller = new AbortController();
  const signals = [...new Set([init.signal, scope.getStore()].filter(Boolean))];
  const abort = (signal) => controller.abort(signal.reason ?? new Error('Request cancelled'));
  const listeners = signals.map(signal => {
    const fn = () => abort(signal);
    if (signal.aborted) fn(); else signal.addEventListener('abort', fn, { once: true });
    return [signal, fn];
  });
  let deadlineExpired = false;
  const timer = setTimeout(() => { deadlineExpired = true; controller.abort(new Error(`HTTP deadline exceeded (${timeoutMs} ms)`)); }, timeoutMs);
  let acquired = false, finished = false, reader, dispatched = false, receivedBytes = 0;
  const failure = error => error instanceof RequestFailure ? error : new RequestFailure(String(error?.message ?? error), {
    method: String(init.method ?? 'GET').toUpperCase(), dispatched, partial: receivedBytes > 0,
    kind: deadlineExpired ? 'timeout' : signals.some(s => s.aborted) ? 'cancelled'
      : /^HTTP (?:concurrency queue full|response exceeds)/.test(String(error?.message)) ? 'policy' : 'transport',
  });
  const cleanup = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    for (const [signal, fn] of listeners) signal.removeEventListener('abort', fn);
    if (acquired) { active--; queue.shift()?.(); }
  };
  let rejectAbort;
  const cancelled = new Promise((_, reject) => { rejectAbort = reject; });
  // Always observe cancellation, including between consumer reads.
  cancelled.catch(() => {});
  const onAbort = () => {
    rejectAbort(failure(controller.signal.reason));
    if (reader) Promise.resolve(reader.cancel(controller.signal.reason)).catch(() => {});
    cleanup();
  };
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const race = p => Promise.race([p, cancelled]);
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (active >= MAX_ACTIVE) {
      if (queue.length >= MAX_QUEUED) throw new Error('HTTP concurrency queue full');
      let wake;
      try {
        await race(new Promise(resolve => {
          wake = () => {
            if (controller.signal.aborted) { queue.shift()?.(); return; }
            active++; acquired = true; resolve();
          };
          queue.push(wake);
        }));
      } finally { const i = queue.indexOf(wake); if (i >= 0) queue.splice(i, 1); }
    } else { active++; acquired = true; }
    if (controller.signal.aborted) throw controller.signal.reason;
    const headers = new Headers(init.headers);
    headers.set('x-user-agent', pluginClientInfo());
    dispatched = true;
    const pending = Promise.resolve(fetcher(url, { ...init, headers, signal: controller.signal }));
    pending.then(res => { if (controller.signal.aborted) res.body?.cancel().catch(() => {}); }, () => {});
    const res = await race(pending);
    if (controller.signal.aborted) throw controller.signal.reason;
    const length = Number(res.headers.get('content-length'));
    if (length > maxBytes) { res.body?.cancel().catch(() => {}); throw new Error(`HTTP response exceeds ${maxBytes} bytes`); }
    if (!res.body) { cleanup(); return res; }
    reader = res.body.getReader();
    let size = 0;
    const body = new ReadableStream({
      async pull(out) {
        try {
          // Cancelling the upstream reader resolves its next read as EOF. A
          // previously rejected cancellation promise can lose Promise.race to
          // that resolved read, so check the signal on both sides of the await.
          if (controller.signal.aborted) throw controller.signal.reason;
          const { done, value } = await race(reader.read());
          if (controller.signal.aborted) throw controller.signal.reason;
          if (done) { cleanup(); out.close(); return; }
          size += value.byteLength;
          receivedBytes = size;
          if (size > maxBytes) {
            controller.abort(new Error(`HTTP response exceeds ${maxBytes} bytes`));
            throw controller.signal.reason;
          }
          out.enqueue(value);
        } catch (err) { cleanup(); out.error(failure(err)); }
      },
      async cancel(reason) { controller.abort(reason ?? new Error('Response cancelled')); cleanup(); },
    }, { highWaterMark: 0 });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  } catch (err) { cleanup(); throw failure(err); }
}
