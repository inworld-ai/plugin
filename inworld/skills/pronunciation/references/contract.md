# Saved dictionary contract

Sources: the public [custom pronunciations guide](https://docs.inworld.ai/tts/capabilities/pronunciation-dictionaries) and method references below. These are documented contracts, not evidence of a live API test. Creating, editing or deleting dictionaries requires the user's authorization; synthesis can incur charges.

## Management shapes verified in the supplied source

Same regional base for management and synthesis. Authentication is
`Authorization: Basic $INWORLD_API_KEY` with the copied key unchanged.
Let `collection = /pronunciations/v1/workspaces/{workspaceId}/pronunciationDictionaries`
and `resource = /pronunciations/v1/{full-returned-name}`.

| Action | Method/path | Payload or query |
| --- | --- | --- |
| Create | POST collection | JSON `displayName`, complete `pronunciations` array |
| Get | GET resource | Response includes `name`, `displayName`, `pronunciations`, `etag` |
| List | GET collection | Follow `nextPageToken` until empty; five dictionaries per page |
| Rename | PATCH resource | Query `updateMask=displayName`; JSON `displayName`, current `etag` |
| Replace entries | PATCH resource | Query `updateMask=pronunciations`; JSON complete `pronunciations`, current `etag` |
| Delete | DELETE resource | Query current `etag`; optional `allowMissing=true` still requires nonempty ETag |

The guide does not show the exact list array field or pagination request schema.
Consult [List](https://docs.inworld.ai/api-reference/pronunciationAPI/pronunciations/list-pronunciation-dictionaries)
before implementing a paginator; the helper deliberately has none. Other method
references: [Create](https://docs.inworld.ai/api-reference/pronunciationAPI/pronunciations/create-pronunciation-dictionary),
[Update](https://docs.inworld.ai/api-reference/pronunciationAPI/pronunciations/update-pronunciation-dictionary),
[Delete](https://docs.inworld.ai/api-reference/pronunciationAPI/pronunciations/delete-pronunciation-dictionary).
Do not invent per-entry CRUD, import, batch management, or validation methods.

Create example (tested subset in the primary guide, not a complete phone inventory):

```json
{"displayName":"Project terms","pronunciations":[{"displayHeadword":"Cat","languageCode":"en-US","phoneSymbols":["k","æ","t"]}]}
```

Language codes must be exact canonical palette codes: `en-US`, not `en-us`, `en`,
blank, or auto. Dictionary languages/phones differ from general TTS language
support. Preserve multi-character phones such as `oʊ` intact; only use stress
tokens supported by that language. Use returned phones after alias normalization.
Entries are one lexical token, not phrases or substring replacements. Duplicate
identities are rejected after language-aware canonicalization; do not implement
universal lowercasing as a substitute.

Limits: display name 1–64 Unicode code points, nonblank; 0–1,000 entries; encoded
dictionary 512 KiB; headword at most 128 code points; 1–64 phones per entry; at
most 16 code points per phone. Local JSON byte checks are only estimates of the
service's encoded-resource limit. Create/update validation is atomic. HTTP 400 /
INVALID_ARGUMENT details can identify snake_case fields and zero-based phone or
entry indices even when the request uses camelCase. Failed validation does not
partially save entries.

## Synthesis selectors

Workspace default: top-level `enable_custom_pronunciation: true` (equivalent
camelCase `enableCustomPronunciation`). Omitted or false disables lookup for a
new request/context. Use the key's workspace and same region, TTS-2 with explicit
matching language. Loading is best effort: speech can succeed without rewriting.

Named selection, placed in an existing otherwise valid request:

```json
{"pronunciationDictionarySettings":{"dictionaries":[{"dictionary":"workspaces/example/pronunciationDictionaries/project"}]}}
```

The example name is illustrative; use the exact full `name` returned by the
service, never a display name, bare ID, or Portal default ID. One to three distinct
names from the key's workspace, in priority order; first matching word/language
wins. Inline IPA takes precedence. An empty settings object/list is invalid.
**Omit both spellings of the workspace boolean entirely with named selection.**
No ETag is sent to synthesis, and names do not pin versions.

HTTP sync/stream/async: settings or boolean at request top level. Batch: inside
each item's `request`. WebSocket: inside `create` or `updateConfig`.
WebSocket named update replaces the whole selection; omission preserves it and
empty selection is rejected. To remove named selection or switch mode, finish
pending text, close the context, and create a new one. For selection updates,
finish pending text and wait for `contextUpdated`. Workspace update omission
preserves selection, false disables it.

Named sync errors: malformed/duplicate/cross-workspace selectors 400
INVALID_ARGUMENT; unavailable workspace/model/language 400 FAILED_PRECONDITION;
missing resource 404; load dependency 503; load deadline 504. Inspect in-stream
errors, completed async operation errors, every batch result, and WebSocket
`result.status` plus terminal connection errors; initial acceptance is insufficient.
