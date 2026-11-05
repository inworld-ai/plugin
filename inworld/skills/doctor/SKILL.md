---
name: doctor
description: "Check Inworld configuration offline before making API calls. Use to inspect credentials, permissions, audio formats and streaming setup."
---

# Inworld doctor

Diagnose task-specific Inworld integration configuration offline, including credentials and permissions, audio formats, STT shutdown, dictionary selectors, and installed tool schema gaps. Use for configuration checks before API reproduction or support escalation.

Before calling tools, follow [installed tool availability](../connect/references/tool-availability.md).
Use the single Inworld connection and its actual schemas. If the host has
disabled a tool or loaded an older package, follow the availability guidance;
missing tools do not imply a missing API key.


Start with the developer's actual task, failing mode/endpoint, expected outcome,
and a sanitized error/status. Inspect the relevant app code and existing fixtures
read-only. Separate what the local code proves from what needs service access or
real audio. Do not build a diagnostic service or register another MCP tool.

## Check the selected task

Use only the applicable checks in [checks.md](references/checks.md). Read the
installed tool's advertised schema before suggesting fields; local source and
online docs can be newer than the running server. Existing troubleshoot advice
is not an authority when it conflicts with current primary docs or maintained
STT assets. Never infer bad credentials from a missing tool, missing credentials
from a 403, or native support from another vendor's feature list.

For repeatable offline inspection, construct the normalized metadata in
[input.md](references/input.md) from already redacted evidence, then run:

```sh
node <doctor-skill-dir>/scripts/inspect-config.mjs < redacted-summary.json
```

Do not feed this helper raw app/MCP configuration, request headers, URLs,
recordings or environment dumps. It accepts stdin only, never discovers files or
reads dotenv/environment values, never mutates config, and never calls the API.
Presence booleans and key/token *types* suffice: do not read, print, decode, hash,
or ask the user to paste secret values. The input contract is a diagnostic summary,
not Inworld wire JSON. Unknown fields are rejected without echoing them. Omitted
evidence stays unknown; a report without conflicts is not a health certificate.

Use the existing app/fixtures for any suggested reproduction, and the maintained
[STT assets](../add-streaming-stt/SKILL.md) for transport/lifecycle comparison.
For an optional **offline** text check, `check_speech_text` can run without a key:
omit `listen_voice`. Omit `audition_line` from voice search as well; either option
can cause paid synthesis. Never call synthesis, mint tokens, train/clone/publish
voices, save a router, change permissions/global settings, or capture/play live
session audio as an automatic diagnostic. Local implementation authorization
does not authorize these actions. Describe checks that need them separately.

## Finish with evidence and the next action

Report the task, proven findings (with the relevant code/config evidence), checks
still needing API/audio, and the smallest proposed local correction. Helper
`proven-from-input` findings prove only a conflict in supplied metadata, whose
accuracy must still be checked against the app. Mark mock fixtures/tests as
simulated; they cannot verify credentials, recognition quality or live latency.

If unresolved, continue **once** in [troubleshoot](../troubleshoot/SKILL.md) for
official docs, an authorized reproduction and support preparation. Carry the
doctor findings forward. If troubleshoot already invoked doctor, return those
findings to that caller; do not re-enter troubleshoot, and do not redirect back
to doctor when troubleshoot returns. A docs-only fallback is valid when tools
are absent or live calls are not authorized.
