# Image settings and source notes

Verified against official documentation snapshots reviewed **2026-10-17**.
These are documentation facts, not executed requests. Refresh model availability,
capabilities and rates when needed.

- Image generation uses Chat Completions with image output; the media tool owns
  request construction. Do not substitute a speculative images endpoint.
- Google: `image_config.aspect_ratio` selects supported shapes; it is not
  forwarded with reference images. `image_config.image_size` selects supported
  tiers such as `1K` or `2K`, depending on the model.
- OpenAI: use supported pixel dimensions in `image_config.image_size`, such as
  `1024x1024`; `aspect_ratio` does not control its output. These examples are not
  universal allowed-value lists.
- References are PNG/JPEG/WebP bytes encoded as data URLs in a user message.
  Remote URLs are not used as references by this generation path. Accepted
  formats still depend on the chosen model.
- Raw final images appear at `choices[].message.images[].image_url.url`, as
  inline data or download URLs. Save actual bytes with the matching media type.
  An empty text field can accompany successful image output. A progressive
  preview is not an extra final image.
- Costs depend on model, settings, input and output, including references where
  charged. Missing prices are unknown. Image calls lack the documented video
  job/idempotency recovery flow; a timeout does not prove generation stopped.

Official sources (reviewed **2026-10-17**):

- [Image generation](https://docs.inworld.ai/router/image-generation.md)
- [List models](https://docs.inworld.ai/api-reference/modelsAPI/modelservice/list-models.md)
- [Public model catalog](https://inworld.ai/models)
  — usable without an API key.

The image guide links the [Chat Completions reference](https://docs.inworld.ai/api-reference/routerAPI/chat-completions.md)
for additional settings. Check the selected model and installed tool schema before using an option not covered here; an API parameter is not necessarily exposed by this plugin tool.
