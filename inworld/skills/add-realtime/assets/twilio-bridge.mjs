import { InworldRealtimeClient } from "./client.mjs";

export function bridgeTwilio(twilio, opts) {
    let streamSid;
    let stopped = false, ready = false, pendingBytes = 0;
    const pending = [];
    const client = new InworldRealtimeClient({
        ...opts,
        audioFormat: "twilio",
        onAudioDelta (payload) {
            if (!stopped && streamSid) twilio.send(JSON.stringify({
                event: "media",
                streamSid,
                media: {
                    payload
                }
            }));
        },
        onSpeechStarted () {
            if (!stopped && streamSid) twilio.send(JSON.stringify({
                event: "clear",
                streamSid
            }));
            opts.onSpeechStarted?.();
        },
        onClose () {
            stop();
            opts.onClose?.();
        },
        onError (error) {
            stop();
            opts.onError?.(error);
        }
    });
    function stop() {
        if (stopped) return;
        stopped = true;
        pending.length = 0;
        client.close();
        twilio.close();
    }
    client.ready.catch(()=>stop());
    twilio.on("message", (raw)=>{
        if (stopped) return;
        try {
            const event = JSON.parse(raw.toString());
            if (event.event === "start") {
                const format = event.start.mediaFormat;
                if (format.encoding !== "audio/x-mulaw" || format.sampleRate !== 8000 || format.channels !== 1) throw new Error("Expected Twilio mono mu-law at 8000 Hz");
                streamSid = event.start.streamSid;
            } else if (event.event === "media") {
                if (!streamSid) throw new Error("Twilio media arrived before start");
                if (!ready) {
                    pendingBytes += Buffer.from(event.media.payload, "base64").byteLength;
                    if (pendingBytes > 8000) throw new Error("Realtime setup exceeded one second of buffered Twilio audio");
                    pending.push(event.media.payload);
                } else {
                    client.sendAudio(event.media.payload).catch((error)=>{
                        stop();
                        opts.onError?.(error);
                    });
                }
            } else if (event.event === "stop") stop();
        } catch (error) {
            stop();
            opts.onError?.(error);
        }
    });
    client.ready.then(async ()=>{
        if (stopped) return;
        ready = true;
        const sends = pending.map((payload)=>client.sendAudio(payload));
        pending.length = 0;
        pendingBytes = 0;
        await Promise.all(sends);
    }).catch((error)=>{
        stop();
        opts.onError?.(error);
    });
    twilio.on("close", stop);
    twilio.on("error", (error)=>{
        stop();
        opts.onError?.(error);
    });
    return {
        client,
        ready: client.ready,
        stop
    };
}
