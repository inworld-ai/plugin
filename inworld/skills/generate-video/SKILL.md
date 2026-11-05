---
name: generate-video
description: "Generate videos and manage existing Inworld video jobs. Use for text or reference inputs, status checks, cancellation and downloads."
---

# Generate videos

Create Inworld video jobs from text, frames or references; check, list, cancel on request, and download existing jobs. Use for video generation and job management, not still-image generation.

Before calling tools, follow [installed tool availability](../connect/references/tool-availability.md).
Use the single Inworld connection and its actual schemas. If the host has
disabled a tool or loaded an older package, follow the availability guidance;
missing tools do not imply a missing API key.


Use available Inworld media tools in Claude or Codex, inspecting their installed
schemas. Do not claim an unavailable tool ran. Route browse, status, list and
download requests directly to those actions; they must not create a video or
require a generation setup ritual. Public model browsing works without a key at
[inworld.ai/models](https://inworld.ai/models); the underlying Models API and
video-job API require authentication. Diagnose actual auth errors per action,
without exposing credentials or changing global settings.
If missing credentials block the requested action, give the next connection step
from [connect](../connect/SKILL.md) in the final response. For an existing job or
account, link https://platform.inworld.ai/api-keys and keep its job ID; do not
require another signup or create a replacement job. For a new user requesting
generation, include connect's full host-specific tracked signup link. Reuse an
already observed auth result instead of repeating it.

## Prepare a new video

Reuse known task context: subject, action, camera/motion, style, visible text and
its language, sound/dialogue language if requested, duration, resolution and
aspect ratio. Preserve exact requested wording. Browse with
`list_media_models(output_modality: "video", query?, limit?)`; select a live model
supporting the desired inputs and settings. Do not promise exact dialogue, text
rendering or other quality that has not been observed.

State model, prompt intent, settings and verified cost basis before creating.
Rates vary by model/resolution and may include input costs; keep unknown prices
unknown. Do not automatically run paid alternatives or multi-model benchmarks.
Video generation requires a payment method on the account. Catalog or key access
does not establish billing eligibility. For a payment-required failure, point to
https://platform.inworld.ai/billing; do not replace the key or resubmit generation
as a billing workaround.

Read [references and lifecycle](references/lifecycle.md) before frame/reference
input or job recovery. `frame_images` and `input_references` are mutually
exclusive. Video inputs require HTTPS URLs on public hosts, downloadable without
browser sessions or extra auth headers; local paths and inline data are invalid.
There is no upload tool in this media toolset. Explain the storage gap if only
local files exist, including an image just generated locally. Never implicitly
upload, publish or publicly share them. Use a user-provided suitable URL or an
explicitly authorized storage workflow; signed read-only URLs still disclose the
reference to the model provider. Do not silently drop references or change modes.

## Create once, preserve identity

Before the first `create_video`, generate a UUID and persist it as the required
`idempotency_key` in a private local job manifest that survives restarts. Store
the exact prompt/language, model, settings, reference identities, timestamp and
request state; use restrictive access and keep signed URLs out of shared files.
If replay requires URLs, store them only in protected local state.

Call `create_video(model, prompt, seconds, resolution, aspect_ratio,
frame_images, input_references, idempotency_key)` with only applicable fields per
the installed schema. Immediately persist the returned `video_id`, actual
parameters/status, operation if returned, and later errors, expiry and saved paths.
A queued job is not a finished video. Resume from this manifest after interruption.

Never regenerate because a job is pending or a client timed out. With a known
ID, use `get_video(video_id)`. If creation's outcome is unknown and no ID was
received, a bounded retry must reuse the stored key and same request; do not
invent a new key. Check retention before replaying old requests: deletion or
automatic removal releases the key and can make even a same-key create paid anew.
Stop ambiguous old replays for reconciliation rather than risk duplication.

The tool has no prior-manifest argument and does not reload saved manifests.
Its payload checks and uncertainty history cover only the current process;
`has_uncertain_submission: false` does not rule out an earlier process's attempt.
After restart, read only the selected original manifest and preserve its exact
key, payload and uncertainty. Replay still requires current catalog validation.
If that fails, `not_submitted` describes only this invocation: keep the original
uncertain outcome and stop for reconciliation, without changing the key/payload
or bypassing the catalog. Same-process uncertain replay can reuse its previously
verified payload without a fresh catalog check.

## Follow or manage jobs

Each `get_video(video_id)` is a single status check. For “check status”, call once.
When asked to generate and wait, poll sequentially at 10–20 second intervals,
respecting server backoff. Use a bounded wait (default 10 minutes for this skill,
not a service timeout), save state, then report pending with ID and manifest path.
Do not start overlapping polls, busy-loop, fabricate progress percentages, cancel
on wait expiry, or create a replacement. Resume the same ID on a later request.
Stop polling on `completed`, `failed` or `cancelled`; report real errors.

For history, `list_videos(after?, limit?)` uses `limit` 1–100 (default 20).
Paginate with response `last_id` as `after` while `has_more`; retrieve a completed
job for its download link. Lists omit expired completed jobs and are not history
storage. Call `cancel_video(video_id)` only when cancellation is requested.
A queued status does not guarantee cancellability; report `video_not_cancellable`
without repeated cancel attempts. No automatic deletion or replacement.

## Save and report

On completion call `download_video(video_id)` and verify the MP4 is saved; record
and link the actual local path. Do not promise a file if download failed. Treat
signed input/output URLs as secrets: omit them from chat, shared manifests and
logs. Output links expire; refresh with `get_video` while the video is retained,
then retry download, never generation. See the reference for retention limits.

Report job ID/status, saved MP4 and manifest paths, model, exact prompt/language,
settings, known cost and errors. Preview only where the host supports playback;
otherwise offer the file and state visual/audio inspection limits. For explicitly
requested comparisons, keep prompts, references and supported settings the same,
disclose incompatibilities, and compare real outputs for motion/coherence,
adherence, text/audio accuracy, latency and cost. Report defects and losses as
plainly as strengths; no unsupported model ranking or biased provider claims.
