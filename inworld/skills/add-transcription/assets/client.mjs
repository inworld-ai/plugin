const INWORLD_API_BASE = process.env.INWORLD_API_BASE ?? "https://api.inworld.ai";
function boundedFetch(url, options = {}, timeoutMs = 120_000) {
    return fetch(url, {
        ...options,
        signal: options.signal ?? AbortSignal.timeout(timeoutMs)
    });
}
function authHeaders(extra = {}) {
    const key = process.env.INWORLD_API_KEY;
    if (!key) throw new Error("INWORLD_API_KEY is not set");
    return {
        Authorization: `Basic ${key}`,
        ...extra
    };
}
function transcribeConfig(opts) {
    return {
        modelId: "inworld/inworld-stt-1",
        audioEncoding: "AUTO_DETECT",
        ...opts.language ? {
            language: opts.language
        } : {},
        ...opts.vocabulary?.length ? {
            prompts: opts.vocabulary
        } : {},
        ...opts.diarization || opts.timestamps ? {
            includeWordTimestamps: true
        } : {},
        ...opts.diarization ? {
            enableSpeakerDiarization: true
        } : {},
        ...opts.voiceProfile ? {
            voiceProfileConfig: {
                enableVoiceProfile: true
            }
        } : {}
    };
}
export async function transcribeShort(audio, opts = {}) {
    if (audio.byteLength > 16_000_000) throw new Error("Use async transcription for recordings over about 16 MB.");
    const res = await boundedFetch(`${INWORLD_API_BASE}/stt/v1/transcribe`, {
        method: "POST",
        headers: authHeaders({
            "Content-Type": "application/json"
        }),
        body: JSON.stringify({
            transcribeConfig: transcribeConfig({
                ...opts,
                diarization: false
            }),
            audioData: {
                content: audio.toString("base64")
            }
        })
    });
    if (!res.ok) throw new Error(`Inworld STT failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return {
        ...data.transcription,
        ...data.voiceProfile ? {
            voiceProfile: data.voiceProfile
        } : {},
        ...data.usage ? {
            usage: data.usage
        } : {}
    };
}
export class TranscriptionJobError extends Error {
    operationName;
    acceptanceUnknown;
    constructor(message, operationName, acceptanceUnknown = false, options){
        super(message, options), this.operationName = operationName, this.acceptanceUnknown = acceptanceUnknown;
    }
}
export async function submitTranscription(audio, opts = {}) {
    try {
        let submit;
        if ("url" in audio) {
            submit = await boundedFetch(`${INWORLD_API_BASE}/stt/v1/transcribe:async`, {
                method: "POST",
                headers: authHeaders({
                    "Content-Type": "application/json"
                }),
                body: JSON.stringify({
                    transcribeConfig: transcribeConfig(opts),
                    audioUri: audio.url
                })
            }, 360_000);
        } else {
            const form = new FormData();
            form.append("transcribeConfig", new Blob([
                JSON.stringify(transcribeConfig(opts))
            ], {
                type: "application/json"
            }));
            form.append("file", audio, "recording");
            submit = await boundedFetch(`${INWORLD_API_BASE}/stt/v1/transcribe:async`, {
                method: "POST",
                headers: authHeaders(),
                body: form
            }, 600_000);
        }
        if (!submit.ok) throw new TranscriptionJobError(`Inworld STT submit failed: ${submit.status}`, undefined, submit.status >= 500);
        const { name } = await submit.json();
        if (typeof name !== "string" || !name) throw new Error("Submit returned no operation name");
        return name;
    } catch (error) {
        if (error instanceof TranscriptionJobError) throw error;
        throw new TranscriptionJobError("Submission acceptance is unknown; reconcile before resubmitting", undefined, true, {
            cause: error
        });
    }
}
export async function waitTranscription(name, pollMs = 5000, timeoutMs = 30 * 60 * 1000) {
    try {
        const deadline = Date.now() + timeoutMs;
        while(Date.now() < deadline){
            await new Promise((r)=>setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            const op = await boundedFetch(`${INWORLD_API_BASE}/lro/v1alpha/${name}`, {
                headers: authHeaders()
            }, Math.min(30_000, remaining));
            if (!op.ok) throw new Error(`Inworld STT poll failed: ${op.status} ${await op.text()}`);
            const body = await op.json();
            if (!body.done) continue;
            if (body.error) throw new Error(`Inworld STT job failed: ${body.error.message ?? JSON.stringify(body.error)}`);
            const result = await boundedFetch(body.response.resultUri, {}, 60_000);
            if (!result.ok) throw new Error(`Inworld STT result download failed: ${result.status}`);
            return await result.json();
        }
        throw new Error("Polling timed out; resume the existing operation");
    } catch (error) {
        throw new TranscriptionJobError(`Operation ${name}: ${error instanceof Error ? error.message : String(error)}`, name, false, {
            cause: error
        });
    }
}
export async function transcribeLong(audio, opts, onSubmitted, pollMs = 5000, timeoutMs = 30 * 60 * 1000) {
    if (typeof onSubmitted !== "function") throw new Error("Provide durable onSubmitted persistence before submitting");
    const name = await submitTranscription(audio, opts);
    try {
        await onSubmitted(name);
    } catch (cause) {
        throw new TranscriptionJobError(`Persist operation ${name} before resuming`, name, false, {
            cause
        });
    }
    return waitTranscription(name, pollMs, timeoutMs);
}
export function speakerTurns(t) {
    const turns = [];
    for (const seg of t.segments){
        for (const w of seg.wordTimestamps ?? []){
            const speaker = w.speaker ?? null;
            const last = turns[turns.length - 1];
            if (last && last.speaker === speaker) last.text += ` ${w.word}`;
            else turns.push({
                speaker,
                text: w.word
            });
        }
    }
    return turns;
}
