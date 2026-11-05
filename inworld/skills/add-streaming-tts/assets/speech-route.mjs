import { streamSynthesize } from "./http-client.mjs";

export async function POST(req) {
    let payload;
    try { payload = await req.json(); }
    catch { return new Response("JSON body is required", { status: 400 }); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return new Response("JSON object is required", { status: 400 });
    const { text, voice = "Ashley", reasoning, reasoningContext, deliveryMode, synthesisContext } = payload;
    if (typeof text !== "string" || !text.trim()) return new Response("text is required", {
        status: 400
    });
    if (typeof voice !== "string" || !voice.trim())
        return new Response("voice must be a nonempty string", { status: 400 });
    if (reasoning !== undefined && !['default', 'on'].includes(reasoning))
        return new Response("reasoning must be default or on", { status: 400 });
    if (reasoningContext !== undefined && (typeof reasoningContext !== 'string' || [...reasoningContext].length > 600 || reasoning !== 'on'))
        return new Response("reasoningContext requires reasoning=on and at most 600 characters", { status: 400 });
    if (deliveryMode !== undefined && !['STABLE', 'BALANCED', 'CREATIVE'].includes(deliveryMode))
        return new Response("deliveryMode is invalid", { status: 400 });
    if (synthesisContext !== undefined && (!synthesisContext || typeof synthesisContext !== 'object' || Array.isArray(synthesisContext)))
        return new Response("synthesisContext must be an object", { status: 400 });
    const abort = new AbortController();
    req.signal.addEventListener("abort", ()=>abort.abort(), {
        once: true,
        signal: abort.signal
    });
    if (req.signal.aborted) abort.abort();
    return new Response(new ReadableStream({
        async start (controller) {
            try {
                await streamSynthesize({
                    apiKey: process.env.INWORLD_API_KEY,
                    text,
                    voiceId: voice,
                    reasoning, reasoningContext, deliveryMode, synthesisContext,
                    audioEncoding: "MP3",
                    signal: abort.signal,
                    onAudioChunk: (chunk)=>controller.enqueue(chunk)
                });
                controller.close();
            } catch (error) {
                controller.error(error);
            } finally{
                abort.abort();
            }
        },
        cancel () {
            abort.abort();
        }
    }), {
        headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store"
        }
    });
}
