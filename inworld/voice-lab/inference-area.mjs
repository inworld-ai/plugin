import {createBench} from './bench.mjs';
import {createRouterTools} from './router.mjs';
export function createArea({apiBase,synthesize,newClipDir,saveClip,listenResult,labels}) {
 const bench=createBench({apiBase});
 const router=createRouterTools({apiBase,models:key=>bench.models(key)});
 return { tools:[
  {
    name: "list_llm_models",
    title: "Explore Inworld Inference Models",
    description:
      "List the LLMs available through Inworld's router (one API key, OpenAI-compatible /v1/chat/completions) with " +
      "price per 1M tokens, context length, and tool-calling and reasoning support, cheapest first. Use to pick " +
      "candidates for benchmark_models or when the user asks which models they can use.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filter by id or creator, e.g. \"claude\", \"gemini flash\", \"deepseek\"." },
        refresh_catalog: { type: "boolean", description: "Refresh the live model catalog instead of using the TTL cache." },
        needs_tools: { type: "boolean", description: "Only models with function calling." },
        inworld_hosted_only: { type: "boolean", description: "Only models Inworld serves on its own realtime inference stack." },
        include_free: { type: "boolean", description: "Include rate-limited :free variants (hidden by default)." },
        limit: { type: "integer", minimum: 1, maximum: 120 },
      },
    },
  },
  {
    name: "benchmark_models",
    title: "Benchmark AI Models with Inworld",
    description:
      "Run the user's own prompt through several LLMs on Inworld's router and compare them the way a voice app " +
      "experiences them: time to first token, to the first complete sentence, and to the first audio when that " +
      "sentence is streamed into Inworld TTS, plus full-reply time, tokens/s and cost per 1,000 replies. Then " +
      "renders each model's reply in the same voice so the user can judge quality by ear using available host playback. " +
      "Use when choosing an LLM for a voice agent or text app. For a comparison against the existing provider, " +
      "follow the benchmark-models skill using the app’s current client.",
    inputSchema: {
      type: "object",
      properties: {
        refresh_catalog: { type: "boolean", description: "Refresh the live model catalog and pricing before this benchmark." },
        prompt: { type: "string", description: "A real user turn from the app." },
        system: { type: "string", description: "The app's system prompt, if it has one (it changes latency and replies)." },
        models: { type: "array", items: { type: "string" }, maxItems: 8, description: "Router ids as provider/model from list_llm_models (e.g. groq/openai/gpt-oss-120b), or \"auto\". The same model on two providers is a fair comparison. Choose candidates from list_llm_models. Without models, selects up to three currently supported Inworld-hosted text models." },
        runs: { type: "integer", minimum: 1, maximum: 5, description: "Runs per model; medians are reported (default 3)." },
        voice: { type: "string", description: "For voice apps, pass the app’s voice to measure first audio and render replies. Omit or use an empty string for text-only inference." },
        tts_model: { type: "string", description: "inworld-tts-2-flash (default) or inworld-tts-2." },
        max_tokens: { type: "integer", description: "Default 200." },
        reasoning: { type: "string", enum: ["lowest", "default"], description: "default (the default) preserves model defaults; lowest is an explicit tuning experiment. Use the app client to benchmark exact custom reasoning settings." },
        listen: { type: "boolean", description: "Render each reply in the voice (default true)." },
      },
      required: ["prompt"],
    },
  },
  {
    name: "resolve_models",
    title: "Map model ids to Inworld's router",
    description:
      "Map the model ids an app uses today (OpenAI \"gpt-4o-mini\", Anthropic \"claude-sonnet-4-5-20250929\", " +
      "OpenRouter \"anthropic/claude-3.5-sonnet\", etc.) to the closest live ids on Inworld's LLM Router, with prices. " +
      "Use when moving an app's LLM calls to the router.",
    inputSchema: {
      type: "object",
      properties: { models: { type: "array", items: { type: "string" }, maxItems: 30, description: "Model ids found in the code." } },
      required: ["models"],
    },
  },
  {
    name: "get_router",
    title: "Read a router config",
    description: "Read one LLM Router config by name (or list the workspace's routers when name is omitted). Routers are called with model \"inworld/<name>\".",
    inputSchema: { type: "object", properties: { name: { type: "string" } } },
  },
  {
    name: "save_router",
    title: "Create or update a router",
    description:
      "Validate and save an LLM Router config (created if new, updated if it exists): a defaultRoute plus optional " +
      "conditional routes (CEL on request metadata), each with weighted variants (weights sum to 100) that set the " +
      "model (provider/model, a bare model name for provider routing, or auto), fallbacks in model_selection.models, " +
      "provider order, sort metrics, message_templates, text_generation_config and compression. Pass dry_run to only " +
      "validate and get the JSON and curl. Only save after the user has agreed to the config.",
    inputSchema: {
      type: "object",
      properties: {
        router: { type: "object", description: "Router JSON as in POST /router/v1/routers (name, displayName, routes, defaultRoute, defaults)." },
        dry_run: { type: "boolean" },
      },
      required: ["router"],
    },
  },
  {
    name: "test_router",
    title: "Test how a router serves requests",
    description:
      "Send the same chat request several times to a router (or any model id) and report which model served each, " +
      "fallbacks, and round-trip time. Pass metadata to exercise a conditional route, user to check sticky variants, " +
      "and extra for request-level options (models, provider, sort, fallback.ttft_timeout).",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Router name, inworld/<router>, a provider/model id, or auto." },
        prompt: { type: "string" },
        system: { type: "string" },
        runs: { type: "integer", minimum: 1, maximum: 20 },
        metadata: { type: "object", description: "Request metadata the router's CEL conditions read (sent as extra_body.metadata)." },
        user: { type: "string" },
        extra: { type: "object", description: "Extra top-level routing fields. Cannot override model, messages, stream, max_tokens, user or extra_body; use the named arguments. Example: {\"models\": [...], \"fallback\": {\"ttft_timeout\": \"800ms\"}}." },
        max_tokens: { type: "integer" },
      },
      required: ["model"],
    },
  },
  {
    name: "ask_decision",
    title: "Ask a decision question",
    description:
      "Run Inworld's Decisions API (preview; TypeSafe Jev): send a state and named typed questions, get probabilities " +
      "back instead of text. Types: noul (yes/no probability), choice (one of criteria), score (ordered levels). Use to " +
      "prototype and probe thresholds before writing the call into the user's code.",
    inputSchema: {
      type: "object",
      properties: {
        state: { description: "What to judge: a string or JSON object with named fields." },
        questions: { type: "object", description: "Map of name → {type: noul|choice|score, instructions, criteria?}." },
        model: { type: "string", description: "Default typesafe/jev-latest." },
      },
      required: ["state", "questions"],
    },
  },
 ],handlers:{
 list_llm_models:(a,k)=>bench.listModels(a,k),
 resolve_models:(a,k)=>router.resolveModels(a,k),
 get_router:(a,k)=>router.getRouter(a,k),
 save_router:(a,k)=>router.saveRouter(a,k),
 test_router:(a,k)=>router.testRouter(a,k),
 ask_decision:(a,k)=>router.askDecision(a,k),
 benchmark_models:(a,k)=>bench.benchmark(a,k,{synthesize,newClipDir,saveClip,listenResult,labels}),
 }};
}
