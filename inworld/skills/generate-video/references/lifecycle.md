# Video references and recovery

Documentation checked **2026-10-17** against official documentation snapshots;
no generation or account access was tested.
Use current model capabilities and the installed tool schema, not an assumed
universal parameter range. The toolset has no media upload or delete action.

## Inputs

- `frame_images`: items shaped as
  `{"type":"image_url","image_url":{"url":"https://…"},"frame_type":"first_frame"}`.
  At most one first and one last frame; a last frame requires a first and model
  support. Omit `aspect_ratio` or use `adaptive` so the first frame sets shape.
- `input_references`: items use `type: image_url`, `video_url` or `audio_url`,
  with the corresponding nested field containing `url`. Check per-model type,
  count and duration limits. Never combine this array with `frame_images`.
  Number each type separately in prompts: Image 1, Video 1, Audio 1.
- URLs must be HTTPS, on public hosts, at most 4,096 bytes and accessible without
  session cookies or extra authentication headers. No local paths, localhost,
  private hosts, or base64 data URLs. A public host does not require a permanently
  public bucket: a suitable signed URL can work, but grants its bearer access.
- Prefer short-lived read-only input URLs valid at least an hour (a recommendation,
  not validation). Providers download references when generation starts. The API's
  URL validation alone does not verify usable image/audio content.
- Video references must be MP4/MOV, at most 100 MB, within model length limits;
  their combined download must finish within 60 seconds at creation. If the host
  exposes a create timeout, allow at least 90 seconds for these requests. A client
  timeout still requires same-key recovery, not a new generation.

## Identity, errors and expiry

- Idempotency applies while the original workspace job is retained and not deleted.
  The service does not compare request bodies: a reused key with a changed prompt
  returns the original job. Store the prompt yourself; jobs do not return it.
- A refused `400` or `429` create starts nothing and does not consume the key.
  Correct the documented cause or back off, preserving the key. For
  `idempotency_key_in_use` (`409`), wait and retry with that same key within a
  bounded recovery budget. Respect `Retry-After` when supplied. A practical skill
  default is at most two recovery retries, then persist and report uncertainty.
- `401`/`403` indicate credential/permission problems. Errors may be plain text;
  do not assume every failure body is JSON. Missing payment method or unsupported
  zero data retention is an explicit create error, not a model-discovery failure.
- `failed` is terminal: record `error.code` and message. A corrected new job is
  a new generation requiring user intent; do not automatically replace it.
- Cancellation can fail with `409 video_not_cancellable` even while queued.
  Confirm cancellation only from the actual response. Successful cancellation
  before generation is not billed; a job that proceeds and completes is billed.
- Completed videos are downloadable for 7 days, until `expires_at`. Output signed
  URLs last up to one hour, capped by that deadline (`url_expires_at`). Retrieve
  again for a fresh link before job expiry. Anyone holding a link can download;
  never send the API Authorization header to the signed storage URL.
- After video expiry, retrieval may return `completed` without output until job
  cleanup, then `404`. Refreshing cannot recover expired bytes. Lists omit expired
  completed jobs. Preserve the local MP4 and manifest rather than depend on them.
- Only completed jobs are billed under these docs. Rates depend on model,
  resolution, delivered seconds and applicable inputs; no universal price is
  implied. Use the current catalog and actual usage, distinguishing estimates
  from measured charges.

## Official sources — reviewed 2026-10-17

- [Video generation](https://docs.inworld.ai/router/video-generation.md)
- [Image-to-video](https://docs.inworld.ai/router/image-to-video.md)
- [Reference-to-video](https://docs.inworld.ai/router/reference-to-video.md)
- [Create video](https://docs.inworld.ai/api-reference/videoAPI/create-video.md)
- [Retrieve video](https://docs.inworld.ai/api-reference/videoAPI/retrieve-video.md)
- [List videos](https://docs.inworld.ai/api-reference/videoAPI/list-videos.md)
- [Cancel video](https://docs.inworld.ai/api-reference/videoAPI/cancel-video.md)
- [List models](https://docs.inworld.ai/api-reference/modelsAPI/modelservice/list-models.md)
- [Public model catalog](https://inworld.ai/models)

These sources document HTTP behavior; the media MCP tool names and required key
come from the plugin contract, not a claim that
these tools were executed. No third-party service is required.
