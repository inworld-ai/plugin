import { fetchWithPolicy } from "./http.mjs";
import { responseFailure, recoveryFor } from './recovery.mjs';

// Model benchmarking through Inworld's router: one key reaches 100+ LLMs, so a
// developer can compare them on their own prompt and measure what a voice app
// actually feels like, time to the first spoken audio (LLM first sentence + TTS).

// From inworld.ai/models (the public catalog page), checked 2026-10-17. The
// router API has no labels or retirement dates, so these are curated here;
// Inworld-hosted models are detected from the `inworld` provider instead.
const CURATED_SOURCE = "https://inworld.ai/models";
const CURATED_REVIEWED_AT = "2026-10-17";
const curatedInfo = () => ({ source: CURATED_SOURCE, reviewed_at: CURATED_REVIEWED_AT,
  kind: "curated_snapshot", scope: "popularity labels and retirement dates; not live API labels" });
const curatedNote = `Popularity labels and retirement dates are a curated snapshot of ${CURATED_SOURCE}, reviewed ${CURATED_REVIEWED_AT}; they are not live API labels and are not refreshed by fetching the API catalog.`;
const POPULAR = new Set([
  "inworld/models/GLM-5.3-Flash",
  "inworld/models/gemma-4-31b-it",
  "inworld/models/gemma-4-26b-a4b-it",
  "inworld/models/deepseek-v4.1-flash",
]);
const RETIRING = {
  "google-ai-studio/gemini-3.7-flash": "2026-10-26",
  "google-ai-studio/gemini-3.5-flash": "2026-10-26",
  "google-ai-studio/gemini-2.5-flash-image": "2027-03-15",
  "google-vertex/gemini-2.5-flash-lite": "2026-10-20",
  "openai/gpt-4.1-nano": "2026-10-23",
  "openai/gpt-4.1-nano-2025-04-14": "2026-10-23",
  "openai/gpt-3.5-turbo": "2026-10-23",
  "anthropic/claude-sonnet-4-5-20250929": "2026-11-30",
  "openai/gpt-5-mini": "2026-12-11",
  "openai/gpt-5-nano": "2026-12-11",
};
const hosted = (id) => id.startsWith("inworld/");
const retiring = (id) => RETIRING[id];
// Catalog has no task-purpose flag. This is a narrow name heuristic, not a
// capability or quality determination; explicit model selections bypass it.
const specializedLabel = (m) => /(?:^|[/-])qwen3guard(?:[-/]|$)|(?:^|[-_/])(?:guard|classifier)(?:[-_/]|$)/i.test(m.model);
const PURPOSE_GUIDANCE = "The catalog has no task-purpose flag. Confirm that candidates suit the intended task; text output and missing reasoning/tool capabilities do not establish general-chat suitability.";

const SENTENCE_END = /[.!?…](?=\s)|\n/; // Require lookahead; chunk EOF is not sentence EOF.
const MIN_FIRST_CHUNK = 12; // don't send "Hi." alone

