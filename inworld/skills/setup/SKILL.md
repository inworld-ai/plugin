---
name: setup
description: "Set up Inworld voice APIs in a project. Use for a first speech integration, reusable clients and working TTS or transcription examples."
---

# Inworld Setup Skill

Wire Inworld AI speech APIs into the current project end-to-end. Detects the user's stack, adds the right dependencies and env vars, scaffolds a reusable TTS-2 client and working example; delegates recorded and live STT to their dedicated workflows before scaffolding. Use when the user wants to add Inworld voice features to a project for the first time, or asks to add text-to-speech, speech-to-text, or a voice to their app without naming a provider.

Wire Inworld's speech APIs into the user's project.

Route STT before any access check or scaffold: use
[add-transcription](../add-transcription/SKILL.md) for recorded files, including
short clips, long jobs and speaker labels; use
[add-streaming-stt](../add-streaming-stt/SKILL.md) for live recognition.
For STT-only requests, continue there directly. For combined TTS/STT work, share
stack discovery, dependencies and env setup, then use each dedicated STT client.

For inference-only requests, use `add-llm` and `benchmark-models` instead of
scaffolding speech. Reuse the provider and app context already in this session.
For image or video requests, use `generate-image` or `generate-video`; those paths discover output-capable models, handle media files and preserve video job identity. Do not scaffold speech for a media-only task.

For voice output, infer the persona and language from the app, then follow
`find-voice` steps 1–4 to audition real product lines before settling on a voice.
Return to this setup flow afterward rather than restarting it. Keep a voice the
user has already chosen. Use `speakable-text` to check names, exact IDs and spoken
formatting; use `pronunciation` for reusable dictionaries and `custom-voice` for
IVC/PVC. Use `latency` to measure the finished path and `test-voice` to preserve
representative utterances for later changes.

## Step 0 — Make sure the agent can reach Inworld

Check only the product the user needs, following `connect`'s task-specific check.
For STT-only work, do not list voices or synthesize a greeting: an STT key need not
have Voices Read/TTS permissions. Use a permitted recording when available and
otherwise mark live STT verification pending. For TTS use `list_voices`.
Reuse an existing task-specific access result instead of repeating its failing call.
For a missing or invalid key, use the Inworld `connect` skill
(`/inworld:connect` in Claude Code) for the needed credential guidance; a 403
requires permission/workspace diagnosis, not an assumption of invalid credentials.
Continue local preparation without waiting for login; only live API work needs a key.

If the project already calls another TTS provider (ElevenLabs, OpenAI, Cartesia,
Deepgram, Google, Azure, Polly), use the Inworld `migrate` skill instead: it swaps the
existing integration rather than adding a second one.

## Step 1 — Detect the stack

Look at the project root and read the most informative file you find:
- `package.json` → Node.js / TypeScript. Note frameworks: Next.js, Remix, Express, Fastify, NestJS, Vite, React.
- `pyproject.toml` / `requirements.txt` → Python. Note frameworks: FastAPI, Flask, Django.
- `go.mod` → Go.
- `Cargo.toml` → Rust.
- `Gemfile` → Ruby/Rails.

Pick the integration style that matches: server-side route, client component with mic, CLI script.

## Step 2 — Scope (from $ARGUMENTS)

- `tts` → Text-to-Speech only
- `stt` → Speech-to-Text only
- `both` → Both, when the user wants both
- Empty → infer the requested product from the user/app; STT does not imply TTS.

If the user wants Realtime voice-agent conversations (bidirectional streaming),
tell them to run `/inworld:add-realtime` instead — that's a different transport
and gets its own skill.

For recorded STT, continue with `/inworld:add-transcription`; for live STT
(captions, dictation or streaming mic → text without a full LLM+TTS loop),
continue with `/inworld:add-streaming-stt`. Do not scaffold a synchronous-only
client before selecting the recorded-audio mode and required features.

## Step 3 — Scaffold the client module

For TTS, write a single helper file that the rest of the app imports. Keep it short.
Use the dedicated STT skill assets for transcription; the examples below are TTS-only.

### Node.js / TypeScript

