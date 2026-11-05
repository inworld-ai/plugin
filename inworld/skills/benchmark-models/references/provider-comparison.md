# How to run an app benchmark

Reuse the project's normal SDK, framework, fixtures and credentials. If it has
no benchmark, write a small local script in its language, using the existing
provider client plus an Inworld client. Don't require a new service, config format
or dataset export. Resolve current Inworld API details with docs and model IDs
with `list_llm_models`. A saved router is not needed for direct model calls.

## Confirm the live comparison scope

Before execution, name the actual incumbent and Inworld hosts, input categories,
request count and spend estimate. Obtain explicit opt-in for that comparison;
reuse a clear existing request covering this scope. Merely finding credentials
is not authorization. Keep preparation offline until that scope is authorized.
Do not enable extra providers or a remote quality-judge service silently. A new
judge is another destination requiring disclosure and opt-in.

## Match the workload

Keep system prompt, messages, tools, output schema, sampling/reasoning settings
and output limits fixed for the first comparison. Prefer the same model/version;
if unavailable, label the model difference. Use representative app fixtures for
short and long context, tool calls and normal responses. Redact sensitive data
before sending examples to a new provider. Keep keys out of chat and reports.

For conversation-heavy apps, run an initial request, an identical repeat and a
next-user-turn request with the same prefix. Supply both providers the same
history rather than different generated conversations. Preserve their supported
cache mechanisms; implicit and explicit caching can differ. Include cold/initial
and warm paths in proportions meaningful to the app. Don't deliberately defeat
the incumbent's cache or use a short hello prompt as the only workload.

A useful initial check is 10–20 representative requests per path. It's exploratory;
for tail-latency evidence, extend to a larger paired sample (around 200 requests
when budget allows) and report the actual count. Reuse normal timeouts and retry
behavior, recording attempts and retries. Alternate provider order, run from the
same environment, and keep warm-up separate. Increase concurrency toward actual
production needs gradually, within the intended request budget. A serial sample
cannot establish production capacity.

## Collect timings and quality evidence

Use a monotonic clock for first meaningful content or tool-call delta, excluding
role-only events, and for completion. Continue reading final usage/completion
frames. Track timeouts, incomplete streams, finish reasons and output length.
Record actual model, reported tier and request IDs if supplied. Requested tier is
not proof of the tier served; don't assume customer-specific fast aliases exist.

Check tools and structured output with the app's tests. For response quality,
inspect a consistent representative set against the same expected behavior;
check factual accuracy, grounding, task completion and verbosity. If a semantic
judge is useful, keep its rubric/model identical across providers and report it
separately from deterministic app checks. Speed alone doesn't establish quality.
For a voice app, also hear actual product lines and check interruption/recovery
with the existing framework's test/debugger facilities where available.

## Report a compact comparison

Use measured values in this shape; don't fill absent metrics with guesses:

| Metric | Current provider | Inworld |
|---|---|---|
| Model / reported serving tier | actual or unknown | actual or unknown |
| Median first response | measured ms | measured ms |
| P95 first response | measured ms and n | measured ms and n |
| Median completion | measured ms | measured ms |
| P95 completion | measured ms and n | measured ms and n |
| Cached input percentage | observed or unknown | observed or unknown |
| Successful requests | successes / attempts | successes / attempts |
| Quality / contract checks | passes / checks | passes / checks |
| Effective cost for the sample | measured/estimated/unknown | measured/estimated/unknown |

Then report: wins among completed request pairs, percent latency difference,
quality tradeoffs, and whether the evidence supports switching for this workload.
For a lower-is-better metric, percent reduction is
`100 * (baseline - candidate) / baseline`. State which baseline and metric it uses.
A negative reduction is slower, not a win. Don't average unrelated metric units
into a universal score. Show unsuccessful attempts alongside completed-pair
results; do not silently omit them. p95 from a small sample is exploratory.

Show exact-repeat vs next-turn response times as a diagnostic when cache behavior
or context growth explains a result. Keep cache misses in overall results, with
separate hit/miss breakdowns if useful. State where the script ran and which
settings changed. Distinguish application-observed from server-reported latency.

## Effective costs and the next step

Use verified current list/account prices and observed uncached input, cache
read/write and output tokens, respecting each provider's accounting semantics.
Don't double-count overlapping cache counters. Missing usage or rates are unknown,
not zero. Include peak/off-peak or tier pricing if relevant; project monthly spend
only with an explicit production volume and traffic mix. Separate list-price
estimates from measured/billed cost and keep failed-call charges unknown if absent.

If results are poor, first check model/version, streaming, request parameters,
cache usage, region, retries and serving tier. Explain the evidence and keep
request IDs for support; don't hide the initial result when showing a tuned rerun.
Once a measured benefit fits the app's quality requirements, offer the minimal
migration patch and rerun integration checks. Preserve a rollback configuration
and use the app's canary/deployment process for production traffic.
