---
name: test-voice
description: "Catch speech regressions across voice, model, pronunciation and delivery changes. Use for frozen test lines, listening evidence and offline reports."
---

# Test the app's voice

Check an app's TTS voice for regressions across model, voice, pronunciation, normalization or delivery changes using frozen utterances, listening evidence and offline result comparison.

Before calling tools, follow [installed tool availability](../connect/references/tool-availability.md).
Use the single Inworld connection and its actual schemas. If the host has
disabled a tool or loaded an older package, follow the availability guidance;
missing tools do not imply a missing API key.


Use the developer's existing app, TTS adapter and fixtures. Make a small local
regression set rather than a new service. This workflow can prepare a test plan
and compare saved results entirely offline. Creating a plan does not authorize
paid synthesis, voice training, publishing, API writes or live-session audio.

## Freeze what matters

Read the TTS call site, template/prompt and current request settings. Select
actual sanitized utterances from the app: names and product terms, digits and
amounts, short IDs with `<verbatim>`, relevant languages with `<lang>`, pauses
and a complete final sentence after a pause. Include the greeting and recovery
path that users hear most. Keep a source pointer and a human-written expected
reading for each case; markup appearing in the input does not prove its effect.

Copy [assets/manifest.json](assets/manifest.json) into the app's existing fixture
area as a starting point. Its examples are synthetic, not evidence of app
coverage. Replace them with app utterances and language-specific expectations.
Separate tuning from held-out cases **before** adjusting a dictionary, text
cleaner or prompt. Freeze the held-out text and checks; after tuning against a
held-out failure, retain it as a regression fixture and add fresh held-out cases.

Record the exact model ID/revision if exposed, voice ID/revision, language,
normalization (including unset/default), dictionary ID + immutable version or
content hash (explicit `none` if unused), app revision, output format and all
effective request options. Include delivery, speed, transport, streaming flush
behavior, seed if supported, region, SDK and measurement instrumentation as
applicable. Mutable IDs alone cannot reproduce a run; unknown versions remain
a stated limitation. Don't read credentials or change global settings to do this.

Declare only the intended config changes in the manifest. Fix other settings
and use paired utterances on each side. For multilingual suites the per-case
language is authoritative; the run-level language names the default/mapping
policy. Capture per-case overrides in the frozen manifest. For model aliases
without pinned revisions, record collection times and the limitation.

For a contextual TTS Reasoning experiment, follow
[Reasoning integration notes](../find-voice/references/tts-reasoning.md). Capture
requested mode, optional context, workspace default and returned instruction in
the run settings/evidence. Compare the same voice, model, text and delivery mode;
workspace-default is not a guaranteed off condition. Keep a real human listening
verdict separate from generation success and request duration. The plugin's
`compare_reasoning` audition can prepare these clips, but does not prove the
app's full transport or every fixture setting was exercised.

## Collect or import evidence

Prefer saved app renders. Adapt the app's existing fixture runner to the
[record contract](references/records.md) without replacing its transport. Keep
errors, incomplete streams, skipped cases and all attempt counts; retries are
not free successes. Set request/time/cost bounds before any separately authorized
render run, stop on auth/rate-limit/unknown-billing failures, and don't retry
automatically. This skill's helper never calls an API or plays audio.

Optional existing tools: `check_speech_text` without `listen_voice` is a static
check; `compare_voices` produces billable clips when available and authorized.
Inspect its actual schema first: the bundled tool has a 500-character limit and
does not expose every language/normalization/dictionary setting. Use it only
when it can reproduce the required configuration; otherwise use the app's
runner. Don't silently accept truncation/default voices, design a voice, or
claim the tool exercised options it doesn't accept. For saved audio, use the
host's available playback at the user's chosen time; don't route clips into a
live call or meeting. Tool availability is not authorization to spend.

Listen to paired clips using the [listening protocol](references/listening.md).
Record each named check with listener, audio reference and specific observations.
An unheard clip has unknown semantic quality. STT may flag suspicious digits or
omissions for review; it cannot certify pronunciation, naturalness, prosody,
speaker identity or semantic correctness. Do not use bitwise audio goldens:
generative audio varies even with the same inputs.

## Compare locally and report

Read [references/records.md](references/records.md) when preparing JSON records.
From this skill directory:

```sh
python3 scripts/compare.py app-manifest.json --hash
python3 scripts/compare.py app-manifest.json baseline.json candidate.json > comparison.json
```

The hash binds both runs to the same frozen manifest (including expectations,
metric definitions and tolerances). Do not rehash old results to disguise a
changed test set. The comparator rejects malformed records, reports unplanned
config differences, retains missing/failing cases and lists metrics it cannot
score. A simulated input always makes the verdict inconclusive. Exit codes:
0 = no regression observed in supplied evidence; 1 = regression; 2 = inconclusive
or invalid input. Inspect JSON/stderr; do not treat a report file's existence as
success.

Report attempted/succeeded/failed/incomplete/skipped/missing counts and retries
on each side, separated by held-out/tuning and language. Show config changes,
named listening failures, metric deltas and unknowns, with artifact pointers.
State whether evidence was simulated, static-only, imported or freshly rendered,
and whether someone actually listened. Numeric timing/usage is diagnostic, not
a semantic quality score. Don't invent cost or acoustic measurements; optional
missing metrics remain unknown. Keep existing baseline defects visible. Give
the smallest supported recommendation and its coverage limits; don't declare
production readiness from a small passing set.

Current feature references (checked 2026-10-17):
[verbatim](https://docs.inworld.ai/tts/capabilities/verbatim),
[language tags](https://docs.inworld.ai/tts/capabilities/language-tags),
[synthesis options](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech).
Verbatim requires normalization and uses English-oriented character expansion;
language tags are documented for TTS-2. Recheck current docs for the selected
model/endpoint before making compatibility claims.
