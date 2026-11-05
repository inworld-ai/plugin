---
name: generate-image
description: "Generate or edit images with Inworld's image models. Use for text-to-image, reference-guided edits and requested output comparisons."
---

# Generate images

Generate or edit images through Inworld, browse image models, or compare requested image outputs. Use for image creation and reference-guided edits, not image analysis or video jobs.

Before calling tools, follow [installed tool availability](../connect/references/tool-availability.md).
Use the single Inworld connection and its actual schemas. If the host has
disabled a tool or loaded an older package, follow the availability guidance;
missing tools do not imply a missing API key.


Use the Inworld media tools available in the current Claude or Codex host. Inspect
their actual schemas; if a tool is unavailable, explain the gap without claiming
it ran. Do not require a setup ritual before browsing models or preparing a prompt.

## Choose the result

Use the task and context already provided: purpose, subject, composition, style,
exact text and its language, output shape/size, and what an edit must preserve.
Ask only for missing details that materially affect the result. Preserve the user's
language and wording for visible text; do not silently translate it.

Browse with `list_media_models(output_modality: "image", query?, limit?)`.
Select an image-output model, not merely one with vision input. Respect an explicit
model choice and check its reference and setting support. Model browsing alone
must never trigger a generation. If catalog access requires credentials, use the
public [model catalog](https://inworld.ai/models) for browsing; the underlying
Models API requires authentication. Do not treat a missing generation credential
as proof that public browsing is unavailable.

Briefly state the chosen model, prompt intent, settings and cost basis before a
paid call. Use verified current rates when available; otherwise label cost
unknown. Do not claim exact prices or zero cost from missing pricing fields.
A generation request authorizes its requested scope, not paid multi-model trials.

## Generate or edit

Call `generate_image(model, prompt, reference_files, image_config)` using the
installed schema's optionality. Pass local PNG, JPEG or WebP paths in
`reference_files`; check that file contents and extensions match. The tool sends
inline image bytes. A remote image URL is not an image-generation reference;
obtain an authorized local copy first. Explain preservation and changes in the
prompt and resend the reference for each edit that needs it.

Use only settings supported by the selected model. Read
[settings and sources](references/settings.md) when choosing explicit dimensions
or editing with references. Do not invent generic quality, strength or seed knobs.
Never upload a local image to public storage or create a sharing link implicitly.
For image-to-video handoff, a saved image path is insufficient: video needs a
provider-accessible HTTPS URL. Explain the storage gap and obtain explicit upload
or sharing authorization before using a suitable storage mechanism.

Save every final image returned by the tool, using the actual format and returned
paths. If the tool returns bytes or a URL rather than a saved file, save the real
content with available host file tools. Inspect it when the host supports image
viewing; otherwise state that visual quality was not inspected. Empty text alone
is not failure if an image was returned. Never present sample data, a preview or
an imagined result as a finished image. On timeout or ambiguous failure, report
uncertainty and possible charge; do not automatically resubmit a paid generation.
On explicit auth failure, explain the credential/permission needed without
printing secrets or changing global configuration.
When a missing account/key blocks requested generation, follow
[connect](../connect/SKILL.md) and include its full host-specific tracked signup
link and key-setup next step in the final reply. For an existing account, link
the API Keys page instead. Reuse known auth state; public browsing and prompt
preparation can continue without another failing API probe.

## Deliver and compare

Link the actual saved files and summarize model, exact prompt (including text
language), reference paths, requested/returned settings and known usage/cost.
Distinguish requested dimensions from verified output dimensions. Preview only
where the host supports it; mention visible defects and any unverified details.

Run paid comparisons only when requested, within the requested models and count.
Keep prompts, references and supported output settings the same; disclose any
model-specific mapping or incompatibility rather than silently changing the task.
Show the real outputs and assess adherence, text accuracy, composition, artifacts,
latency and cost separately. Attribute observed strengths and failures fairly;
one sample does not establish a general quality ranking or an Inworld advantage.
