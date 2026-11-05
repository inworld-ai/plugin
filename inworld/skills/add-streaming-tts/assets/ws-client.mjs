import WebSocket from "ws";
export class StreamingTtsWs {
    opts;
    ws;
    ready;
    seq = 0;
    active = new Set();
    stopped = false;
    constructor(opts){
        this.opts = opts;
        this.ws = new WebSocket("wss://api.inworld.ai/tts/v1/voice:streamBidirectional", {
            headers: {
                Authorization: `Basic ${opts.apiKey}`
            }
        });
        this.ready = new Promise((resolve, reject)=>{
            this.ws.once("open", ()=>resolve());
            this.ws.once("error", reject);
            this.ws.once("close", ()=>reject(new Error("TTS socket closed before ready")));
        });
        this.ready.catch(()=>{});
        this.ws.once("close", ()=>{
            this.stopped = true;
            this.active.clear();
            opts.clearPlayback();
        });
        this.ws.on("message", (raw)=>{
            try {
                this.handle(JSON.parse(raw.toString()));
            } catch (error) {
                opts.onError?.(error);
            }
        });
        this.ws.on("error", (e)=>opts.onError?.(e));
    }
    handle(msg) {
        const r = msg?.result;
        const ctx = r?.contextId ?? msg.contextId;
        const status = msg.error ?? r?.status;
        if (msg.error || status?.code != null && Number(status.code) !== 0) {
            if (ctx) {
                this.active.delete(ctx);
                this.opts.clearPlayback(ctx);
            } else {
                this.active.clear();
                this.opts.clearPlayback();
            }
            this.opts.onError?.(new Error(`TTS incomplete (${status?.code ?? "error"}): ${status?.message ?? "generation failed"}`));
            return;
        }
        if (!r || !this.active.has(ctx)) return;
        const b64 = r.audioChunk?.audioContent ?? r.audioContent;
        if (b64) this.opts.onAudioChunk?.(Buffer.from(b64, "base64"), ctx);
        if (r.contextClosed) {
            this.active.delete(ctx);
            this.opts.onContextClosed?.(ctx);
        }
    }
    async send(msg) {
        await this.ready;
        if (this.stopped) throw new Error("TTS socket is closed; create a new client");
        this.ws.send(JSON.stringify(msg));
    }
    async open() {
        const contextId = `ctx-${++this.seq}`;
        this.active.add(contextId);
        await this.send({
            context_id: contextId,
            create: {
                voice_id: this.opts.voiceId,
                model_id: this.opts.modelId ?? "inworld-tts-2",
                audio_config: {
                    audio_encoding: this.opts.audioEncoding ?? "MP3",
                    sample_rate_hertz: this.opts.sampleRateHertz ?? 48000
                },
                // The server buffers partial text and starts synthesis at each sentence end.
                auto_mode: true,
                auto_mode_strategy: "SENTENCE_BOUNDARY"
            }
        });
        return contextId;
    }
    speak(contextId, text, flush = false) {
        return this.send({
            context_id: contextId,
            send_text: flush ? {
                text,
                flush_context: {}
            } : {
                text
            }
        });
    }
    flush(contextId) {
        return this.send({
            context_id: contextId,
            flush_context: {}
        });
    }
    closeContext(contextId) {
        return this.send({
            context_id: contextId,
            close_context: {}
        });
    }
    cancel() {
        this.stopped = true;
        this.active.clear();
        this.opts.clearPlayback();
        this.ws.close();
    }
    close() {
        this.cancel();
    }
}
