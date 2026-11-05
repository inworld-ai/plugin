export async function streamSynthesize(opts) {
    const modelId = opts.modelId ?? "inworld-tts-2";
    if (opts.reasoning !== undefined && !['default', 'on'].includes(opts.reasoning)) throw new Error('reasoning must be default or on');
    if (opts.reasoningContext !== undefined && (typeof opts.reasoningContext !== 'string' || [...opts.reasoningContext].length > 600)) throw new Error('reasoningContext must be a string of at most 600 characters');
    if (opts.reasoningContext !== undefined && opts.reasoning !== 'on') throw new Error('reasoningContext requires reasoning=on');
    if (opts.reasoning === 'on' && modelId !== 'inworld-tts-2') throw new Error('TTS Reasoning requires inworld-tts-2');
    if (opts.synthesisContext !== undefined && (!opts.synthesisContext || typeof opts.synthesisContext !== 'object' || Array.isArray(opts.synthesisContext))) throw new Error('synthesisContext must be an object');
    const body = {
        text: opts.text,
        voiceId: opts.voiceId,
        modelId,
        audioConfig: {
            audioEncoding: opts.audioEncoding ?? "MP3",
            sampleRateHertz: opts.sampleRateHertz ?? 48000,
            speakingRate: opts.speakingRate ?? 1.0
        }
    };
    // ASYNC sends timestamps in their own records so they don't hold back the first audio chunk.
    if (opts.onTimestamp) {
        body.timestampType = "WORD";
        body.timestampTransportStrategy = "ASYNC";
    }
    if (opts.deliveryMode && modelId === "inworld-tts-2") {
        body.deliveryMode = opts.deliveryMode;
    }
    if (opts.synthesisContext !== undefined) body.synthesisContext = { ...opts.synthesisContext };
    if (opts.reasoning === 'on') body.synthesisContext = {
        ...body.synthesisContext,
        reasoning: 'REASONING_ON',
        ...(opts.reasoningContext !== undefined ? {reasoningContext:opts.reasoningContext} : {})
    };
    const res = await fetch("https://api.inworld.ai/tts/v1/voice:stream", {
        method: "POST",
        headers: {
            Authorization: `Basic ${opts.apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: opts.signal
    });
    if (!res.ok || !res.body) {
        throw new Error(`Inworld streaming TTS failed: ${res.status} ${await res.text()}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", audioBytes = 0;
    const consume = (line)=>{
        if (!line.trim()) return;
        const obj = JSON.parse(line);
        const status = obj.error ?? obj.result?.status;
        if (obj.error || status?.code != null && Number(status.code) !== 0) {
            throw new Error(`Inworld TTS incomplete (${status?.code ?? "error"}): ${status?.message ?? "generation failed"}`);
        }
        const result = obj.result;
        const instruction = result?.reasoningInstruction ?? result?.autoSteerInstruction;
        if (typeof instruction === 'string' && instruction) opts.onReasoningInstruction?.(instruction);
        if (result?.audioContent) {
            const audio = Buffer.from(result.audioContent, "base64");
            if (audio.byteLength) {
                audioBytes += audio.byteLength;
                opts.onAudioChunk?.(audio);
            }
        }
        if (result?.timestampInfo) opts.onTimestamp?.(result.timestampInfo);
    };
    try {
        while(true){
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, {
                stream: true
            });
            let nl;
            while((nl = buf.indexOf("\n")) !== -1){
                consume(buf.slice(0, nl));
                buf = buf.slice(nl + 1);
            }
        }
        buf += decoder.decode();
        consume(buf);
        if (opts.text.trim() && audioBytes === 0) {
            throw new Error("Inworld TTS incomplete: no audio received before EOF");
        }
    } finally{
        await reader.cancel().catch(()=>{});
        reader.releaseLock();
    }
}
