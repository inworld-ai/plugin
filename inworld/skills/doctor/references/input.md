# Offline summary contract

Run from this installed skill's directory (the directory containing SKILL.md):

```sh
node scripts/inspect-config.mjs < redacted-summary.json
```

Use an explicit, redacted metadata file or pipe a constructed JSON object to
stdin. No file-path arguments are accepted. The helper reads only stdin, does
not read process environment/config/dotenv or contact any service, and never
echoes input strings. Exit 0 means inspection ran, **not** healthy. Exit 2 means
invalid input. Maximum CLI input is 64 KiB. Findings have `code`, `certainty`,
`message`, and `next`; certainty is `proven-from-input` or `needs-check`.

This is a normalized projection, not a direct request/config parser. Only `task`
is required. Omit unknown facts; do not replace unknown with false, zero, or an
inferred default. All fields reject null, wrong types, unknown names and enums.
No credentials, key IDs, free text errors, filenames, URLs, transcripts or audio
are accepted. Construct metadata without opening secret files. Even an
incorrectly supplied secret is never echoed in a parser error or report.

```json
{
  "task": "stt-stream",
  "auth": {
    "present": true,
    "credential": "one-time-token",
    "keyType": "standard",
    "transport": "bearer-subprotocol",
    "client": "browser",
    "reused": false
  },
  "audio": {
    "sourceKind": "raw-pcm",
    "encoding": "LINEAR16",
    "actualRateHz": 48000,
    "declaredRateHz": 16000,
    "actualChannels": 1,
    "declaredChannels": 1,
    "bitDepth": 16
  },
  "stt": { "diarization": true, "wordTimestamps": false }
}
```

The synthetic example proves a declared rate conflict and a timestamp conflict;
it does not prove actual microphone properties or API access.

| Section | Allowed fields and values |
| --- | --- |
| `task` | `stt-stream`, `stt-file` (sync), `stt-async`, `tts`, `realtime`, `voices-read`, `voice-write`, `router-read`, `router-write`, `llm`, `dictionary` |
| `auth` | `present`, `mintingToken`, `reused`, `expired`, `voiceWrite`, `routerWrite`: booleans. `credential`: `api-key`, `one-time-token`, `session-token`, `unknown`. `keyType`: `standard`, `realtime-only`, `unknown` (parent type for tokens). `transport`: `basic`, `bearer`, `bearer-subprotocol`, `query`, `unknown`. `query` means an **actual credential** in a URL, not an ordinary session identifier such as Realtime `key=<sid>`. `client`: `server`, `browser`, `unknown`. |
| `response` | `httpStatus`: integer 100–599; `grpcCode`: integer 0–16. Use only the failing request's status, not a different endpoint's successful result. |
| `audio` | `sourceKind`: `raw-pcm`, `container`, `unknown`. `encoding`: `LINEAR16`, `PCM`, `AUTO_DETECT`, `MP3`, `OGG_OPUS`, `FLAC`, `WEBM`, `WAV`, `MP4`, `MXF`, `MULAW`, `ALAW`, `unknown`. Nonnegative integers: `actualRateHz`, `declaredRateHz`, `playbackRateHz`, `actualChannels`, `declaredChannels`, `bitDepth`. Actual properties must come from source metadata or code, not a requested browser constraint. |
| `stt` | `diarization`, `wordTimestamps`: booleans mapping to the selected mode's flags. |
| `stream` | STT only. `closeStreamCount`: nonnegative integer. Booleans: `finishRequested`, `tailFlushed`, `endTurnBeforeClose` (immediately at shutdown, not an earlier manual turn), `socketClosedBeforeDrain`, `serverClosedNormally`, `usageReceived`, `errorObserved`, `drainTimedOut`, `microphoneReleased`, `interimAppended`, `interimPromotedToFinal`. Use a complete trace for absence claims. |
| `dictionary` | `workspaceSelectorPresent`: boolean indicating presence of `enable_custom_pronunciation` or `enableCustomPronunciation`, **even when its value is false**. `namedSelectorPresent`: boolean indicating presence of `pronunciationDictionarySettings`. Both present is a conflict, without an extra exclusivity flag. `inlineIpaPresent`: optional boolean for inline IPA in text; it can coexist with dictionary settings and takes precedence, so it never creates a selector conflict. This projection is checked for `dictionary` and `tts` tasks. ID/name/version inside named settings are not competing workspace selectors. |
| `tool` | `present`: boolean for the selected installed server's tools/list. `expectedFields`, `installedFields`, `expectedRequired`, `installedRequired`: arrays of property names (max 100; identifier syntax, max 80 chars). Strip descriptions/defaults and all example values before input. `rejectsUnknownFields`: true only if the actual schema rejects them. Lists describe a comparable schema level; this helper is not a recursive JSON Schema validator. |
| `feature` | `requested`: boolean; `support`: `supported`, `unsupported`, `unverified`, grounded in selected endpoint/model/version docs. It is supplied evidence, not capability detection. |

The helper does not resolve voice/dictionary IDs, inspect file headers, determine
key validity/scopes from key syntax, infer token expiry, validate arbitrary JSON
Schema, or discover current feature support. It never claims these checks passed.
