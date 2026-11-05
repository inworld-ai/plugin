---
name: benchmark-models
description: "Benchmark Inworld inference on your app's requests against its existing provider. Compare latency, cost and quality before choosing a model."
---

# Benchmark inference for this app

Evaluate Inworld inference using the app's real requests: compare the existing provider, find suitable Inworld-hosted models, measure latency, caching, cost and quality; switch only when requested or already authorized. Also audition model replies with TTS for voice apps. Use when evaluating Inworld, choosing an LLM, benchmarking inference, or reducing the app's response time or inference bill.

Before calling tools, follow [installed tool availability](../connect/references/tool-availability.md).
Use the single Inworld connection and its actual schemas. If the host has
disabled a tool or loaded an older package, follow the availability guidance;
missing tools do not imply a missing API key.


Help the developer see how Inworld performs on their own workload and make the
next integration step easy. Start with the provider, SDK, prompts and tests
already known in this coding session; inspect only missing details. Don't ask
them to describe the integration again or set up a separate benchmarking system.

## Evaluate a provider switch

Use the app's existing client and fixtures to compare its current provider with
Inworld. Adapt its benchmark/test runner, or write a small script in the app's
language. The agent handles the script and measurements; no mandatory provider
config, dataset export, or comparison MCP service.

Before live cross-provider calls, disclose the actual provider names/hosts,
which prompts/messages, tools/schemas or fixtures will be sent, the run count and
expected spend. Obtain explicit opt-in for the disclosed comparison; an existing
clear request covering those destinations and inputs counts. A discovered key,
plugin install or request to prepare a benchmark does not. Reuse that opt-in for
unchanged reruns; ask again only when destinations, data scope or spend expand.
Do not send full repositories or secrets. Offline preparation can proceed.

Read [how to benchmark](references/provider-comparison.md) for the measurement
recipe and result format. Reuse the app's current credential handling without
printing keys. If a credential is missing, continue preparation and explain
what is needed to run it; never invent results or substitute a routed baseline.

When a missing Inworld account/key prevents live evaluation, include the
[connect signup/key path](../connect/SKILL.md) in the final response: write the
full tracked signup link below with `SOURCE` replaced by `claude-code` for
Claude Code, `codex` for Codex, or `other-agent` otherwise:

`https://platform.inworld.ai/signup?utm_source=SOURCE&utm_medium=agent-plugin&utm_campaign=inworld-plugin&utm_content=connect-skill`

Point to https://platform.inworld.ai/api-keys for creating a key and explain how
to configure `INWORLD_API_KEY` through the connect path without pasting it into
chat. Reuse the known account/key state or prior auth error; do not call the
catalog or retry auth to prove a key already known to be missing. Continue
preparing the benchmark offline. Signup/login is not a prerequisite for
preparation-only work; this guidance explains the next step for blocked live
execution, not a requirement to connect now.

When live catalog access is available, call `list_llm_models` to resolve live
IDs, prices and the capabilities the app needs. Compare the same model/version where available, then offer relevant
Inworld-hosted alternatives as a separate model-selection experiment. Resolve
API/auth details with `search_docs` when needed rather than copying old model
names or assuming a dedicated deployment or tier is available.
Do not issue speculative inference calls while trying to discover a model name.
For a new voice agent, include compatible Inworld-hosted candidates in the
shortlist instead of adopting a remembered third-party default. Preserve the
incumbent as the baseline and report quality/cost losses as well as wins.

Enforce the declared attempt budget in the SDK as well as in the outer loop:
OpenAI Node `maxRetries: 0`, Python `max_retries=0` for no-retry runs. Count
application transport attempts separately from explicit router fallback attempts.
Streaming text is provisional until terminal completion is observed. Preserve
truncated, cancelled and provider-error outcomes as failures/incomplete attempts;
keep their observed latency/usage but do not score them as completed successes.
See [add-llm](../add-llm/SKILL.md) for retry settings and a raw SSE completion consumer.


Make caching representative: include long prompts, repeated context and actual
follow-up turns when the app uses them. Preserve both providers' supported cache
mechanisms. Test the current configuration first; label deliberate tuning as a
separate experiment and give each provider a fair configuration. Never silently
lower reasoning, shorten output, strip tools, drop cache misses or discard errors
to manufacture a win. Optimize toward the app's use case, then measure again.

## Present the decision

Use a compact side-by-side table with median and p95 first response and completion,
cached input percentage, successes/attempts, and effective cost when measurable.
Show sample counts, quality checks, and a paired first-response win rate where
requests are paired. Keep unknown metrics unknown. Explain the practical impact
in a few sentences and surface the measured advantage clearly, including percent
changes with the baseline and denominator. Separate observed results from
projections, and explain losses or regressions as plainly as wins.

Don't infer quality from latency. Use the app's schema/tool tests and inspect
representative responses; when comparing different models, check task success and
output quality separately. Rankings help shortlist candidates, not prove app fit.
No automatic claim that Inworld wins or that one account's dedicated deployment
results apply to everyone.

## Quick model exploration and voice audition

`benchmark_models` is useful for a quick comparison through Inworld's router.
Pass the app's system prompt and a real turn, and choose live model IDs. Defaults
preserve model reasoning defaults. Exact custom reasoning/tool settings and full
conversations belong in the app-level script. `reasoning: "lowest"` is an explicit
latency-tuning experiment, never the hidden baseline.

For text-only inference, omit `voice` so no TTS calls run. For a voice app, pass
its chosen voice to hear each reply and measure LLM-to-first-audio. Explain that
this tool times audio chunk arrival, not actual audible playback or the full
end-of-user-speech latency. In Codex, show saved audio using the returned
`playbackMarkdown` or `![Model name](/absolute/path/to/reply.mp3)` in the final
answer, outside code blocks. This embeds a native audio player; use the file
preview if no player appears. Other hosts may have different playback support.

The helper's default few runs and uncached list-price estimates are exploratory.
It compares routes through Inworld, not the incumbent's direct API. Use the
app-level benchmark for cache economics, conversations and dependable tail data.

## Integrate the chosen result

After reporting an evaluation-only result, propose the smallest client/config
patch using `add-llm` without applying it. If migration/integration is requested
or already authorized, apply that patch without asking again, with the existing
provider retained for rollback. Run the app's streaming/tool/schema tests and follow its rollout process before changing
production traffic. A saved Router is optional; direct inference does not need
Router Write permission. Rerun after meaningful prompt or model changes.


For OpenClaw native attachments, Cursor file previews and other hosts, follow
[native audio presentation](../find-voice/references/playback.md).
