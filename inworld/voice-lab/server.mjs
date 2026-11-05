#!/usr/bin/env node
// Inworld voice lab: a small stdio MCP server for the part of building a voice
// app that happens by ear. find_voices searches the catalog from a description,
// design_voice creates one when nothing fits, compare_voices renders the same
// line in several voices, check_speech_text fixes text before synthesis, and
// measure_latency times streaming TTS from this machine.
// Image/video tools share the lab lifecycle, credentials and private file policy.
//
// Clips are listed as "A: <id> → <file.mp3>" with a private invocation manifest.
// Hosts advertising MCP Apps may render a player; other hosts receive file paths.
//
// Dependency-free on purpose: newline-delimited JSON-RPC over stdio, Node 20+.
import { mkdtemp, chmod, realpath, readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { fetchWithPolicy, withRequestSignal, clientSource } from "./http.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginDisplayName, pluginVersion, credentialGuidance } from "../scripts/client-info.mjs";
import { checkSpeechText } from "./speech-text.mjs";
import { withNextSteps } from "./next-steps.mjs";
import { RequestFailure, responseFailure, withRecovery, recoveryFor } from "./recovery.mjs";

import { auditionJobs, reasoningFields } from "./tts-reasoning.mjs";
import { audioEmbed } from "./playback.mjs";

const UI_URI = "ui://inworld/voice-compare";
const UI_MIME = "text/html;profile=mcp-app";
const UI_EXTENSION = "io.modelcontextprotocol/ui";
const API_BASE = (process.env.INWORLD_API_BASE || "https://api.inworld.ai").replace(/\/+$/, "");
const HERE = dirname(fileURLToPath(import.meta.url));
const LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];

let hostSupportsUi = false;

// The embedded runtime selects its explicit credential; standalone compatibility
// accepts only its original input. Neither mode discovers credentials.
let credentialName = 'INWORLD_PLUGIN_API_KEY';
export function useUnifiedCredential() { credentialName = 'INWORLD_API_KEY'; }
async function apiKey() {
  return process.env[credentialName]?.trim() || "";
}

// Per-request ownership is carried across asynchronous synthesis and benchmarks.
const invocation = new AsyncLocalStorage();
const requests = new Map();
const clipDirectories = new Set();

const MODEL_NOTE = "inworld-tts-2 (default; supports steering tags) or inworld-tts-2-flash (no steering).";
const CATEGORIES = ["companions", "enterprise", "education_training", "developer_assistants", "healthcare", "interactive_media"];