Path: `src/lib/inworld.ts` (or `lib/inworld.ts` if there's no `src/`).

```ts
const INWORLD_API_BASE = "https://api.inworld.ai";

function authHeaders() {
  const key = process.env.INWORLD_API_KEY;
  if (!key) throw new Error("INWORLD_API_KEY is not set");
  return {
    Authorization: `Basic ${key}`,
    "Content-Type": "application/json",
  };
}

export interface SynthesizeOptions {
  text: string;
  voiceId: string;
  modelId?: "inworld-tts-2" | "inworld-tts-2-flash";
  audioEncoding?: "MP3" | "LINEAR16" | "WAV" | "OGG_OPUS" | "FLAC";
  sampleRateHertz?: number;
  speakingRate?: number;
  deliveryMode?: "STABLE" | "BALANCED" | "CREATIVE";
}

export async function synthesize(opts: SynthesizeOptions): Promise<Buffer> {
  const body: Record<string, unknown> = {
    text: opts.text,
    voiceId: opts.voiceId,
    modelId: opts.modelId ?? "inworld-tts-2",
    audioConfig: {
      audioEncoding: opts.audioEncoding ?? "MP3",
      sampleRateHertz: opts.sampleRateHertz ?? 48000,
      speakingRate: opts.speakingRate ?? 1.0,
    },
  };
  if (opts.deliveryMode && (opts.modelId ?? "inworld-tts-2") === "inworld-tts-2") {
    body.deliveryMode = opts.deliveryMode;
  }

  const res = await fetch(`${INWORLD_API_BASE}/tts/v1/voice`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Inworld TTS failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { audioContent: string };
  return Buffer.from(data.audioContent, "base64");
}
```

For Next.js, also create `app/api/tts/route.ts` (or `pages/api/tts.ts`) that wraps
`synthesize` and streams the buffer back as `audio/mpeg`.

### Python

Path: `src/inworld.py` (or top-level `inworld.py`).

```python
import base64
import os
import httpx

INWORLD_API_BASE = "https://api.inworld.ai"

def _headers() -> dict:
    key = os.environ["INWORLD_API_KEY"]
    return {"Authorization": f"Basic {key}", "Content-Type": "application/json"}

def synthesize(
    text: str,
    voice_id: str,
    *,
    model_id: str = "inworld-tts-2",
    audio_encoding: str = "MP3",
    sample_rate: int = 48000,
    speaking_rate: float = 1.0,
    delivery_mode: str | None = None,
) -> bytes:
    body: dict = {
        "text": text,
        "voiceId": voice_id,
        "modelId": model_id,
        "audioConfig": {
            "audioEncoding": audio_encoding,
            "sampleRateHertz": sample_rate,
            "speakingRate": speaking_rate,
        },
    }
    if delivery_mode and model_id == "inworld-tts-2":
        body["deliveryMode"] = delivery_mode
    r = httpx.post(f"{INWORLD_API_BASE}/tts/v1/voice", json=body, headers=_headers(), timeout=60)
    r.raise_for_status()
    return base64.b64decode(r.json()["audioContent"])
```

For FastAPI, add a `/tts` route that returns `Response(content=synthesize(...), media_type="audio/mpeg")`.

## Step 4 — Env vars

Add `INWORLD_API_KEY=` (empty) to `.env.example`. Do not write the real key.
Add `.env` to `.gitignore` if it isn't there.

Make sure the app actually loads `.env`. Next.js, Vite and Remix do this themselves.
Plain Node does not: add `--env-file-if-exists=.env` to the start script (Node 22.9+),
or use `dotenv` on older Node. Python: `python-dotenv`, or the framework's own loader.
Don't tell the user to "put the key in `.env`" unless something reads it.

## Step 5 — Pick a voice

Skip this step for STT-only requests; use `add-transcription` or `add-streaming-stt` for feature selection.

Call `list_voices` and show 5 voices the user might like. Mention that TTS-2
voices respond to bracketed steering: `[whisper]`, `[say with rising excitement]`,
`[laugh]`, etc. If the user needs the lowest latency or cost, mention
`inworld-tts-2-flash`: same languages, ~20ms TTFB vs ~100ms, but no steering
instructions (non-verbal tags like `[laugh]` still work).

Additional text features to mention in the helper module's docstring:
- **Models**: `inworld-tts-2` (default; best quality, natural-language steering) or
  `inworld-tts-2-flash` (lowest latency and cost, for realtime agents and high volume;
  ignores steering instructions, though non-verbals like `[laugh]` still work).
- **Pauses**: SSML `<break time="500ms"/>` inline for explicit timing
- **Custom pronunciation**: replace one word with its English IPA in slashes, e.g.
  `a honeymoon in /kriːt/`, for proper nouns TTS would otherwise mispronounce
- **Verbatim**: `<verbatim>AHAA7771Z</verbatim>` spells out codes and IDs
- **Long text**: 2,000 character limit per call. For longer text, split at sentence
  boundaries client-side and concatenate the resulting audio (MP3 concatenation works;
  PCM/WAV needs header handling), or use Inworld's async synthesis (preview, up to
  100,000 characters as one background job)

If the user wants their own custom voices (instead of the public library):
- **Instant cloning**: the `clone_voice` MCP tool. Recommend 15–30 seconds of clean,
  single-speaker audio in the language the voice will speak; longer samples (up to
  the 30-second limit) give better similarity.
- **Voice design**: `design_voice` generates previews from a text description, then
  `publish_voice` keeps the one they pick.
- **Professional cloning (beta)**: for a production voice that must closely match a
  real speaker, recommend Professional Voice Cloning: at least 10 minutes of clean
  audio (up to 50 samples), fully supported in English, trained in the Inworld
  Portal (TTS Playground → Create Voice → Professional Clone) or with the PVC API.
  Voice slots and training rate depend on their plan.

For every STT request, use `add-transcription` for recordings or
`add-streaming-stt` for live audio. They select vocabulary, timestamps, diarization,
Voice Profile and turn behavior from the app's needs. Use `benchmark-stt` for
representative accuracy, critical-name/number, latency and cost evaluation; do not
assume one clean generated clip proves real-world recognition quality.

## Step 6 — Prove it works

For TTS requests, use `synthesize_speech` to generate a 3-second test clip (e.g. "Hello from Inworld.")
into a temp file. Tell the user the path. If they asked for STT, offer to
transcribe an audio file they provide.

## Step 7 — Summarize

Tell the user:
1. What file(s) you created.
2. The voice they picked (TTS), or transcription mode and enabled features (STT).
3. One next step (e.g. "import `synthesize` from `./lib/inworld` in your chat handler").