export function createBench({ apiBase, fetcher = fetchWithPolicy, now = () => performance.now(),
  wallNow = () => Date.now(), catalogTtlMs = 5 * 60 * 1000 }) {
  let catalog, catalogAt, fetchedAt;
  const catalogInfo = () => ({ fetched_at: fetchedAt, ttl_ms: catalogTtlMs, curated: curatedInfo() });

  async function models(key, { refresh = false } = {}) {
    if (!refresh && catalog && wallNow() - catalogAt >= 0 && wallNow() - catalogAt < catalogTtlMs) return catalog;
    const res = await fetcher(`${apiBase}/llm/v1alpha/models`, { headers: { Authorization: `Basic ${key}` } });
    if (!res.ok) throw responseFailure(res, 'GET', `Inworld GET /llm/v1alpha/models → ${res.status} ${(await res.text()).slice(0, 200)}`);
    catalog = (await res.json()).models ?? [];
    catalogAt = wallNow();
    fetchedAt = new Date(catalogAt).toISOString();
    return catalog;
  }

  // The router's canonical id is provider/model (groq/openai/gpt-oss-120b);
  // bare model names only resolve for some models, so always send the full id.
  const idOf = (m) => `${m.provider}/${m.model}`;
  const find = (all, id) => all.find((m) => idOf(m) === id) ?? all.find((m) => m.model === id);
  const resolve = (all, id) => (id === "auto" ? id : find(all, id) ? idOf(find(all, id)) : id);

  // Lowest reasoning effort the model accepts, so hidden reasoning doesn't eat
  // the latency budget (or the max_tokens) of a spoken reply.
  function lowestEffort(m) {
    const levels = m?.spec?.capabilities?.reasoningCapability?.supportedLevels ?? [];
    for (const l of ["EFFORT_NONE", "EFFORT_MINIMAL", "EFFORT_LOW"]) if (levels.includes(l)) return l.slice(7).toLowerCase();
    return undefined;
  }

  const perMillion = price => Number.isFinite(price) && price >= 0 && Number.isFinite(price * 1e6) ? price * 1e6 : null;

  async function listModels(args, key) {
    const all = await models(key, { refresh: args.refresh_catalog === true });
    const q = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const rows = all
      .filter((m) => m.isSupported !== false && (m.spec?.outputModalities ?? ["text"]).includes("text"))
      .filter((m) => q.every((w) => `${idOf(m)} ${m.modelCreator ?? ""}`.toLowerCase().includes(w)))
      .filter((m) => !args.needs_tools || m.spec?.capabilities?.functionCalling)
      .filter((m) => !args.inworld_hosted_only || m.provider === "inworld")
      .filter((m) => args.include_free || !m.model.endsWith(":free"))
      .map((m) => ({
        id: idOf(m),
        creator: m.modelCreator,
        inPerM: perMillion(m.pricing?.promptToken),
        outPerM: perMillion(m.pricing?.completionToken),
        context: m.spec?.contextLength,
        tools: Boolean(m.spec?.capabilities?.functionCalling),
        reasoning: m.spec?.capabilities?.reasoningCapability?.supported === true,
        notes: [
          m.provider === "inworld" ? "Inworld-hosted" : "",
          POPULAR.has(idOf(m)) ? "popular (curated)" : "",
          specializedLabel(m) ? "guard/classifier name heuristic; skipped by automatic benchmark defaults; explicit models override" : "",
          retiring(idOf(m)) ? `retiring ${retiring(idOf(m))} (curated)` : "",
        ].filter(Boolean).join(", "),
      }))
      .sort((a, b) => (a.inPerM !== null && a.outPerM !== null ? a.inPerM + a.outPerM : Infinity) -
        (b.inPerM !== null && b.outPerM !== null ? b.inPerM + b.outPerM : Infinity));
    const usd = (n) => n === null ? "unknown" : `$${n < 1 ? n.toFixed(2) : n.toFixed(n < 10 ? 2 : 0)}`;
    const lines = rows.slice(0, args.limit ?? 40).map((r) =>
      `| ${r.id} | ${usd(r.inPerM)} / ${usd(r.outPerM)} | ${r.context ? Math.round(r.context / 1000) + "k" : ""} | ${r.tools ? "yes" : ""} | ${r.reasoning ? "yes" : ""} | ${r.notes} |`);
    return {
      structuredContent: { models: rows, catalog: catalogInfo() },
      content: [{
        type: "text",
        text:
          `Catalog fetched ${fetchedAt}. ${rows.length} models on Inworld's router${q.length ? ` matching "${q.join(" ")}"` : ""}, cheapest first ` +
          "(price per 1M input / output tokens). Use the full id (provider/model) as `model` in /v1/chat/completions " +
          "(OpenAI-compatible), or `auto` to let the router pick. The same model on different providers can differ " +
          "a lot in latency, so benchmark_models can compare them. Inworld-hosted models run on Inworld's own " +
          "realtime inference stack; don't recommend models marked retiring for new work. " +
          curatedNote + " " + PURPOSE_GUIDANCE + "\n\n| id | $/1M in / out | context | tools | reasoning | notes |\n|---|---|---|---|---|---|\n" +
          lines.join("\n"),
      }],
    };
  }

  // First audio is diagnostic until the entire NDJSON stream has been validated.
  async function ttsFirstAudio(key, text, voiceId, modelId) {
    let firstAudioAt = NaN, decodedBytes = 0;
    try {
      const res = await fetcher(`${apiBase}/tts/v1/voice:stream`, {
        method: "POST",
        headers: { Authorization: `Basic ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId, modelId, audioConfig: { audioEncoding: "PCM", sampleRateHertz: 24000 } }),
      });
      if (!res.ok) {
        await res.body?.cancel();
        return { status: "failed", error: `TTS HTTP ${res.status}`, recovery: recoveryFor(responseFailure(res, 'POST')), firstAudioAt, decodedBytes };
      }
      const dec = new TextDecoder();
      let buf = "";
      const record = (line) => {
        if (!line.trim()) return;
        const j = JSON.parse(line);
        if (j.error || (j.result?.status?.code && Number(j.result.status.code) !== 0))
          throw new Error(`TTS stream error: ${JSON.stringify(j.error ?? j.result.status).slice(0, 200)}`);
        const encoded = j.result?.audioContent;
        if (encoded != null && encoded !== "") {
          // Buffer.from alone is permissive: e.g. "====" silently decodes empty.
          // Accept standard padded or unpadded base64, with canonical pad bits.
          if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
              encoded.length % 4 === 1 || (encoded.includes("=") && encoded.length % 4 !== 0))
            throw new Error("TTS stream error: invalid base64 audioContent");
          const bytes = Buffer.from(encoded, "base64");
          if (!bytes.length || bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, ""))
            throw new Error("TTS stream error: invalid or empty decoded audioContent");
          decodedBytes += bytes.length;
          if (!Number.isFinite(firstAudioAt)) firstAudioAt = now();
        }
      };
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          record(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      record(buf + dec.decode());
      return { status: Number.isFinite(firstAudioAt) ? "successful" : "incomplete",
        error: Number.isFinite(firstAudioAt) ? undefined : "TTS EOF without audio", firstAudioAt, decodedBytes };
    } catch (e) {
      return { status: e instanceof SyntaxError || String(e.message).startsWith("TTS stream error:") ? "failed" : "unknown",
        error: String(e.message ?? e), recovery: recoveryFor(e), firstAudioAt, decodedBytes };
    }
  }

  async function runOnce(key, { model, messages, maxTokens, effort, voice, ttsModel }) {
    const body = { model, messages, stream: true, stream_options: { include_usage: true }, max_tokens: maxTokens };
    if (effort) body.reasoning_effort = effort;
    const t0 = now();
    let firstToken = NaN, firstSentence = NaN, text = "", usage, served, buf = "", tts;
    let finishReason, doneMarker = false, transportComplete = false, error, recovery, status = "unknown", outputFinished = false;
    const sentence = (final = false) => {
      if (Number.isFinite(firstSentence) || !text.trim()) return;
      const m = text.trim().length >= MIN_FIRST_CHUNK ? SENTENCE_END.exec(text.slice(MIN_FIRST_CHUNK - 1)) : null;
      if (!m && !final) return;
      firstSentence = now() - t0;
      const part = m ? text.slice(0, MIN_FIRST_CHUNK - 1 + m.index + m[0].length).trim() : text.trim();
      if (voice) tts = ttsFirstAudio(key, part, voice, ttsModel);
    };
    try {
      const res = await fetcher(`${apiBase}/v1/chat/completions`, {
        method: "POST", headers: { Authorization: `Basic ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        status = "failed";
        await res.body?.cancel();
        throw responseFailure(res, 'POST', `LLM HTTP ${res.status}`);
      }
      const dec = new TextDecoder();
      let eventData = [];
      const event = () => {
        if (!eventData.length) return;
        const data = eventData.join("\n").trim();
        eventData = [];
        if (data === "[DONE]") { doneMarker = true; sentence(true); return; }
        if (!data) return;
        if (doneMarker) { status = "failed"; throw new Error("LLM event after [DONE]"); }
        let j;
        try { j = JSON.parse(data); } catch { status = "failed"; throw new Error("Malformed LLM SSE JSON"); }
        if (j.error) { status = "failed"; throw new Error(`LLM stream error: ${JSON.stringify(j.error).slice(0, 200)}`); }
        served ??= j.model;
        if (j.usage) usage = j.usage;
        const choice = j.choices?.find(c => c.index === 0) ?? j.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === "string" && delta) {
          if (outputFinished) { status = "failed"; throw new Error("LLM content after finish reason"); }
          if (!Number.isFinite(firstToken)) firstToken = now() - t0;
          text += delta;
          sentence();
        }
        if (choice?.finish_reason != null) {
          finishReason = choice.finish_reason;
          outputFinished = true;
          sentence(true);
        }
      };
      const line = (s) => {
        s = s.replace(/\r$/, "");
        if (!s) event();
        else if (s.startsWith("data:")) eventData.push(s.slice(5).replace(/^ /, ""));
      };
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          line(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      buf += dec.decode();
      if (buf) line(buf);
      event();
      transportComplete = true;
      status = finishReason && finishReason !== "stop" ? "incomplete"
        : doneMarker && finishReason === "stop" && text.trim() ? "successful"
        : doneMarker && finishReason === "stop" ? "incomplete" : "unknown";
      if (status !== "successful") error = `LLM ${status}: finish=${finishReason ?? "missing"}, DONE=${doneMarker}, text=${Boolean(text.trim())}`;
    } catch (e) { error = String(e.message ?? e); recovery = recoveryFor(e); }
    const elapsed = now() - t0;
    const audio = tts ? await tts : { status: voice ? "skipped" : "not_requested" };
    return { status, usable: status === "successful", finishReason, doneMarker, transportComplete, error, ...(recovery ? { recovery } : {}),
      firstToken, firstSentence, firstAudio: Number.isFinite(audio.firstAudioAt) ? audio.firstAudioAt - t0 : NaN,
      audio, total: elapsed, text: text.trim(), usage, served };
  }

  const median = (xs) => {
    const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
    if (!s.length) return NaN;
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : s[mid - 1] / 2 + s[mid] / 2;
  };

  const metricMethod = "Median of finite observations; even sample counts use the arithmetic mean of the two central values.";

  async function benchmark(args, key, { synthesize, newClipDir, saveClip, listenResult, labels }) {
    const all = await models(key, { refresh: args.refresh_catalog === true });
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) return { isError: true, content: [{ type: "text", text: "benchmark_models needs a prompt (ideally a real user turn from the app)." }] };
    const messages = [...(args.system ? [{ role: "system", content: String(args.system) }] : []), { role: "user", content: prompt }];
    const candidates = all.filter(m => m.provider === "inworld" && m.isSupported !== false &&
      (m.spec?.outputModalities ?? ["text"]).includes("text") && !retiring(idOf(m)));
    const explicit = Boolean(args.models?.length);
    const skipped = explicit ? [] : candidates.filter(specializedLabel).map(m => ({ id: idOf(m), reason: "guard/classifier name heuristic" }));
    const selection = { mode: explicit ? "explicit" : "default", skipped_defaults: skipped, guidance: PURPOSE_GUIDANCE };
    const selectionNote = `${PURPOSE_GUIDANCE} ` + (explicit
      ? "Explicit model selections are preserved, including guard/classifier labels."
      : `Guard/classifier name exclusions apply only to automatic defaults; pass explicit models to override.${skipped.length ? ` Skipped: ${skipped.map(m => m.id).join(", ")}.` : ""}`);
    const defaults = candidates.filter(m => !specializedLabel(m))
      .sort((a, b) => Number(POPULAR.has(idOf(b))) - Number(POPULAR.has(idOf(a))))
      .slice(0, 3).map(idOf);
    const ids = (args.models?.length ? args.models : defaults).slice(0, 8);
    if (!ids.length) return { isError: true, structuredContent: { selection, catalog: catalogInfo() }, content: [{ type: "text", text: `No supported default candidates found. Choose explicit live model IDs with list_llm_models. ${selectionNote} ${curatedNote}` }] };
    const runs = Math.min(Math.max(args.runs ?? 3, 1), 5);
    const voice = typeof args.voice === "string" && args.voice.trim() ? args.voice.trim() : undefined;
    const ttsModel = args.tts_model || "inworld-tts-2-flash";
    const maxTokens = args.max_tokens ?? 200;

    const rows = [];
    for (const asked of ids) {
      const model = resolve(all, asked);
      const meta = find(all, model);
      const effort = args.reasoning === "lowest" ? lowestEffort(meta) : undefined;
      const samples = [];
      for (let i = 0; i < runs; i++) {
        const sample = await runOnce(key, { model, messages, maxTokens, effort, voice, ttsModel });
        const price = find(all, sample.served ?? model)?.pricing;
        const valid = n => Number.isFinite(n) && n >= 0;
        sample.promptTokens = valid(sample.usage?.prompt_tokens) ? sample.usage.prompt_tokens : null;
        sample.completionTokens = valid(sample.usage?.completion_tokens) ? sample.usage.completion_tokens : null;
        sample.reasoningTokens = valid(sample.usage?.completion_tokens_details?.reasoning_tokens)
          ? sample.usage.completion_tokens_details.reasoning_tokens : null;
        sample.visibleTokens = sample.completionTokens !== null && sample.reasoningTokens !== null && sample.reasoningTokens <= sample.completionTokens
          ? sample.completionTokens - sample.reasoningTokens : null;
        sample.cost = valid(price?.promptToken) && valid(price?.completionToken) && sample.promptTokens !== null && sample.completionTokens !== null
          ? sample.promptTokens * price.promptToken + sample.completionTokens * price.completionToken : NaN;
        // All completion tokens / whole request time, including prefill, reasoning,
        // visible output and stream termination. This is not decode throughput.
        sample.tokPerSec = sample.completionTokens !== null && sample.total > 0 ? sample.completionTokens / sample.total * 1000 : NaN;
        samples.push(sample);
        if (sample.status === "failed" || sample.status === "unknown") break;
      }
      const succeeded = samples.filter(s => s.usable);
      const last = succeeded.at(-1) ?? samples.at(-1);
      const coverage = (subset, field) => ({ valid: subset.filter(s => Number.isFinite(s[field])).length, attempted: samples.length });
      const measured = (subset, field) => median(subset.map(s => s[field]));
      const audioGood = samples.filter(s => s.audio.status === "successful");
      const knownCosts = samples.filter(s => Number.isFinite(s.cost));
      const counts = { requested: runs, attempted: samples.length, succeeded: succeeded.length,
        incomplete: samples.filter(s => s.status === "incomplete").length,
        failed: samples.filter(s => s.status === "failed").length,
        unknown: samples.filter(s => s.status === "unknown").length, skipped: runs - samples.length };
      const audioCounts = {
        requested: voice ? runs : 0,
        attempted: samples.filter(s => !["not_requested", "skipped"].includes(s.audio.status)).length,
        succeeded: audioGood.length,
        incomplete: samples.filter(s => s.audio.status === "incomplete").length,
        failed: samples.filter(s => s.audio.status === "failed").length,
        unknown: samples.filter(s => s.audio.status === "unknown").length,
      };
      audioCounts.skipped = audioCounts.requested - audioCounts.attempted;
      rows.push({
        audioCounts, model, served: last?.served, effort, error: samples.find(s => s.error)?.error, runs: succeeded.length,
        ...counts, counts, samples,
        firstToken: measured(samples, "firstToken"), firstSentence: measured(samples, "firstSentence"),
        firstAudio: measured(audioGood, "firstAudio"), total: measured(succeeded, "total"),
        tokPerSec: measured(succeeded, "tokPerSec"),
        costPer1k: knownCosts.length === samples.length && samples.length === runs ? measured(samples, "cost") * 1000 : NaN,
        observedCostPer1k: measured(knownCosts, "cost") * 1000,
        costScope: "median per-request uncached LLM list-price estimate; excludes TTS; not total spend",
        coverage: { firstToken: coverage(samples, "firstToken"), firstSentence: coverage(samples, "firstSentence"),
          firstAudio: { ...coverage(audioGood, "firstAudio"), attempted: samples.filter(s => !["not_requested", "skipped"].includes(s.audio.status)).length },
          total: coverage(succeeded, "total"), tokPerSec: coverage(succeeded, "tokPerSec"), cost: coverage(samples, "cost"),
          usage: { valid: samples.filter(s => s.promptTokens !== null && s.completionTokens !== null).length, attempted: samples.length } },
        reasoningTokens: last?.reasoningTokens, visibleTokens: last?.visibleTokens, reply: last?.text ?? "",
      });
    }

    const ms = (n) => (Number.isFinite(n) ? `${Math.round(n)} ms` : "n/a");
    const ok = rows.filter((r) => r.succeeded > 0);
    const metric = (r, k) => `${ms(r[k])} (${r.coverage[k].valid}/${r.coverage[k].attempted})`;
    const table = [
      `| model | outcomes | first token* | first sentence* |${voice ? " first audio* |" : ""} full reply | completion tokens/request s | LLM $ per 1k attempts |`,
      `|---|---|---|---|${voice ? "---|" : ""}---|---|---|`,
      ...rows.map((r) => `| ${r.model}${hosted(r.model) ? " (Inworld-hosted)" : ""} | ` +
        `${r.attempted}/${r.requested} attempted; ${r.succeeded} successful, ${r.incomplete} incomplete, ${r.failed} failed, ${r.unknown} unknown, ${r.skipped} skipped | ` +
        `${metric(r, "firstToken")} | ${metric(r, "firstSentence")} |` +
        (voice ? ` ${metric(r, "firstAudio")} |` : "") +
        ` ${metric(r, "total")} | ${Number.isFinite(r.tokPerSec) ? Math.round(r.tokPerSec) : "n/a"} (${r.coverage.tokPerSec.valid}/${r.attempted}) | ` +
        `${Number.isFinite(r.costPer1k) ? "$" + r.costPer1k.toFixed(3) : "unknown"} (${r.coverage.cost.valid}/${r.attempted}) |`),
    ].join("\n");
    const notes = rows.flatMap(r => [
      voice ? `- ${r.model} audio: ${r.audioCounts.attempted}/${r.audioCounts.requested} attempted; ${r.audioCounts.succeeded} successful, ${r.audioCounts.incomplete} incomplete, ${r.audioCounts.failed} failed, ${r.audioCounts.unknown} unknown, ${r.audioCounts.skipped} skipped.` : "",
      ...r.samples.flatMap((s, i) => [
        s.error ? `- ${r.model} attempt ${i + 1}: ${s.error}.` : "",
        s.audio.error ? `- ${r.model} attempt ${i + 1} audio ${s.audio.status}: ${s.audio.error}.` : "",
        s.reasoningTokens !== null ? `- ${r.model} attempt ${i + 1}: ${s.reasoningTokens} reasoning, ${s.visibleTokens ?? "unknown"} visible, ${s.completionTokens ?? "unknown"} total completion tokens.` : "",
      ].filter(Boolean)),
      Number.isFinite(r.observedCostPer1k) && !Number.isFinite(r.costPer1k)
        ? `- ${r.model}: observed subset LLM cost $${r.observedCostPer1k.toFixed(3)}/1k attempts (${r.coverage.cost.valid}/${r.attempted} observed; ${r.requested} requested); overall cost unknown.` : "",
      retiring(r.model) ? `- ${r.model} has a curated retirement date of ${retiring(r.model)} (public-page snapshot reviewed ${CURATED_REVIEWED_AT}); don't move an app onto it.` : "",
    ].filter(Boolean));
    const replies = ok.map((r) => `- **${r.model}**${r.served && r.served !== r.model ? ` (served by ${r.served})` : ""}: "${r.reply.slice(0, 300)}${r.reply.length > 300 ? "…" : ""}"`);
    const intro =
      `Benchmarked ${rows.length} models through Inworld's router on the user's prompt; requested ${runs} run(s) per model. ` +
      `${selectionNote} Actual attempt/outcome counts are below. ${metricMethod} Measurements from this machine; each metric shows valid/attempted coverage. ` +
      `*First token/sentence are arrival diagnostics, including incomplete attempts. First audio includes only validated audio streams; full reply and throughput include only successful LLM completions. ` +
      `Completion tokens/request s uses all completion tokens divided by entire LLM request time (including prefill, reasoning and stream termination), not decode throughput. ` +
      (voice ? `"First audio" measures LLM request to first received audio from ${ttsModel} (${voice}), not audible playback; later stream failures remain diagnostics in samples. ` : "") +
      (args.reasoning === "lowest" ? "Lowest reasoning effort was requested as a tuning experiment. " : "Model reasoning defaults were preserved. ") +
      `Costs are uncached list-price estimates for LLM attempts only, excluding TTS, not effective billed costs or negotiated rates. No usage is imputed; per-request costs are aggregated before reporting. Catalog fetched ${fetchedAt}. ${curatedNote} A few runs are exploratory.\n\n` +
      `${table}\n\n${notes.length ? `Notes:\n${notes.join("\n")}\n\n` : ""}Completed replies:\n${replies.join("\n")}`;

    const structuredContent = { prompt, catalog: catalogInfo(), selection, metric_method: metricMethod, results: rows };
    if (!voice || args.listen === false || !ok.length) {
      return { content: [{ type: "text", text: intro }], structuredContent };
    }
    // Auditions are optional follow-up work: failures must not discard measured
    // LLM/TTS results, and successful clips remain available after partial failure.
    const audition = { status: "successful", requested: ok.length, attempted: 0, succeeded: 0, failed: 0, skipped: 0, attempts: [], errors: [] };
    structuredContent.audition = audition;
    const auditionText = () => `${intro}\n\nAudio audition ${audition.status}: ${audition.attempted}/${audition.requested} attempted, ${audition.succeeded} rendered, ${audition.failed} failed, ${audition.skipped} skipped.` +
      audition.errors.map(e => `\n- ${e.model ? `${e.model}: ` : ""}${e.stage}: ${e.error}`).join("");
    const report = () => ({ content: [{ type: "text", text: auditionText() }], structuredContent });
    let dir;
    try { dir = await newClipDir(); }
    catch (e) {
      audition.status = "failed";
      audition.skipped = ok.length;
      audition.errors.push({ stage: "directory", error: String(e.message ?? e) });
      return report();
    }
    const rendered = await Promise.all(ok.map(async (r, i) => {
      audition.attempted++;
      let stage = "synthesis";
      try {
        const audio = await synthesize(key, { text: r.reply.slice(0, 500), voiceId: voice, modelId: ttsModel });
        stage = "save";
        const label = labels?.[i] ?? String.fromCharCode(65 + i);
        const file = await saveClip(dir, label, r.model, audio);
        return { clip: { label, id: r.model, audio, file }, outcome: { model: r.model, status: "successful" } };
      } catch (e) {
        return { outcome: { model: r.model, status: "failed", stage, error: String(e.message ?? e) } };
      }
    }));
    audition.attempts = rendered.map(r => r.outcome);
    const clips = rendered.filter(r => r.clip).map(r => r.clip);
    audition.succeeded = clips.length;
    audition.failed = rendered.length - clips.length;
    audition.errors = audition.attempts.filter(a => a.status === "failed");
    audition.status = audition.failed ? clips.length ? "incomplete" : "failed" : "successful";
    if (!clips.length) return report();
    try {
      return await listenResult(
        clips, `${auditionText()}\n\nRendered replies use ${voice}.`,
        "Ask which reply sounds best, then weigh it against first-audio latency and cost. To switch, change only the " +
          "model string in the app's chat completion call (same endpoint and key).",
        structuredContent,
      );
    } catch (e) {
      audition.status = "failed";
      audition.errors.push({ stage: "presentation", error: String(e.message ?? e) });
      return report();
    }
  }

  return { listModels, benchmark, models };
}