const TOOLS = [
  {
    name: "find_voices",
    title: "Find Inworld voices from a description",
    description:
      "Search Inworld's voice library from what the user is looking for (\"calm older British man for a meditation app\", " +
      "\"upbeat young support agent\"). Translate the description into the structured filters (gender, age_group, " +
      "language, categories) and pass the rest as `query`, which ranks voices by their tags and descriptions. Returns " +
      "the best matches with descriptions. Pass `audition_line` to also render the top matches speaking that line so " +
      "the user can listen right away. If nothing fits, use design_voice with the same description.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the voice should sound like, in the user's words (tone, timbre, accent, use case)." },
        gender: { type: "string", enum: ["male", "female", "neutral"] },
        age_group: { type: "string", enum: ["young", "middle_aged", "elderly"] },
        language: { type: "string", description: "Locale or language, e.g. en-US, en-GB, es, ja." },
        categories: { type: "array", items: { type: "string", enum: CATEGORIES } },
        include_own: { type: "boolean", description: "Include the workspace's own cloned and designed voices (default true)." },
        include_community: { type: "boolean", description: "Include community voices shared by other workspaces (default false)." },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Number of matches to return (default 8)." },
        audition_line: { type: "string", description: "Optional line (ideally from the user's app) to render in the top matches (up to 4)." },
        model_id: { type: "string", description: MODEL_NOTE },
      },
    },
  },
  {
    name: "compare_voices",
    title: "Compare Inworld voices",
    description:
      "Render the same line in 2–4 voices (labelled A, B, C, D) so the user can listen and pick one. Voices can be " +
      "library voice IDs (`voices`) or one-off voice descriptions (`designs`, rendered with ad-hoc voice design, " +
      "inworld-tts-2 only, nothing saved). Use available host playback; in MCP Apps hosts a " +
      "player card; otherwise it returns MP3 paths. In Codex, present returned playbackMarkdown as media embeds " +
      "in the final answer (not code blocks) for inline Play controls. Else offer clickable local file links and prefer the host's " +
      "native audio-file preview when available; use an OS audio player on request as a fallback. Use when the " +
      "user wants to hear, audition, or choose between voices.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Line to speak, ideally from the user's own app. Max 500 characters." },
        voices: {
          type: "array",
          items: { type: "string" },
          maxItems: 4,
          description: "Inworld voice IDs, case-sensitive (e.g. Ashley, Dennis, Clive). Defaults to Ashley, Dennis, Clive when no designs are given.",
        },
        designs: {
          type: "array",
          items: { type: "string" },
          maxItems: 4,
          description: "Voice descriptions to try without saving, e.g. \"a warm, raspy grandmother with a slight Irish lilt\" (7–1024 characters each).",
        },
        model_id: { type: "string", description: MODEL_NOTE },
        delivery_mode: { type: "string", enum: ["STABLE", "BALANCED", "CREATIVE"], description: "inworld-tts-2 only. STABLE = consistent, CREATIVE = more emotional range. Default BALANCED." },
        reasoning: { type: "string", enum: ["default", "on"], description: "TTS Reasoning: on requests a generated delivery instruction on inworld-tts-2 (defaults delivery to CREATIVE unless explicitly set). Omit/default leaves the field unset; the public API documents unspecified as not running Reasoning. There is no explicit OFF enum. Report returned instructions and availability errors without assuming execution." },
        reasoning_context: { type: "string", maxLength: 600, description: "Optional scene/character notes, never spoken. Requires reasoning=on or compare_reasoning. At most 600 characters." },
        compare_reasoning: { type: "boolean", description: "Render workspace-default versus Reasoning requested for each of at most two voices (four clips max), keeping text/model/voice/delivery fixed. Defaults delivery to CREATIVE in both conditions. The default condition leaves Reasoning unset; the public API documents unspecified as not running Reasoning. Returns applied instructions and request durations; no automatic quality winner." },
      },
      required: ["text"],
    },
    _meta: { ui: { resourceUri: UI_URI }, "ui/resourceUri": UI_URI },
  },
  {
    name: "design_voice",
    title: "Design a new Inworld voice",
    description:
      "Create a new voice from a description when no library voice fits. Returns up to 3 preview voices (A, B, C) " +
      "speaking `script`, with MP3 files and playback where supported. Previews are drafts: after the user picks one, call " +
      "publish_voice to save it to their library and get a voiceId for their code. A good description covers gender " +
      "and age, accent, pitch and pace, tone, and timbre; write the script in the character's own words, since it " +
      "shapes the voice.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "English description of the voice, 30–1000 characters." },
        script: { type: "string", description: "What the previews say, in character; 1–30 s of audio (~50–400 characters)." },
        language: { type: "string", description: "Locale; the accent is part of it (en-GB for British, en-AU for Australian). Default: auto-detect." },
        samples: { type: "integer", minimum: 1, maximum: 3, description: "Number of previews (default 3)." },
        structured: { type: "boolean", description: "true if `description` is already a structured profile of `key: value` lines (dialect, gender, age, emotion, tone, pitch, volume, speed, clarity, fluency, personality, texture, environment), used as-is." },
      },
      required: ["description", "script"],
    },
  },
  {
    name: "publish_voice",
    title: "Save a designed voice",
    description: "Publish a design_voice preview to the user's voice library so its voiceId works in synthesis. Only after the user has picked it.",
    inputSchema: {
      type: "object",
      properties: {
        voice_id: { type: "string", description: "The preview's voice ID from design_voice." },
        display_name: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" }, description: "Style and use-case tags (e.g. warm, narrator). Not gender or age." },
      },
      required: ["voice_id", "display_name"],
    },
  },
  {
    name: "check_speech_text",
    title: "Check text before speaking it",
    description:
      "Check text that will be sent to Inworld TTS (a prompt template, an LLM reply, UI copy) and return a fixed copy: " +
      "wraps booking references, order numbers, plates and other alphanumeric IDs in <verbatim> so they are spelled " +
      "out, strips markdown and emoji, and flags steering tags the chosen model ignores, steering that runs on longer " +
      "than intended, invalid <break> tags, unsupported SSML, multi-word IPA, and ambiguous dates. Works without an " +
      "API key. Pass `listen_voice` to render the original and fixed text as A and B so the user can hear the difference.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        model_id: { type: "string", description: MODEL_NOTE },
        text_normalization: { type: "string", enum: ["default", "on", "off"], description: "The applyTextNormalization setting the app uses (default unset)." },
        listen_voice: { type: "string", description: "Optional voice ID: render original (A) and fixed (B) for an A/B listen." },
      },
      required: ["text"],
    },
  },
  {
    name: "measure_latency",
    title: "Measure TTS latency from here",
    description:
      "Measure streaming TTS over HTTP POST /tts/v1/voice:stream from this machine using performance.now(): " +
      "request start to the first parsed record with decoded audio bytes, and request start to validated EOF. " +
      "Includes local request scheduling, network and parsing time; does not measure audible playback. " +
      "Compare HTTP and WebSocket under the app's actual workload separately; this tool measures HTTP only. " +
      "Current model information: https://inworld.ai/models.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "A typical first sentence the app speaks (default: a short greeting)." },
        voice: { type: "string", description: "Voice ID (default Ashley)." },
        models: { type: "array", items: { type: "string" }, description: "Default [inworld-tts-2-flash, inworld-tts-2]." },
        runs: { type: "integer", minimum: 1, maximum: 10, description: "Timed runs per configuration after one warm-up (default 5)." },
        compare_normalization: { type: "boolean", description: "Also time each model with applyTextNormalization OFF." },
      },
    },
  },

];

const noKeyError = () => withRecovery({ content: [{ type: "text", text:
  credentialGuidance(process.env.INWORLD_CLIENT_SOURCE, credentialName) }] }, new RequestFailure("Missing configured credential", { status: 401, dispatched: false }));

async function api(path, key, { method = "GET", body, query } = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, v);
  const res = await fetchWithPolicy(url, {
    method,
    headers: { Authorization: `Basic ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw responseFailure(res, method, `Inworld ${method} ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const audioConfig = { audioEncoding: "MP3", sampleRateHertz: 24000, bitRate: 64000 };

async function synthesizeDetailed(key, { text, voiceId, design, modelId, deliveryMode, reasoning, reasoningContext }) {
  const body = { text, modelId, audioConfig, ...reasoningFields({modelId, reasoning, reasoningContext}) };
  if (design) body.voiceDesign = { designPrompt: design };
  else body.voiceId = voiceId;
  if (deliveryMode && !/flash/.test(modelId)) body.deliveryMode = deliveryMode;
  const start = performance.now();
  const response = await api("/tts/v1/voice", key, { method: "POST", body });
  if (typeof response.audioContent !== 'string' || Buffer.from(response.audioContent, 'base64').length === 0) {
    throw new Error('Synthesis returned no audio; no ready clip was saved');
  }
  return { audio: response.audioContent, requestDurationMs: Math.round(performance.now() - start),
    reasoningInstruction: response.reasoningInstruction ?? response.autoSteerInstruction ?? null,
    usage: response.usage ?? null };
}
async function synthesize(key, opts) { return (await synthesizeDetailed(key, opts)).audio; }

async function newClipDir() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "inworld-voice-lab-")));
  await chmod(dir, 0o700);
  clipDirectories.add(dir);
  return dir;
}

