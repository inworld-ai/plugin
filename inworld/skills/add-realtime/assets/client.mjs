import WebSocket from "ws";
import { randomUUID } from "node:crypto";
export class InworldRealtimeClient {
    opts;
    ws;
    ready;
    resolveReady;
    rejectReady;
    stopped = false;
    configured = false;
    timer;
    activeResponse;
    interrupted = new Set();
    constructor(opts){
        if (typeof opts.llmModel !== "string" || !opts.llmModel.trim()) throw new Error("llmModel is required; resolve a supported model from the live catalog before connecting");
        this.opts = opts;
        const sid = randomUUID();
        this.ready = new Promise((resolve, reject)=>{
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
        this.ready.catch(()=>{});
        this.ws = new WebSocket(`wss://api.inworld.ai/api/v1/realtime/session?key=${sid}&protocol=realtime`, {
            headers: {
                Authorization: `Basic ${opts.apiKey}`
            }
        });
        this.timer = setTimeout(()=>this.fail(new Error("Realtime session readiness timed out")), opts.connectTimeoutMs ?? 10000);
        this.ws.on("message", (raw)=>{
            if (this.stopped) return;
            try {
                this.handleEvent(JSON.parse(raw.toString()));
            } catch (error) {
                this.fail(error instanceof Error ? error : new Error(String(error)));
            }
        });
        this.ws.on("error", (error)=>this.fail(error));
        this.ws.on("close", ()=>this.close());
    }
    fail(error) {
        if (this.stopped) return;
        this.close();
        this.opts.onError?.(error);
    }
    configure() {
        this.ws.send(JSON.stringify({
            type: "session.update",
            session: {
                type: "realtime",
                model: this.opts.llmModel,
                instructions: this.opts.systemPrompt,
                output_modalities: [
                    "audio",
                    "text"
                ],
                audio: {
                    input: {
                        format: this.opts.audioFormat === "twilio" ? {
                            type: "audio/pcmu"
                        } : {
                            type: "audio/pcm",
                            rate: 24000
                        },
                        turn_detection: {
                            type: "semantic_vad",
                            eagerness: "medium",
                            create_response: true,
                            interrupt_response: true
                        }
                    },
                    output: {
                        format: this.opts.audioFormat === "twilio" ? {
                            type: "audio/pcmu"
                        } : {
                            type: "audio/pcm",
                            rate: 24000
                        },
                        voice: this.opts.voice ?? "Clive",
                        model: this.opts.ttsModel ?? "inworld-tts-2",
                        speed: 1.0
                    }
                }
            }
        }));
    }
    handleEvent(event) {
        switch(event.type){
            case "session.created":
                this.configure();
                break;
            case "session.updated":
                this.configured = true;
                clearTimeout(this.timer);
                this.resolveReady();
                break;
            case "response.created":
                this.activeResponse = event.response.id;
                break;
            case "input_audio_buffer.speech_started":
                if (this.activeResponse) this.interrupted.add(this.activeResponse);
                this.opts.onSpeechStarted?.();
                break;
            case "response.done":
                if (event.response?.id === this.activeResponse) this.activeResponse = undefined;
                break;
            case "response.output_audio.delta":
                if (!this.interrupted.has(event.response_id ?? this.activeResponse ?? "")) this.opts.onAudioDelta?.(event.delta);
                break;
            case "response.output_audio_transcript.delta":
                this.opts.onTranscript?.(event.delta, "assistant");
                break;
            case "conversation.item.input_audio_transcription.completed":
                this.opts.onTranscript?.(event.transcript, "user");
                break;
            case "error":
                this.fail(new Error(event.error?.message ?? "Realtime API error"));
                break;
        }
    }
    sendAudio(audioBase64) {
        return this.send({
            type: "input_audio_buffer.append",
            audio: audioBase64
        });
    }
    async sendText(text) {
        await this.send({
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [
                    {
                        type: "input_text",
                        text
                    }
                ]
            }
        });
        await this.send({
            type: "response.create",
            response: {
                output_modalities: [
                    "text",
                    "audio"
                ]
            }
        });
    }
    cancel() {
        if (this.activeResponse) this.interrupted.add(this.activeResponse);
        this.opts.onSpeechStarted?.();
        return this.send({
            type: "response.cancel"
        });
    }
    close() {
        if (this.stopped) return;
        this.stopped = true;
        clearTimeout(this.timer);
        if (!this.configured) this.rejectReady(new Error("Realtime closed before ready"));
        this.ws.close();
        this.opts.onClose?.();
    }
    async send(msg) {
        await this.ready;
        if (this.stopped) throw new Error("Realtime client is closed");
        this.ws.send(JSON.stringify(msg));
    }
}
