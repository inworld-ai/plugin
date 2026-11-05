---
name: configure-router
description: "Configure and test model routing, fallbacks and weighted A/B variants. Use for saved Inworld routers and conditional request routing."
argument-hint: "[what the routing should do]"
---

# Configure an Inworld router

Design, save and test an Inworld LLM Router config: fallbacks across models and providers, A/B tests with weighted variants, routing by user tier or request content (CEL conditions), auto model selection by price or latency, shared prompt templates, prompt compression and caching. The app then calls one router model id, and routing changes without a deploy. Use when the user wants a saved router with weighted A/B variants or conditional models per customer tier, or centrally managed models, prompts and routing without a deploy. For simple request-level fallbacks use add-llm; for cost/latency evaluation use benchmark-models before choosing a routing change.

Before calling tools, follow [installed tool availability](../connect/references/tool-availability.md).
Use the single Inworld connection and its actual schemas. If the host has
disabled a tool or loaded an older package, follow the availability guidance;
missing tools do not imply a missing API key.


A router is a named config the app calls as `model: "inworld/<name>"`. Changing
the router changes routing for every request, with no code deploy.

## Request-level or a router?

Fallbacks, `auto` with a sort, and provider order also work per request (see
`add-llm`). Use a router when the user wants an A/B split, routing by tier or
content, prompts or generation settings managed centrally, or to change models
without redeploying. For simple fallbacks or provider order, continue in
`add-llm` using app-side request settings; do not create a saved router. For an
evaluation-only cost/latency request, use `benchmark-models` without migrating.

Once managed routing and integration are within the requested scope, use
`add-llm` if the app does not yet call Inworld. Preparing a router config alone
does not require migrating the app. Preserve migration authorization already
given; do not ask for it again.

If the optional router tools are absent, prepare the requested JSON and explain
which fields have not been validated. Use core `search_docs` for the current
schema and provide a Portal handoff for review/save. Core `list_routers` can list
existing routers, but cannot read their full config, dry-run or save a change.
Do not call `get_router`, `save_router` or `test_router` unless registered.

## Step 1 — Design it with the user

How it works: conditional `routes` are checked in order and the first CEL
condition that matches wins, otherwise `defaultRoute` is used. Inside the chosen
route, one variant is picked by `weight` (weights must sum to exactly 100). The
variant sets the model.

Pick the patterns that match the goal (use `list_llm_models` or
`resolve_models` for ids, `benchmark_models` to choose between candidates):

| Goal | Variant / route shape |
|---|---|
| Fallbacks | `model_id: "inworld/models/GLM-5.3-Flash"`, `model_selection: { models: ["google-ai-studio/gemini-2.5-flash-lite"] }` (order listed, or add `sort`) |
| Best provider for one model | bare `model_id: "deepseek-v4-flash"`; optional `model_selection.provider: { order: ["inworld", "deepseek"], allow_fallbacks: true }` |
| Auto pick | `model_id: "auto"`, `model_selection: { models: [...] or ["openai"], ignore: [...], sort: [{ metric: "SORT_METRIC_LATENCY" }, { metric: "SORT_METRIC_PRICE" }] }` (also THROUGHPUT, INTELLIGENCE, MATH, CODING) |
| A/B test | two variants in one route, `weight: 50` each; send `user` on requests so each user always gets the same variant |
| Per tier / region | conditional route with `condition: { cel_expression: "tier == \"premium\"" }`; more specific conditions first |
| By content | CEL on messages, e.g. `messages.last().content.matches("(?i).*(refund|chargeback).*")` |
| One system prompt for all callers | variant `message_templates` (supports `{{variable}}` prompt variables) |
| Generation settings | variant `text_generation_config` (`temperature`, `max_tokens`, `reasoning: { effort: "none" }`, …); it replaces router-level defaults entirely, it doesn't merge |
| Cheaper long prompts | variant `compression: { aggressiveness: 0.7 }`; skip it for JSON, XML or code the model must read exactly |

Caching: providers' implicit prompt caching works automatically, and the router
keeps a conversation on the same provider so cache hits continue. For Anthropic
and Google, mark large static context with `cache_control: { type: "ephemeral",
ttl: "1h" }` on that message part.

Write the full JSON and show it to the user. Run `save_router` with
`dry_run: true` to validate (weights, ids, conditions) before saving.

## Step 2 — Save it

When saving is within the user's current request or prior authorization, call
`save_router` (it creates the router or updates it if the name exists; check the current config first with `get_router` when
updating). If it reports the key can't write routers, relay the fix it gives and
offer the JSON for Portal instead.

## Step 3 — Point the app at it

When a task permits one application attempt, or the router owns failover, disable
OpenAI SDK retries explicitly (`maxRetries: 0` in Node, `max_retries=0` in Python).
A server-side fallback can still try its configured candidates within that one
application request; disclose that distinction. Preserve deliberately selected
app retry policies otherwise and count transport attempts in benchmarks.
For streaming consumers, follow `add-llm`'s complete-stream handling: partial
text, a truncated iterator or transport EOF alone must not become success.


When integration is requested or already authorized, set the app's model to
`inworld/<name>` (in config). For config-only work, report the integration change
as a next step without editing the app. For conditional routes the
app must send the metadata the CEL reads, as a literal `extra_body` field in the
JSON body:

```ts
await client.chat.completions.create({
  model: "inworld/support-voice",
  messages,
  user: userId,                                      // sticky A/B variant
  // @ts-expect-error router-specific field
  extra_body: { metadata: { tier: user.tier, region } },
});
```

```python
client.chat.completions.create(
    model="inworld/support-voice",
    messages=messages,
    user=user_id,
    # The OpenAI SDK merges extra_body into the request, so nest the router's
    # own extra_body inside it.
    extra_body={"extra_body": {"metadata": {"tier": user.tier, "region": region}}},
)
```

Metadata is typed: send numbers as numbers if the CEL compares numbers.

## Step 4 — Test it

Call `test_router` with the router name:
- several `runs` to see an A/B split (more runs → closer to the weights),
- `metadata` matching each condition to see each route, and one without to hit
  the default,
- `user` to confirm the same user keeps the same variant.

Report which model served each case. For measuring an A/B test's impact on
product metrics, point the user to the router's BigQuery and Mixpanel exports
(docs.inworld.ai/router/data-integrations/overview).
