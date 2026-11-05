// Copy into the app with browser-client.mjs or node-client.mjs. No plugin runtime dependency.
export const STT_URL = 'wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional';

export function sttConfig({ sampleRateHertz, language, vocabulary, diarization = false,
  voiceProfile = false, profileTopN, manualTurns = false, endOfTurnConfidenceThreshold, turnDetection = {} } = {}) {
  if (!Number.isInteger(sampleRateHertz) || sampleRateHertz < 8000 || sampleRateHertz > 48000)
    throw new Error('Declare the actual PCM sample rate (8000–48000 Hz).');
  const { minEndOfTurnSilenceWhenConfident: min, maxTurnSilence: max } = turnDetection;
  if (min !== undefined || max !== undefined) {
    if (![min, max].every(v => Number.isInteger(v) && v >= 20 && v <= 5000) || min > max)
      throw new Error('Set both silence thresholds in 20–5000 ms, minimum <= maximum.');
  }
  const config = { modelId: 'inworld/inworld-stt-1', audioEncoding: 'LINEAR16', sampleRateHertz, numberOfChannels: 1 };
  if (endOfTurnConfidenceThreshold !== undefined) {
    if (!Number.isFinite(endOfTurnConfidenceThreshold) || endOfTurnConfidenceThreshold < 0 || endOfTurnConfidenceThreshold > 1)
      throw new Error('End-of-turn confidence must be in 0–1.');
    config.endOfTurnConfidenceThreshold = endOfTurnConfidenceThreshold;
  }
  if (language) config.language = language;
  if (vocabulary?.length) config.prompts = vocabulary;
  if (diarization) Object.assign(config, { includeWordTimestamps: true, enableSpeakerDiarization: true });
  if (profileTopN !== undefined && (!Number.isInteger(profileTopN) || profileTopN < 1))
    throw new Error('profileTopN must be a positive integer.');
  if (voiceProfile) config.voiceProfileConfig = { enableVoiceProfile: true, ...(profileTopN === undefined ? {} : { topN: profileTopN }) };
  if (min !== undefined || manualTurns) config.inworldSttV1Config = { ...turnDetection, ...(manualTurns ? { vadThreshold: 0 } : {}) };
  return config;
}

function bytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('Audio must be raw PCM16 bytes, not a container or encoded string.');
}
function base64(value) {
  let text = '';
  for (const b of value) text += String.fromCharCode(b);
  return btoa(text);
}

export function createSttSession({ socket, config, audioProtocol = 'BINARY',
  connectTimeoutMs = 10000, drainTimeoutMs = 10000, maxBufferedBytes = 1048576, onTranscription = () => {},
  onSpeechStarted = () => {}, onSpeechStopped = () => {}, onVoiceProfile = () => {},
  onUsage = () => {}, onError = () => {}, onClose = () => {} }) {
  if (!['JSON', 'BINARY'].includes(audioProtocol)) throw new Error('audioProtocol must be JSON or BINARY.');
  let configured = false, finishing = false, settled = false, failure, drainTimer, finishPromise;
  let usageReceived = false;
  let resolveReady, rejectReady, resolveClosed;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // The caller still receives a rejecting ready; avoid an unhandled rejection before it awaits.
  ready.catch(() => {});
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const json = value => socket.send(JSON.stringify(value));
  const settle = (code, reason = '') => {
    if (settled) return;
    settled = true;
    clearTimeout(connectTimer); clearTimeout(drainTimer);
    if (!configured) rejectReady(failure ?? new Error(`STT closed before configuration (${code}).`));
    const result = { complete: finishing && code === 1000 && !failure && usageReceived,
      code, reason, usageReceived, ...(failure ? { error: failure.message } : {}) };
    resolveClosed(result); onClose(result);
  };
  const fail = error => {
    if (settled) return;
    failure = error instanceof Error ? error : new Error(String(error));
    rejectReady(failure); onError(failure);
    try { socket.close(); } finally { settle(1006, failure.message); }
  };
  const connectTimer = setTimeout(() => fail(new Error('STT connection timed out.')), connectTimeoutMs);
  socket.addEventListener('open', () => {
    if (settled) return;
    try { json({ transcribeConfig: config, audioProtocol }); configured = true; clearTimeout(connectTimer); resolveReady(); }
    catch (error) { fail(error); }
  });
  socket.addEventListener('message', event => {
    if (settled) return;
    try {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(bytes(event.data)));
      if (message.error) { fail(new Error(`STT ${message.error.code ?? 'error'}: ${message.error.message ?? 'Request failed'}`)); return; }
      const result = message.result;
      if (!result) return;
      if (result.speechStarted) onSpeechStarted(result.speechStarted);
      if (result.speechStopped) onSpeechStopped(result.speechStopped);
      if (result.transcription) onTranscription(result.transcription);
      const profile = result.transcription?.voiceProfile ?? result.voiceProfile;
      if (profile) onVoiceProfile(profile);
      if (result.usage) { usageReceived = true; onUsage(result.usage); }
    } catch (error) { fail(error); }
  });
  socket.addEventListener('error', () => fail(new Error('STT connection failed; check handshake, token and network.')));
  socket.addEventListener('close', event => settle(event.code, event.reason));
  const sendAudio = pcm => {
    if (!configured || finishing || settled) throw new Error('STT is not accepting audio. Await ready; do not send after finish.');
    if (socket.bufferedAmount > maxBufferedBytes) {
      const error = new Error('STT outgoing audio buffer exceeded the client limit; capture is incomplete.');
      fail(error); throw error;
    }
    const value = bytes(pcm);
    if (value.byteLength % 2) throw new Error('PCM16 chunks must have an even byte length.');
    if (!value.byteLength) return;
    if (audioProtocol === 'BINARY') socket.send(value);
    else json({ audioChunk: { content: base64(value) } });
  };
  return {
    ready, closed, sendAudio,
    endTurn() {
      if (!configured || finishing || settled) throw new Error('Cannot end a turn in this session state.');
      json({ endTurn: {} }); // Manual turn boundary only; does not close the session.
    },
    finish(tail) {
      if (finishPromise) return finishPromise;
      finishPromise = (async () => {
        await ready;
        if (settled) return closed;
        if (tail?.byteLength) sendAudio(tail);
        finishing = true;
        drainTimer = setTimeout(() => fail(new Error('STT drain timed out; transcript is incomplete.')), drainTimeoutMs);
        try { json({ closeStream: {} }); } catch (error) { fail(error); }
        return closed;
      })();
      return finishPromise;
    },
    abort() { fail(new Error('STT capture aborted; transcript may be incomplete.')); },
  };
}
