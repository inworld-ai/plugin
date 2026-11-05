---
name: pronunciation
description: "Create and test reusable pronunciation dictionaries for Inworld TTS. Use for brand names, specialist terms and consistent speech."
---

# Saved pronunciations

Plan and integrate saved Inworld TTS pronunciation dictionaries, including Portal workspace opt-in, named API dictionaries, safe replacement edits, and pronunciation listening checks. Use for reusable brand, name, or terminology pronunciations.

Keep the original written words in application text and select the right saved
dictionary. Work in the developer's existing app and fixtures; do not create a
dictionary service or assume an MCP dictionary tool exists.

## Choose the mechanism

| Need | Mechanism |
| --- | --- |
| One English word in one request | Inline `/IPA/`; see the existing `speakable-text` skill |
| Spell an ID character by character | `<verbatim>`; see `speakable-text` and its normalization requirements |
| Choose the language of a span | `<lang lang="es-ES">…</lang>` on TTS-2; this chooses language, not exact phones or a saved entry |
| Saved terms edited in Portal | Workspace dictionary, opt in with `enable_custom_pronunciation: true` |
| Reusable collections managed by the API | Named dictionaries, selected by full returned resource names |

Playground's session-only **Custom pronunciations** control rewrites inline IPA;
it does not save a dictionary. Portal's **Configure → Pronunciations** manages
the workspace default, which public CRUD cannot list or edit. Portal does not
list API-created named dictionaries.

## Establish prerequisites

Read [the contract](references/contract.md) before producing API requests. Record
the intended workspace and regional endpoint, dictionary type, voice, model,
explicit language, and evidence of feature availability. Use a Standard API key
from that workspace; never print the key or substitute an internal UUID.
Dictionary reads require Voices Read; writes require Voices Write.

Availability of management does not prove named synthesis is enabled. For named
selection use documented `inworld-tts-2` and a concrete supported language matching
the entries; do not infer Flash support from Portal behavior. Portal's workspace
dictionary supports Realtime TTS-2 and TTS-2 Flash. Confirm the relevant feature is
enabled in the region. If unavailable or unknown, prepare local changes and label
the blocked live check; do not simulate successful service validation.

## Author and preview safely

Use the selected language's Portal palette or Suggest IPA as a starting point,
then review whole phone tokens. `phoneSymbols` is an array, not a slash-delimited
string, whitespace-separated string, or Unicode-character split. There is no
public phone/language catalog or standalone validation endpoint. Local checks
cannot certify that a language, lexical token, or phone sequence is accepted.

For Portal, preview the proposed sequence and show the word/language/phones
before saving. Preview can use unsaved inline IPA and does not prove saved lookup.
Do not activate a microphone, generate paid previews, save, or delete by default.

For named resources, inspect the full current resource and ETag. Show a proposed
create body or read-modify-write diff, including all retained/removed entries.
Read [safe editing and listening](references/workflow.md). Execute saves and synthesis within the user's requested workflow and account;
do not ask again for routine steps already authorized. For a planning or local
implementation request, stop at reviewable local plans and offline checks.
Resolve unknown rights, account or material spending choices before acting.

Optional offline planner (Python standard library, no network or credentials):

```bash
python3 scripts/plan.py update current.json desired-entries.json
python3 scripts/plan.py rename current.json 'Project terms'
python3 scripts/plan.py selection names.json
```

Run from this skill directory, or resolve paths relative to it. `current.json` is
an existing get response, `desired-entries.json` the complete intended entry array,
and `names.json` an ordered array of full returned names. Output is a dry-run plan,
never an API call. Re-read and reconcile before later execution; plans can go stale.

## Integrate and verify

Inspect the app's final serialized request, including SDK defaults. Named settings
must never coexist with either spelling of the workspace boolean, **even false**.
Preserve the chosen names in order, maximum three distinct names from one workspace.
Keep per-job configuration local; do not change global settings or a live audio
session. For WebSockets, prefer a fresh context when changing dictionary mode.

Use existing app fixtures for an offline request-shape check, then the holdout
listening procedure in [workflow.md](references/workflow.md) only within explicit
paid/audio authorization. Report separately: local validation, service acceptance,
successful audio completion, and human listening. HTTP success alone proves none
of the pronunciation quality. Leave unrun checks explicit.
