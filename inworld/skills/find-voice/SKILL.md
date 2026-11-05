---
name: find-voice
description: "Describe a voice and audition matches on your own script. Use for voice discovery, comparisons, custom voice design and delivery direction."
---

# Find a voice

Find the right Inworld voice from a description and let the user hear it in their own words before any code changes. Searches the voice library, auditions requested matches, and can design, save or integrate a voice within the requested workflow. Use when the user describes the voice they want ("a calm older British narrator", "upbeat support agent"), asks which voice to use, or wants to hear or compare voices, or wants contextual TTS Reasoning delivery.

Before calling tools, follow [installed tool availability](../connect/references/tool-availability.md).
Use the single Inworld connection and its actual schemas. If the host has
disabled a tool or loaded an older package, follow the availability guidance;
missing tools do not imply a missing API key.


If an audition is blocked by a missing account/key, follow
[connect](../connect/SKILL.md) and include its full host-specific tracked signup
link and key-setup next step in the final reply. An existing account only needs
key setup. Reuse the known auth result; do not try another authenticated voice
endpoint to rediscover the same missing key. Public browsing can continue, but
do not claim a requested audition was generated or heard.

For an audition, let the user hear real candidates saying a real app line, then
narrow down. For library browsing only, return matches without rendering clips.
A favorite selected during an audition is not by itself a request to publish or
edit the app. Carry out design, saving and integration when requested or already
authorized; do not ask again for routine steps within that scope.

## Step 1 — Get the brief

From $ARGUMENTS and the conversation, work out:

- **Who is speaking and to whom**: support agent, game character, narrator,
  tutor, companion. Check the codebase for a persona or system prompt.
- **How it should sound**: gender, age, accent, pace, tone, timbre.
- **Language and locale**: en-US, en-GB, es-MX... The accent is part of the locale.
- **A line to audition**: take one from their code (a greeting, a prompt
  template, an error message). A line the voice will actually say is worth more
  than any description.

Ask one question only if you can't infer the use case. Don't interrogate.

If the goal is to reproduce a real speaker from recordings, follow
[custom-voice](../custom-voice/SKILL.md) instead of designing a voice from text.
Keep the audition brief and real app lines from this step.

## Step 2 — Search and listen

The default Inworld connection includes `find_voices` and `compare_voices`.
Use the search below. In an older or tool-filtered session without those tools,
core catalog/synthesis tools can still provide a limited fallback:

1. Call `list_voices` using `description_match` for the user's descriptive
   keywords and `language` when known (ISO 639-1, e.g. `en`). Description matching
   is case-insensitive ANY-substring matching, not semantic ranking or a guarantee
   that every requested attribute matches. Read the returned descriptions and
   explain any mismatch. Avoid tag filters when voices have no tags.
2. For browsing only, return the shortlist without synthesis. For a requested
   audition, call `synthesize_speech` once per selected candidate with the same
   real app line, returned `voice_id`, selected `model_id` and distinct absolute
   `output_file`. Keep the requested scope and attempt budget; retain failures
   rather than retrying. Use the native audio presentation below.
3. Narrow the shortlist with feedback. With no `compare_voices` tool, compare the
   saved core clips or synthesize the specifically requested revision; do not
   call a tool that is not installed. Core synthesis does not expose the lab's
   Reasoning controls. Do not claim a Reasoning A/B experiment was performed.

When `find_voices` is available:

- Put fixed attributes in the filters: `gender`, `age_group`, `language`,
  `categories` (companions, enterprise, education_training,
  developer_assistants, healthcare, interactive_media).
- Put everything else in `query` in the user's words (warm, raspy, upbeat,
  narrator, Australian).
- For requested auditions, pass `audition_line` so the top four render straight
  away. Omit it for browsing-only requests.

Show matches as a short list (voiceId and description). In Codex, embed each saved
clip in the final answer using `![A: voice name](/absolute/path/to/clip.mp3)`,
not an ordinary link or a code block. Use returned `playbackMarkdown` when present.
This native media rendering was user-tested; other hosts may differ. If no player
renders, offer the host's file preview. Follow the tool's playback instructions. Ask which is closest and what's off
("warmer", "slower", "less formal").

## Step 3 — Narrow down

- Close but not right → run `find_voices` again with the feedback folded into
  `query`, or `compare_voices` with specific IDs.
- Tone right, delivery wrong → it may be steering, not the voice. Try
  `compare_voices` with the same voice and a steered line, e.g.
  `[say warmly and a little slower] ...` (inworld-tts-2 only).
- Want to compare against something that doesn't exist yet → `compare_voices`
  with `designs: ["<description>"]` renders a one-off designed voice next to the
  library voices.

### Try TTS Reasoning when delivery depends on the scene

For contextual delivery, `compare_voices` accepts `reasoning: "on"` and optional
`reasoning_context` (scene/character notes, at most 600 characters). This uses
`inworld-tts-2` and requires workspace feature enablement; Flash does not support it.
For a listening comparison, pass `compare_reasoning: true`, one or two discovered
voice IDs, and the same unmodified app line. Omit `reasoning` in comparison mode.
This makes two clips per voice with the same model, text and delivery setting
(default CREATIVE for both). It does not publish voices or edit configuration.

Read each clip's `reasoningInstruction` and `requestDurationMs` and present the
native players with the condition labels. Workspace-default is **not guaranteed
Reasoning off**: opted-in workspaces can reason by default. An absent instruction
can mean abstention, fallback or no enablement; do not claim Reasoning ran.
Request duration is complete HTTP synthesis time, not first audio or playback
latency. Keep raw usage; do not infer a surcharge. Let the user judge delivery.

Use [Reasoning integration notes](references/tts-reasoning.md) when wiring it
into the app. `synthesize_speech` does not expose these controls; use `compare_voices` on
the same Inworld connection or the app’s HTTP client.

## Step 4 — Design one if nothing fits

When designing is requested, call the registered `design_voice` with a
specific description (gender and age, accent, pitch and pace, tone, timbre) and a `script` written in the character's voice, since
the script shapes the voice. Use `language` for accent (en-GB, en-AU). It
returns up to three previews. Once the user picks one, use the selected server’s
fully qualified `publish_voice` and its actual schema
with a display name and a few style tags if saving or integration is requested
or already authorized. Do not switch servers merely because the short name matches. For audition-only work, report the preview and its
temporary status without publishing.

If design says the key can't save voices, the previews were rendered
listen-only. Relay the permission fix from the tool result exactly.

## Step 5 — Wire it in

For requested or already authorized integration, put the chosen voiceId in config
(env var or constants module) rather than scattering it through the code, and note the model (`inworld-tts-2` for
steering, `inworld-tts-2-flash` for the lowest latency). If the project isn't
set up for Inworld yet and integration is in scope, hand off to `/inworld:setup`.
For browsing or audition only, report the selection without config edits or setup.

## Test the voice in the product

Before calling the integration finished, use actual product utterances: greeting,
a correction/error, a name or exact alphanumeric ID, and relevant language/locale.
Use `speakable-text` for verbatim tags, pronunciation and cleanup, then `latency`
when responsiveness matters. Separate voice preference, delivery settings and
pipeline delay. If the app also needs an LLM, offer `benchmark-models` using its
existing prompt/client; keep the chosen voice fixed while comparing replies.


For OpenClaw native attachments, Cursor file previews and other hosts, follow
[native audio presentation](references/playback.md).
