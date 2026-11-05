---
name: add-llm
description: "Connect app LLM calls to Inworld inference and routing. Use for OpenAI/Anthropic-compatible integrations, model fallbacks or provider switches."
---

# Add or move LLM calls to Inworld's router

Put the app's LLM calls on Inworld's LLM Router: one API key and one OpenAI- or Anthropic-compatible endpoint for 100+ models (OpenAI, Anthropic, Google, DeepSeek, Mistral, xAI and Inworld-hosted models), with fallbacks and provider routing. Moves existing OpenAI, Anthropic, OpenRouter, LiteLLM, Vercel AI SDK or LangChain calls by swapping the base URL and key and mapping model ids. Use when the user wants to add an LLM, switch or compare LLM providers, move off OpenRouter, add fallbacks, or cut LLM cost or latency.

Before calling tools, follow [installed tool availability](../connect/references/tool-availability.md).
Use the single Inworld connection and its actual schemas. If the host has
disabled a tool or loaded an older package, follow the availability guidance;
missing tools do not imply a missing API key.


When the user wants evidence before switching inference providers, use the
`benchmark-models` skill's [direct provider comparison](../benchmark-models/references/provider-comparison.md)
before changing their app. Reuse the provider context already in this session and
the app’s client/tests. Compare the same model with the current provider first,
preserving app parameters, tools and conversation history.
Cross-model selection is a separate experiment. A saved router is optional for
direct inference; Router Write permission is only needed for configuration writes.

The router speaks the OpenAI Chat Completions, OpenAI Responses and Anthropic
Messages formats, so most apps move with a base URL, a key and model ids, and
keep their SDK. Make the change behind config so it can be rolled back.

## Step 0 — Connection

If `list_llm_models` is registered, call it with `{"limit": 1}` to check inference access. If it reports
a missing/invalid key, run `connect`, then return here. A voice-library permission
is not a prerequisite for inference. Without that optional tool, use `search_docs`
for current setup guidance and continue inspecting/scaffolding the app. Check
live inference only through an available core chat tool or the explicitly
configured app client when that request is authorized; do not synthesize speech
or ask for another credential just to replace the absent catalog tool.

## Step 1 — Find the LLM calls

Identify SDK dependencies in package manifests/lockfiles, imports and client constructors.
Inspect application source at those call sites; do not search credential files,
provider key names or authentication headers to discover the integration.

