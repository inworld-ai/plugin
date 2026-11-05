import { createSttSession, sttConfig, STT_URL } from './session.mjs';

// Serve from the app, not a CDN. Caller mounts an authenticated, rate-limited token route.
export async function startBrowserStt(options) {
  const { tokenEndpoint, ...settings } = options;
  let stream, context, source, worklet, sink, session, socket, stopping, flushed, flushTimer;
  let accepting = true, cleaning;
  const cleanup = () => cleaning ??= (async () => {
    accepting = false;
    clearTimeout(flushTimer);
    if (socket && socket.readyState < 2) socket.close();
    source?.disconnect(); worklet?.disconnect(); sink?.disconnect();
    stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== 'closed') await context.close();
  })();
  try {
    // Run from a user gesture; microphone permission is handled by the app/browser.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    context = new AudioContext();
    const config = sttConfig({ ...settings, sampleRateHertz: context.sampleRate });
    await context.resume();
    const moduleUrl = URL.createObjectURL(new Blob([`
      class Capture extends AudioWorkletProcessor {
        constructor() {
          super(); this.samples = []; this.stopped = false;
          this.port.onmessage = e => {
            if (e.data === 'flush') {
              this.stopped = true; this.emit(); this.port.postMessage({ flushed: true });
            }
          };
        }
        emit() {
          if (!this.samples.length) return;
          const buffer = new ArrayBuffer(this.samples.length * 2), view = new DataView(buffer);
          this.samples.forEach((v, i) => view.setInt16(i * 2, v < 0 ? v * 32768 : v * 32767, true));
          this.samples = []; this.port.postMessage({ pcm: buffer }, [buffer]);
        }
        process(inputs) {
          if (this.stopped) return true;
          const input = inputs[0]?.[0];
          if (input) for (const sample of input) {
            this.samples.push(Math.max(-1, Math.min(1, sample)));
            if (this.samples.length >= Math.round(sampleRate * 0.1)) this.emit();
          }
          return true;
        }
      }
      registerProcessor('inworld-stt-capture', Capture);
    `], { type: 'text/javascript' }));
    try { await context.audioWorklet.addModule(moduleUrl); }
    finally { URL.revokeObjectURL(moduleUrl); }
    worklet = new AudioWorkletNode(context, 'inworld-stt-capture');
    const tokenResponse = await fetch(tokenEndpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!tokenResponse.ok) throw new Error(`Token endpoint failed (${tokenResponse.status}).`);
    const { accessToken } = await tokenResponse.json();
    if (!accessToken) throw new Error('Token endpoint did not return accessToken.');
    socket = new WebSocket(STT_URL, ['bearer_' + accessToken]);
    session = createSttSession({ ...settings, socket, config,
    });
    session.closed.then(() => cleanup()).catch(error => settings.onError?.(error));
    await session.ready;
    worklet.port.onmessage = event => {
      if (event.data.flushed) { flushed?.(); return; }
      if (event.data.pcm && accepting) {
        try { session.sendAudio(event.data.pcm); }
        catch (error) { session.abort(); settings.onError?.(error); }
      }
    };
    source = context.createMediaStreamSource(stream);
    sink = context.createGain(); sink.gain.value = 0;
    source.connect(worklet); worklet.connect(sink); sink.connect(context.destination);
    return {
      endTurn: () => session.endTurn(),
      closed: session.closed,
      stop() {
        if (stopping) return stopping;
        stopping = (async () => {
          try {
            // Port messages retain order: the last PCM arrives before the flush acknowledgement.
            await new Promise((resolve, reject) => {
              flushed = () => { clearTimeout(flushTimer); resolve(); };
              flushTimer = setTimeout(() => reject(new Error('Microphone flush timed out; capture is incomplete.')), 2000);
              worklet.port.postMessage('flush');
            });
            accepting = false;
            source.disconnect(); stream.getTracks().forEach(track => track.stop());
            return await session.finish(); // Drain final transcript and usage until server close.
          } catch (error) {
            session.abort(); throw error;
          } finally { await cleanup(); }
        })();
        return stopping;
      },
      async abort() { session.abort(); await cleanup(); },
    };
  } catch (error) {
    session?.abort(); await cleanup(); throw error;
  }
}