const safeName = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60);

async function saveClip(dir, label, id, audio) {
  if (!clipDirectories.has(dir) || !LABELS.includes(label)) throw new Error('Unowned clip path');
  const file = join(dir, `voice-${label}-${safeName(id)}.mp3`);
  await writeFile(file, Buffer.from(audio, "base64"), { flag: "wx", mode: 0o600 });
  return file;
}

// Shared listening result; experimental hooks verify the manifest rather than text.
function listenResult(clips, intro, outro, extra = {}) {
  const lines = clips.map((c) => `${c.label}: ${c.id} → ${c.file}` +
    (c.condition ? `\n  Evidence: ${JSON.stringify({condition:c.condition,reasoningRequested:c.reasoningRequested,reasoningInstruction:c.reasoningInstruction,requestDurationMs:c.requestDurationMs,usage:c.usage})}` : '')).join("\n");
  const inlineAudio = clientSource() === "codex-plugin";
  const embeds = inlineAudio ? clips.map(c => audioEmbed(c.file, `${c.label}: ${c.id}${c.condition ? ` · ${c.condition}` : ""}`)).join("\n\n") : "";
  const how = inlineAudio
    ? "Present each playbackMarkdown media embed verbatim in the final answer, outside code blocks, so Codex can render an inline audio player. Do not replace embeds with ordinary file links. If no player renders, offer the native file preview. Do not claim the user listened until they confirm."
    : process.env.INWORLD_CLIENT_SOURCE === "openclaw-plugin"
    ? "Use OpenClaw native audio attachments for these saved files. In automatic visible-reply mode, put MEDIA: followed by each absolute file path on its own line in the final answer (quote paths containing spaces). These are final-answer instructions; tool output itself is not attachment delivery. If the session requires message_tool_only, use its structured attachment fields only when that destination is authorized. Do not message an external channel merely to preview a clip. Do not claim the user listened until they confirm."
    : hostSupportsUi
    ? "This host advertises MCP Apps; a player card is available if its renderer supports audio. The MP3 paths are also provided."
    : "MP3 files are ready. Offer clickable local file links so the user can open the host's native audio-file preview when available. File-preview playback does not require MCP Apps or an HTML artifact. If the host cannot preview the files, offer an available local audio player when the user requests playback.";
  const ctx = invocation.getStore();
  const selectionType = ctx?.tool === 'benchmark_models' ? 'model'
    : ctx?.tool === 'check_speech_text' ? 'text' : 'voice';
  let playbackManifest;
  if (ctx && clips.length) {
    const dir = dirname(clips[0].file);
    if (!clipDirectories.has(dir) || clips.some(c => dirname(c.file) !== dir)) throw new Error('Unowned playback manifest');
    playbackManifest = join(dir, 'manifest.json');
    const manifest = { version: 1, invocationId: ctx.invocationId, tool: ctx.tool, selectionType,
      clips: clips.map(c => ({ label: c.label, voiceId: c.id, file: c.file,
        sha256: createHash('sha256').update(Buffer.from(c.audio, 'base64')).digest('hex') })) };
    writeFileSync(playbackManifest, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  }
  return {
    content: [{ type: "text", text: `${intro} ${how}\n${lines}${embeds ? `\n\n${embeds}` : ""}\n${outro}` }],
    // Audio only goes into structuredContent for hosts that render the card, so
    // text-only hosts never put base64 audio into the model's context.
    structuredContent: {
      ...extra,
      selectionType, playbackManifest, invocationId: ctx?.invocationId,
      clips: clips.map(({ label, id, file, audio, note, ...metadata }) =>
        hostSupportsUi
          ? { ...metadata, label, voiceId: id, file, note, mimeType: "audio/mpeg", audio, ...(inlineAudio ? { playbackMarkdown: audioEmbed(file, `${label}: ${id}${metadata.condition ? ` · ${metadata.condition}` : ""}`) } : {}) }
          : { ...metadata, label, voiceId: id, file, note, ...(inlineAudio ? { playbackMarkdown: audioEmbed(file, `${label}: ${id}${metadata.condition ? ` · ${metadata.condition}` : ""}`) } : {}) }),
    },
  };
}

async function compareVoices(args, key) {
  const text = String(args.text ?? "").trim().slice(0, 500);
  if (!text) return { isError: true, content: [{ type: "text", text: "compare_voices needs some text to speak." }] };
  const designs = (Array.isArray(args.designs) ? args.designs : []).map((d) => String(d).trim()).filter(Boolean);
  let voices = Array.isArray(args.voices) ? args.voices.filter(Boolean) : [];
  if (!voices.length && !designs.length) voices = args.compare_reasoning ? ["Ashley"] : ["Ashley", "Dennis", "Clive"];
  const modelId = args.model_id || "inworld-tts-2";
  if (designs.length && /flash/.test(modelId)) {
    return { isError: true, content: [{ type: "text", text: "Voice descriptions (designs) need inworld-tts-2; Flash doesn't support ad-hoc voice design." }] };
  }
  const jobs = auditionJobs({voices, designs, compareReasoning:args.compare_reasoning,
    reasoning:args.reasoning, reasoningContext:args.reasoning_context, modelId});
  const deliveryMode = args.delivery_mode ?? (args.compare_reasoning || args.reasoning === 'on' ? 'CREATIVE' : undefined);

  const evidence = { text, model: modelId, ...(args.compare_reasoning || args.reasoning ? {
      deliveryMode: deliveryMode ?? 'workspace-default',
      comparison: args.compare_reasoning ? 'workspace-default versus reasoning-requested' : null,
      reasoningCaveat: 'Default is not guaranteed off. Missing instruction can mean abstention, unavailable feature or fallback; it does not prove Reasoning ran. Request duration includes network and complete synthesis, not TTFA or audible latency. Human listening is required for quality preference. Usage is raw; no price is inferred.',
    } : {}) };
  const dir = await newClipDir();
  const outcomes = await Promise.allSettled(
    jobs.map(async (job, i) => {
      const label = LABELS[i];
      const id = job.voiceId ?? `design-${label}`;
      const rendered = await synthesizeDetailed(key, { text, ...job, modelId, deliveryMode });
      return { label, id, ...rendered, file: await saveClip(dir, label, id, rendered.audio),
        designDescription: job.design,
        note: job.condition ? `${job.condition}; ${rendered.reasoningInstruction ? 'generated instruction returned' : 'no generated instruction returned'}` : job.design,
        ...(job.reasoning ? {condition:job.condition ?? job.reasoning, reasoningRequested:job.reasoning === 'on'} : {}) };
    }),
  );
  const clips = outcomes.filter(r => r.status === 'fulfilled').map(r => r.value);
  const failures = outcomes.flatMap((r, i) => r.status === 'rejected'
    ? [{ label: LABELS[i], recovery: recoveryFor(r.reason) }] : []);
  if (failures.length) {
    const first = outcomes.find(r => r.status === 'rejected').reason;
    const partial = clips.length
      ? listenResult(clips, `Audition incomplete: ${clips.length} of ${jobs.length} clips were saved.`, 'Keep the saved clips. Do not regenerate the whole batch automatically.', { ...evidence, complete: false, failures })
      : { content: [{ type: 'text', text: 'Audition failed; no clips were saved. No automatic retry was made.' }], structuredContent: { ...evidence, complete: false, clips: [], failures } };
    return withRecovery(partial, first, { tool: 'compare_voices', args });
  }
  const designNotes = clips.filter((c) => c.designDescription).map((c) => `${c.id} = "${c.designDescription}"`).join("; ");
  return listenResult(
    clips,
    `Rendered "${text}" in ${clips.length} clips with ${modelId}.`,
    (args.compare_reasoning ? "Ask which delivery they prefer; no quality winner is inferred from generation or request duration. " : "Ask which one they prefer. If they pick a library voice, use that voiceId in their project. ") +
      (designNotes
        ? ` Designed voices (${designNotes}) are one-offs: to keep one, run design_voice with that description and publish the preview they like.`
        : ""),
    evidence,
  );
}

const STOP = new Set("a an and the with for of to in on voice voices sounding sounds like that who is very bit slightly".split(" "));

async function findVoices(args, key) {
  const filters = [];
  if (args.gender) filters.push(`gender="${args.gender}"`);
  if (args.age_group) filters.push(`age_group="${args.age_group}"`);
  if (args.language) filters.push(`lang_code="${String(args.language).replace(/"/g, "")}"`);
  for (const c of args.categories ?? []) filters.push(`categories:"${c}"`);
  if (args.include_own === false) filters.push(`owned="false"`);
  if (args.include_community) filters.push(`community="true"`);

  let voices, fallback = false;
  const unverified = [];
  try {
    ({ voices = [] } = await api("/voices/v1/voices", key, {
      query: { filter: filters.join(" AND "), pageSize: "2000" },
    }));
  } catch (e) {
    // Keys without the Voices API scope (403) still reach the older TTS list,
    // which only filters by broad language. Verify required attributes from
    // structured metadata; descriptions and tags cannot establish exact matches.
    if (!/→ 403/.test(e.message)) throw e;
    fallback = true;
    const requestedLanguage = args.language ? String(args.language).toLowerCase() : '';
    const lang = requestedLanguage.split('-')[0];
    ({ voices = [] } = await api("/tts/v1/voices", key, { query: { filter: lang ? `language=${lang}` : "" } }));
    voices = voices.flatMap(v => {
      const unknown = [];
      let mismatch = false;
      const check = (name, required, actual, matches) => {
        if (!required) return;
        if (actual === undefined) unknown.push(name);
        else if (!matches(actual)) mismatch = true;
      };
      const languages = v.languages?.length ? v.languages : v.languageCode ? [v.languageCode] : undefined;
      if (requestedLanguage) {
        const codes = languages?.map(code => String(code).toLowerCase());
        const matches = codes?.some(code => code === requestedLanguage ||
          (requestedLanguage === lang && code.split('-')[0] === lang));
        if (!matches) {
          // A base-only declaration cannot establish a requested locale, but
          // remains useful as an explicitly unverified candidate.
          if (!codes || (requestedLanguage !== lang && codes.includes(lang))) unknown.push('language');
          else mismatch = true;
        }
      }
      check('categories', args.categories?.length, Array.isArray(v.categories) ? v.categories : undefined,
        values => args.categories.every(c => values.includes(c)));
      check('gender', args.gender, v.gender, value => value === args.gender);
      check('age_group', args.age_group, v.ageGroup, value => value === args.age_group);
      check('include_own', args.include_own === false, typeof v.isCustom === 'boolean' ? v.isCustom : undefined, value => !value);
      check('include_community', args.include_community, typeof v.isCommunity === 'boolean' ? v.isCommunity : undefined, value => value);
      if (mismatch) return [];
      const mapped = {...v, owned:v.isCustom, languageCode:languages?.[0]};
      if (unknown.length) {
        unverified.push({...mapped, unverified_constraints:unknown});
        return [];
      }
      return [mapped];
    });
  }

  const words = String(args.query ?? "").toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const scored = voices.map((v) => {
    const tagWords = (v.tags ?? []).flatMap((t) => t.toLowerCase().split(/[^a-z0-9-]+/));
    const descWords = `${v.displayName ?? ""} ${v.description ?? ""}`.toLowerCase().split(/[^a-z0-9-]+/);
    let score = 0;
    for (const w of words) {
      // Loose stem so narrator ~ narration, calm ~ calming, energetic ~ energy.
      const stem = w.slice(0, Math.max(4, w.length - 3));
      if (tagWords.some((t) => t.startsWith(stem))) score += 3;
      else if (descWords.some((t) => t.startsWith(stem))) score += 2;
    }
    if (v.owned && score > 0) score += 0.5; // prefer their own voices among real matches
    return { v, score };
  });
  scored.sort((a, b) => b.score - a.score || String(a.v.displayName).localeCompare(String(b.v.displayName)));
  const limit = Math.min(Math.max(args.limit ?? 8, 1), 20);
  const top = scored.slice(0, limit);

  const rows = top.map(({ v }) => {
    const meta = [v.gender, v.ageGroup?.replace("_", " "), v.languageCode, v.source !== "SYSTEM" ? v.source : ""].filter(Boolean).join(", ");
    const tags = v.tags?.length ? ` [${v.tags.join(", ")}]` : "";
    return `- ${v.voiceId}${v.displayName && v.displayName !== v.voiceId ? ` (${v.displayName})` : ""} — ${meta}${tags}${v.description ? `: ${v.description}` : ""}`;
  });
  const header =
    `${voices.length} voices match ${fallback ? 'the verified filters' : 'the filters'}${filters.length ? ` (${filters.join(" AND ")})` : ""}` +
    (words.length ? `; ranked by "${words.join(" ")}"` : "") + ".";
  let tail = top.length && top[0].score === 0 && words.length
    ? "\nNo voice's tags or description matched the query words, so these are only filter matches. Offer design_voice with the user's description."
    : "\nIf none of these fit, design_voice can create one from the same description.";
  if (fallback) tail += '\nLegacy catalog fallback: only candidates with verified required metadata are eligible for automatic audition.';
  const unverifiedMatches = unverified.slice(0, limit).map(v => ({voiceId:v.voiceId,
    displayName:v.displayName, description:v.description, languageCode:v.languageCode,
    unverified_constraints:v.unverified_constraints}));
  if (unverifiedMatches.length) tail += '\nUnverified candidates (not filter matches; not auditioned):\n' +
    unverifiedMatches.map(v => `- ${v.voiceId}: unverified ${v.unverified_constraints.join(', ')}${v.description ? ` — ${v.description}` : ''}`).join('\n');

  const search = {
    ...(fallback ? {unverified_matches:unverifiedMatches} : {}),
    has_description_query: words.length > 0,
    match_quality: !top.length ? "none" : words.length && top[0].score === 0 ? "filter-only" : words.length ? "description-ranked" : "filter-only",
    matches: top.map(({ v, score }) => ({
      voiceId: v.voiceId, displayName: v.displayName, gender: v.gender, ageGroup: v.ageGroup,
      languageCode: v.languageCode, tags: v.tags, description: v.description, score,
    })),
  };
  if (!args.audition_line || !top.length) {
    return { content: [{ type: "text", text: `${header}\n${rows.join("\n")}${tail}` }], structuredContent: search };
  }
  const audition = await compareVoices(
    { text: args.audition_line, voices: top.slice(0, 4).map(({ v }) => v.voiceId), model_id: args.model_id },
    key,
  );
  if (audition.isError) return audition;
  audition.content[0].text = `${header}\n${rows.join("\n")}${tail}\n\nAudition of the top ${Math.min(4, top.length)}:\n${audition.content[0].text}`;
  // Some hosts give the model structuredContent instead of the text, so the
  // matches go there too.
  Object.assign(audition.structuredContent, search);
  return audition;
}

async function designVoice(args, key) {
  const description = String(args.description ?? "").trim();
  const script = String(args.script ?? "").trim();
  if (description.length < 7 || !script) {
    return { isError: true, content: [{ type: "text", text: "design_voice needs a description (ideally 30+ characters: gender, age, accent, pitch, pace, tone, timbre) and a script." }] };
  }
  const body = {
    designPrompt: description.slice(0, 1000),
    previewText: script,
    voiceDesignConfig: { numberOfSamples: Math.min(Math.max(args.samples ?? 3, 1), 3) },
  };
  if (args.language) body.languageCode = args.language;
  if (args.structured) body.designPromptMode = "DESIGN_PROMPT_MODE_VERBATIM";
  let previewVoices;
  try {
    ({ previewVoices = [] } = await api("/voices/v1/voices:design", key, { method: "POST", body }));
  } catch (e) {
    if (!/→ 403/.test(e.message) || args.structured) throw e;
    return designAdHoc(args, description, script, body.voiceDesignConfig.numberOfSamples, key);
  }
  if (!previewVoices.length) return { isError: true, content: [{ type: "text", text: "Voice design returned no previews; try a more specific description." }] };

  const dir = await newClipDir();
  const outcomes = await Promise.allSettled(
    previewVoices.slice(0, 3).map(async (p, i) => {
      if (typeof p.previewAudio !== 'string' || !Buffer.from(p.previewAudio, 'base64').length) throw new Error('Design preview returned no audio');
      return {
        label: LABELS[i],
        id: p.voiceId,
        audio: p.previewAudio,
        file: await saveClip(dir, LABELS[i], p.voiceId, p.previewAudio),
      };
    }),
  );
  return designResult(outcomes,
    `Designed preview voices from "${description.slice(0, 120)}${description.length > 120 ? "…" : ""}".`,
    "These are drafts. Ask which one they want, then call publish_voice with its ID and a name. If none are " +
      "right, adjust the description (age, accent, pitch, pace, tone, timbre) or the script and design again.",
    { description, script }, args,
  );
}

const writeFix = () =>
  "Enable Voice API write permission for the selected Inworld key at https://platform.inworld.ai/api-keys. " +
  `If using a replacement key, configure ${credentialName} through this host's approved secret settings ` +
  "for Inworld, then restart that connection/session. Selecting a CLI key does not configure this connection. " +
  "Keep the key out of chat and command arguments.";

// Keys without Voice API write permission can't create draft voices, but ad-hoc
// voice design on the TTS endpoint still lets the user hear candidates.
async function designAdHoc(args, description, script, samples, key) {
  const dir = await newClipDir();
  const outcomes = await Promise.allSettled(
    LABELS.slice(0, samples).map(async (label) => {
      const id = `design-${label}`;
      const audio = await synthesize(key, { text: script, design: description, modelId: "inworld-tts-2" });
      return { label, id, audio, file: await saveClip(dir, label, id, audio) };
    }),
  );
  return designResult(outcomes,
    "This API key can't save voices, so previews were rendered with ad-hoc voice design " +
      "(listen-only; each one is a fresh take on the description).",
    `To save the one the user likes, they need a key with Voice API write permission. ${writeFix()} Then run ` +
      "design_voice again and publish the preview they pick.",
    { description, script, saved: false }, args,
  );
}

function designResult(outcomes, intro, outro, extra, args) {
  const clips = outcomes.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
  const failures = outcomes.flatMap((r, i) => r.status === 'rejected'
    ? [{label:LABELS[i], error:String(r.reason?.message ?? r.reason), recovery:recoveryFor(r.reason)}] : []);
  const evidence = {...extra, complete:failures.length === 0, failures};
  const result = clips.length ? listenResult(clips,
    `${intro} ${clips.length} of ${outcomes.length} previews saved.`,
    `${failures.length ? 'Keep the saved previews. Do not regenerate the whole batch automatically. ' : ''}${outro}`, evidence)
    : {content:[{type:'text', text:'Voice design failed; no previews were saved. No automatic retry was made.'}],
      structuredContent:{...evidence, clips:[]}};
  return failures.length ? withRecovery(result, outcomes.find(r => r.status === 'rejected').reason, {tool:'design_voice', args}) : result;
}

async function publishVoice(args, key) {
  const id = String(args.voice_id ?? "").trim();
  const body = { displayName: args.display_name };
  if (args.description) body.description = args.description;
  if (args.tags?.length) body.tags = args.tags;
  let v;
  try {
    v = await api(`/voices/v1/voices/${encodeURIComponent(id)}:publish`, key, { method: "POST", body });
  } catch (e) {
    if (/→ 403/.test(e.message)) return { isError: true, content: [{ type: "text", text: `This API key can't save voices. ${writeFix()}` }] };
    throw e;
  }
  return {
    content: [{
      type: "text",
      text: `Saved "${v.displayName ?? args.display_name}" to the voice library. Use voiceId ${v.voiceId ?? id} in the project's TTS calls (keep it in config, not hard-coded in several places).`,
    }],
    structuredContent: v,
  };
}

async function checkText(args) {
  const model = args.model_id || "inworld-tts-2";
  const r = checkSpeechText(args.text, { model, normalization: args.text_normalization ?? "default" });
  const issues = r.issues.length
    ? r.issues.map((i) => `- ${i.severity.toUpperCase()} ${i.rule}: ${i.message}`).join("\n")
    : "- No problems found.";
  const report = `${issues}\n\n${r.changed ? `Fixed text:\n${r.text}` : "Text is unchanged."}`;
  const hint =
    "\n\nIf this text comes from an LLM, fix it at the source: tell the LLM to answer in plain spoken sentences " +
    "(no markdown or emoji) and to wrap IDs, codes and reference numbers in <verbatim></verbatim>.";

  if (!args.listen_voice || !r.changed) return { content: [{ type: "text", text: report + hint }], structuredContent: r };
  const key = await apiKey();
  if (!key) {
    const blocked = noKeyError();
    return { ...blocked, content: [{ type: 'text', text: report + hint }, ...blocked.content],
      structuredContent: { ...r, complete: false, clips: [], ...blocked.structuredContent } };
  }
  const voiceId = args.listen_voice;
  const dir = await newClipDir();
  const versions = [
    { label: "A", id: "original", text: String(args.text).slice(0, 500) },
    { label: "B", id: "fixed", text: r.text.slice(0, 500) },
  ];
  const outcomes = await Promise.allSettled(
    versions.map(async (c) => {
      const audio = await synthesize(key, { text: c.text, voiceId, modelId: model });
      return { ...c, audio, file: await saveClip(dir, c.label, `${c.id}-${voiceId}`, audio) };
    }),
  );
  const clips = outcomes.flatMap(o => o.status === 'fulfilled' ? [o.value] : []);
  const failures = outcomes.flatMap((o, i) => o.status === 'rejected'
    ? [{ label: versions[i].label, error: String(o.reason?.message ?? o.reason), recovery: recoveryFor(o.reason) }] : []);
  const evidence = { ...r, complete: failures.length === 0, failures };
  if (!failures.length) return listenResult(clips, `${report}\n\nRendered both versions in ${voiceId}.`,
    "Ask whether the fixed version sounds right." + hint, evidence);
  const intro = `${report}\n\nAudition incomplete: ${clips.length} of ${versions.length} clips were saved. ` +
    'Keep the saved clips. Do not regenerate the whole batch automatically.';
  const partial = clips.length ? listenResult(clips, intro, hint, evidence)
    : { content: [{ type: 'text', text: intro + hint }], structuredContent: { ...evidence, clips: [] } };
  return withRecovery(partial, outcomes.find(o => o.status === 'rejected').reason, { tool: 'check_speech_text', args });
}

function pct(sorted, p) {
  if (!sorted.length) return NaN;
  if (p === 50) {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export async function timeOnce(key, body) {
  const t0 = performance.now();
  let first = null;
  try {
    const res = await fetchWithPolicy(`${API_BASE}/tts/v1/voice:stream`, {
      method: "POST",
      headers: { Authorization: `Basic ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw responseFailure(res, 'POST', `stream ${res.status} ${(await res.text()).slice(0, 200)}`);
    let buf = "";
    const decoder = new TextDecoder();
    function record(line) {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      const status = msg.result?.status;
      if (msg.error || (status?.code != null && Number(status.code) !== 0))
        throw new Error(JSON.stringify(msg.error ?? status).slice(0, 200));
      const encoded = msg.result?.audioContent;
      if (encoded != null && encoded !== "") {
        // A truthy string (or Buffer.from alone) does not establish audio bytes.
        if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
            encoded.length % 4 === 1 || (encoded.includes("=") && encoded.length % 4 !== 0))
          throw new Error('Stream returned invalid base64 audioContent');
        const bytes = Buffer.from(encoded, 'base64');
        if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, ''))
          throw new Error('Stream returned invalid or empty decoded audioContent');
        if (first === null) first = performance.now() - t0;
      }
    }
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) { record(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
    }
    buf += decoder.decode();
    record(buf);
    if (first === null) throw new Error('Stream completed without audio');
    return { first, total: performance.now() - t0, complete: true };
  } catch (e) {
    return { first, total: null, complete: false, error: String(e.message ?? e) };
  }
}

async function measureLatency(args, key) {
  const text = String(args.text || "Hi there! Thanks for calling. How can I help you today?").slice(0, 500);
  const voiceId = args.voice || "Ashley";
  const models = args.models?.length ? args.models : ["inworld-tts-2-flash", "inworld-tts-2"];
  const runs = Math.min(Math.max(args.runs ?? 5, 1), 10);
  const configs = models.flatMap((modelId) => [
    { modelId, norm: "default" },
    ...(args.compare_normalization ? [{ modelId, norm: "OFF" }] : []),
  ]);

  const rows = [];
  for (const c of configs) {
    const body = { text, voiceId, modelId: c.modelId, audioConfig: { audioEncoding: "PCM", sampleRateHertz: 24000 } };
    if (c.norm === "OFF") body.applyTextNormalization = "OFF";
    const warmup = await timeOnce(key, body);
    const samples = [];
    for (let i = 0; i < runs; i++) samples.push(await timeOnce(key, body));
    const valid = samples.filter(s => s.complete);
    const first = valid.map(s => s.first).sort((a, b) => a - b);
    const total = valid.map(s => s.total).sort((a, b) => a - b);
    rows.push({ ...c, runs, requested: runs, attempted: samples.length, succeeded: valid.length,
      failed: samples.length - valid.length, skipped: runs - samples.length, warmup, samples,
      firstValid: first.length, totalValid: total.length,
      firstP50: first.length ? pct(first, 50) : null, firstP90: first.length ? pct(first, 90) : null,
      totalP50: total.length ? pct(total, 50) : null });
  }

  const ms = (n) => (Number.isFinite(n) ? `${Math.round(n)} ms` : "n/a");
  const table = [
    "| model | normalization | first audio p50 | first audio p90 | total p50 | valid / attempted |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) =>
      r.error
        ? `| ${r.modelId} | ${r.norm} | error: ${r.error} | | |`
        : `| ${r.modelId} | ${r.norm} | ${ms(r.firstP50)} | ${ms(r.firstP90)} | ${ms(r.totalP50)} | ${r.succeeded}/${r.attempted} |`),
  ].join("\n");
  return {
    content: [{
      type: "text",
      text:
        `Streaming TTS from this machine to ${API_BASE}, ${runs} runs each after a warm-up, voice ${voiceId}, ` +
        `${text.length} characters. P50 is the median (averaging the central pair for even counts); p90 uses nearest-rank. Only complete generations contribute to percentiles; first-audio diagnostics and errors for every attempt are retained in structured results.\n\n${table}\n\n` +
        "Measured transport: HTTP POST /tts/v1/voice:stream. Clock: performance.now() on this machine, " +
        "starting immediately before the request helper. First audio is the first parsed record with nonempty decoded audio bytes; " +
        "total is elapsed time through validated stream EOF. These durations include local request scheduling, " +
        "connection setup when needed, network and parsing time; audible playback is not measured. " +
        "Compare HTTP and WebSocket under the app's actual workload, including its connection reuse and input chunking. " +
        "This tool does not measure WebSocket. Current model information: https://inworld.ai/models.",
    }],
    structuredContent: { text, voiceId, apiBase: API_BASE,
      measurement: { transport: "HTTP POST /tts/v1/voice:stream", clock: "performance.now()",
        start: "Immediately before the request helper",
        firstAudio: "First parsed record with nonempty decoded audio bytes",
        total: "Validated stream EOF", includes: ["local request scheduling", "connection setup when needed", "network", "parsing"],
        playbackMeasured: false, warmupRequestsPerConfiguration: 1,
        p50Method: "median; average central pair for even counts", p90Method: "nearest-rank" },
      results: rows },
  };
}

const HANDLERS = {
  find_voices: findVoices, compare_voices: compareVoices, design_voice: designVoice,
  publish_voice: publishVoice, measure_latency: measureLatency,
};
// Optional areas extend this one lab only when explicitly requested.
const requestedAreas = [...new Set((process.env.INWORLD_LAB_AREAS || "voice").split(",").map(s => s.trim()).filter(Boolean))];
const { areas } = await import("./areas.mjs");
for (const name of requestedAreas) {
  if (name === "voice") continue;
  if (!Object.hasOwn(areas, name)) throw new Error(`Unavailable lab area: ${name}`);
  const area = (await areas[name]()).createArea({ apiBase: API_BASE, synthesize, newClipDir, saveClip, listenResult, labels: LABELS });
  for (const tool of area.tools) {
    if (TOOLS.some(existing => existing.name === tool.name)) throw new Error("Duplicate lab tool");
    TOOLS.push(tool);
  }
  Object.assign(HANDLERS, area.handlers);
}

// Treat provider diagnostics as untrusted: never echo the configured secret.
function redactCredential(value, key) {
  if (!key) return value;
  if (typeof value === "string") return value.split(key).join("[credential]");
  if (Array.isArray(value)) return value.map(item => redactCredential(item, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .map(([name, item]) => [redactCredential(name, key), redactCredential(item, key)]));
  return value;
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize": {
      const caps = params?.capabilities ?? {};
      hostSupportsUi = Boolean(caps.extensions?.[UI_EXTENSION] || caps.experimental?.[UI_EXTENSION]);
      return {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {}, resources: {}, extensions: { [UI_EXTENSION]: {} } },
        serverInfo: { name: "inworld-voice-lab", title: pluginDisplayName, version: pluginVersion },
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      let key;
      try {
        key = await apiKey();
        if (name === "check_speech_text") return redactCredential(withNextSteps(name, args, await checkText(args), { skillPrefix: process.env.INWORLD_SKILL_PREFIX }), key);
        const handler = HANDLERS[name];
        if (!handler) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
        if (!key) return noKeyError();
        return redactCredential(withNextSteps(name, args, await handler(args, key), { skillPrefix: process.env.INWORLD_SKILL_PREFIX }), key);
      } catch (e) {
        if (e.code === -32602) throw e;
        return redactCredential(withRecovery({ content: [{ type: "text", text: String(e?.message ?? e) }] }, e, { tool: name, args }), key);
      }
    }
    case "resources/list":
      return { resources: [{ uri: UI_URI, name: "voice_compare", title: "Voice comparison", mimeType: UI_MIME }] };
    case "resources/read":
      if (params?.uri === UI_URI) {
        const html = await readFile(join(HERE, "voice-compare.html"), "utf8");
        return { contents: [{ uri: UI_URI, mimeType: UI_MIME, text: html, _meta: { ui: { prefersBorder: true } } }] };
      }
      throw Object.assign(new Error(`Unknown resource: ${params?.uri}`), { code: -32002 });
    default:
      if (id === undefined) return undefined; // notification
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

// Embedded workflow dispatch shares the same cancellation and invocation policy
// as the standalone development transport. Importing this module opens no stdin.
export async function dispatchWorkflow(msg, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const ctx = { tool: msg.params?.name, invocationId: randomUUID() };
  try {
    return await withRequestSignal(controller.signal, () => invocation.run(ctx, () => handle(msg)));
  } finally { signal?.removeEventListener('abort', abort); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1])) {
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  if (Buffer.byteLength(buffer) > 1024 * 1024) {
    send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request exceeds 1 MiB" } });
    buffer = ""; return;
  }
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' ||
        typeof msg.method !== 'string' || (msg.id !== undefined && msg.id !== null && typeof msg.id !== 'string' && typeof msg.id !== 'number') ||
        (msg.params !== undefined && (!msg.params || typeof msg.params !== 'object' || Array.isArray(msg.params)))) {
      send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } }); continue;
    }
    if (msg.method === 'notifications/cancelled') {
      requests.get(msg.params?.requestId)?.abort(new Error('MCP request cancelled')); continue;
    }
    const controller = new AbortController();
    if (msg.id !== undefined) requests.set(msg.id, controller);
    const ctx = { tool: msg.params?.name, invocationId: randomUUID() };
    Promise.resolve(withRequestSignal(controller.signal, () => invocation.run(ctx, () => handle(msg)))).then(
      result => { if (msg.id !== undefined && result !== undefined) send({ jsonrpc: "2.0", id: msg.id, result }); },
      err => { if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: err.code ?? -32603, message: err.message } }); },
    ).finally(() => { if (requests.get(msg.id) === controller) requests.delete(msg.id); });
  }
});
process.stdin.on('end', () => { for (const c of requests.values()) c.abort(new Error('MCP input closed')); });

}