| Stack | Packages / imports and client calls |
|---|---|
| OpenAI SDK | `openai` (npm/PyPI), `new OpenAI(`, `OpenAI(` |
| Anthropic SDK | `@anthropic-ai/sdk`, `anthropic` (PyPI), `new Anthropic(`, `anthropic.Anthropic(` |
| OpenRouter SDK | `@openrouter/sdk` |
| Vercel AI SDK | `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `createOpenAI(` |
| LangChain | `@langchain/openai`, `langchain_openai`, `@langchain/anthropic`, `langchain_anthropic` |
| LiteLLM | `litellm`, `litellm.completion(` |
| Raw HTTP / a shared compatible SDK | Trace the app's named inference adapter and request-building call sites; if the provider remains ambiguous, ask the developer |

List every model id in use and what each call does (chat, tools, JSON output,
streaming, vision, embeddings). Note anything the router doesn't serve:
`/v1/models`, embeddings, batches and files stay on their current provider.
For image generation or video jobs, use `generate-image` or `generate-video` to
map those calls separately; do not assume an images-endpoint base-URL swap works.

## Step 2 — Map the models

Before the first inference request, resolve IDs from the live catalog. Never
construct a provider prefix from memory. If the optional tools are unavailable,
use the documented catalog endpoint through the app's explicit Inworld credential
configuration; if offline, leave an unresolved config value and do not make a
guessed request. For a new latency-sensitive voice app, shortlist suitable
Inworld-hosted text models (`inworld_hosted_only: true`) alongside the developer's
chosen baseline; check tools/context and test quality before recommending one.
Keep existing same-model comparison settings unchanged. A catalog's latency or
hosting label does not establish an app-quality winner.


Call `resolve_models` with the ids from the code. Exact and same-model matches
can be used directly; confirm "closest" and "same family, newer" picks with the
user. For an evaluation or cost/latency question, make `/inworld:benchmark-models` the
next step: use the current session’s provider/client and real requests, then show
the measured tradeoffs before offering the migration patch. If the developer
already chose to migrate, respect that choice rather than imposing a benchmark.

Use full live `provider/model` IDs. Do not assume bare names resolve or silently
substitute a different provider/model during a same-model comparison.

## Step 3 — Swap the client

Read the key from `INWORLD_API_KEY` (server side only; the copied Base64 value,
not re-encoded) and keep the model in config, e.g. `LLM_MODEL`. Add an
`LLM_PROVIDER` switch if the user wants an easy rollback.

**OpenAI SDK**:

```ts
const client = new OpenAI({
  baseURL: "https://api.inworld.ai/v1",
  apiKey: process.env.INWORLD_API_KEY,
  maxRetries: 0, // one application attempt; explicit router fallbacks stay server-side
  defaultHeaders: { Authorization: `Basic ${process.env.INWORLD_API_KEY}` },
});
```

```python
client = OpenAI(
    base_url="https://api.inworld.ai/v1",
    api_key=os.environ["INWORLD_API_KEY"],
    max_retries=0,  # one application attempt; explicit router fallbacks stay server-side
    default_headers={"Authorization": f"Basic {os.environ['INWORLD_API_KEY']}"},
)
```

**Anthropic SDK**: base URL without `/v1`; the key goes in the Basic header
(the router doesn't read `x-api-key`):

```ts
const client = new Anthropic({
  baseURL: "https://api.inworld.ai",
  apiKey: null,
  maxRetries: 0,
  authToken: process.env.INWORLD_API_KEY,
  defaultHeaders: { Authorization: `Basic ${process.env.INWORLD_API_KEY}` },
});
```

```python
client = anthropic.Anthropic(
    base_url="https://api.inworld.ai",
    api_key=None,
    max_retries=0,
    auth_token=os.environ["INWORLD_API_KEY"],
    default_headers={"Authorization": f"Basic {os.environ['INWORLD_API_KEY']}", "X-Api-Key": anthropic.omit},
)
```

The `model` can then be any router model, not only Claude.

**OpenRouter**: the request format carries over.
- Base URL `https://openrouter.ai/api/v1` → `https://api.inworld.ai/v1`; key
  `OPENROUTER_API_KEY` → `INWORLD_API_KEY` with the Basic header above.
- Model slugs → `resolve_models` (OpenRouter's `anthropic/claude-...` ids differ).
- `models: [...]` fallbacks and `provider: { order: [...] }` work as they are.
  `route: "fallback"` isn't needed. Drop `HTTP-Referer`, `X-Title`,
  `transforms` and `usage: { include: true }` (usage is always returned).
- Reasoning: use `reasoning_effort` (`none` … `xhigh`).
- `@openrouter/sdk` `callModel`: replace with the OpenAI SDK as above.

**Vercel AI SDK**: `createOpenAI({ baseURL: "https://api.inworld.ai/v1",
apiKey, headers: { Authorization: \`Basic ${apiKey}\` } })` and use its
chat-completions model (`provider.chat(model)`).

**LangChain**: `ChatOpenAI({ model, apiKey, configuration: { baseURL:
"https://api.inworld.ai/v1", defaultHeaders: { Authorization: \`Basic ${apiKey}\` } } })`.

## Step 4 — Make it resilient

Offer request-level options (no router config needed):

- **Fallbacks**: `models: ["fallback/model-a", "fallback/model-b"]`, tried in order
  when the primary fails.
- **Time-to-first-token fallback** for voice and chat UX:
  `fallback: { ttft_timeout: "800ms" }` (minimum `300ms`) moves on when the first
  token is slow.
- **Auto**: `model: "auto"` with `sort: ["price"]` or `["latency"]`, optionally
  limited with `models` / `ignore`.

In the OpenAI SDK these are extra body fields: pass them in the request object
in Node (cast if TypeScript complains), or via `extra_body={...}` in Python.
For A/B tests, per-tier routing or central prompt templates, use the
Inworld `configure-router` skill instead.

If the app turns LLM replies into speech, mention voice responses: add
`audio: { voice, model: "inworld-tts-2" }` to the chat completion and the
router returns the reply already spoken (one call, streamed).

## Step 5 — Verify

Run the app's own test or a one-off script through the new client. Call
`test_router` with the app's model (and `extra` for any fallbacks) to show which
model served the request and how long it took. Tell the user where the model id
lives in config, and that usage and cost appear in Inworld Portal.

## One attempt and complete streams

The OpenAI SDK retries some failures by default. The examples above disable SDK
retries for a single-attempt request, bounded benchmark or server-managed router
fallback. Per-request overrides are the second argument to
`client.chat.completions.create(body, {maxRetries: 0})` in Node and
`client.with_options(max_retries=0)` in Python. If an existing app deliberately
retries, keep that policy explicit and count every transport attempt. Disabling SDK
retries does not disable the router's explicitly configured server-side fallbacks.

For raw Chat Completions SSE (`n=1`), copy
[assets/chat-stream.mjs](assets/chat-stream.mjs). Pass the fetch response to
`readChatStream(response, {onDelta, signal})`; use the same abort signal on fetch.
Deltas are provisional until the consumer returns completed. It requires a terminal
finish reason and `[DONE]`, drains trailing usage/errors, rejects malformed/truncated
streams, and never retries. `length` or `content_filter` outcomes are incomplete,
not full success. A tool-calls finish hands control to the app's tool loop and does
not prove a final user answer or successful tool execution. With a parsed SDK stream,
use its documented completion/error lifecycle; a clean iterator EOF or some text
alone is insufficient evidence of completion. Test a cut-off after text, a cut-off
after the finish reason, late errors, and cancellation. These Chat Completions
markers do not apply to native TTS NDJSON or Realtime event protocols.

SDK retry references: [Node](https://github.com/openai/openai-node#retries),
[Python](https://github.com/openai/openai-python#retries).
