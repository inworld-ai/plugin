// Server-side raw Chat Completions SSE, n=1. Preserve partial output as provisional.
// fetch and SDK retry policies belong to the caller; this consumer never retries.
export async function readChatStream(response, { onDelta, signal } = {}) {
  if (!response.ok || !response.body) throw new Error(`Chat HTTP ${response.status}`);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', data = [], done = false, finishReason, text = '', usage;
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  const event = () => {
    if (!data.length) return;
    const payload = data.join('\n').trim(); data = [];
    if (done) throw new Error('Chat event after completion marker');
    if (payload === '[DONE]') { done = true; return; }
    const chunk = JSON.parse(payload);
    if (chunk.error) throw new Error('Chat provider stream error');
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.find(c => c.index === 0);
    if (!choice) return; // usage-only records remain valid after finish_reason.
    const delta = choice.delta ?? {};
    if (finishReason != null && (delta.content || delta.tool_calls || delta.function_call)) throw new Error('Chat output after finish reason');
    if (typeof delta.content === 'string') text += delta.content;
    if (delta.content || delta.tool_calls || delta.function_call) onDelta?.(delta);
    if (choice.finish_reason != null) {
      if (finishReason != null) throw new Error('Duplicate chat finish reason');
      finishReason = choice.finish_reason;
    }
  };
  const line = raw => {
    const value = raw.replace(/\r$/, '');
    if (value === '') event();
    else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
  };
  try {
    signal?.throwIfAborted();
    signal?.addEventListener('abort', abort, { once: true });
    while (true) {
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) { line(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
    }
    buffer += decoder.decode();
    if (buffer) line(buffer);
    event();
    if (!done || !['stop', 'tool_calls', 'function_call'].includes(finishReason)) throw new Error(`Incomplete chat stream: finish=${finishReason ?? 'missing'}, DONE=${done}`);
    return { status: 'completed', text, finishReason, usage };
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
