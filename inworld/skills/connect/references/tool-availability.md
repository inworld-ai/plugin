# One Inworld connection

The plugin exposes one `inworld` MCP connection and one explicitly configured
`INWORLD_API_KEY`. Its catalog includes voice discovery, auditions, speech,
transcription, cloning/design/publishing, streaming latency, inference, routing,
Decisions, image generation and video jobs. No feature-area package or second
credential is needed.

Inspect the actual registered schemas. Hosts may disable tools or load an older
package. A missing tool is not an authentication error: explain the capability
gap, continue useful local preparation and check the installed plugin/version.
Do not ask for another key, silently add a server or claim an unavailable action
ran. A terminal-only host can inspect this same catalog and run the offline
`check_speech_text` action; authenticated actions still require the native host
credential flow. The terminal bridge does not discover credentials.

`design_voice` uses `description`, `script` and optional `language`, `samples`,
`structured`. `publish_voice` requires `voice_id` and `display_name`. The private
CLI dependency has older overlapping schemas, but they are not duplicate public
tools. Use the one installed schema, not remembered arguments from an old server.

Tool availability is not action authorization. Use requested workload, bounded
attempts and actual results. Do not automatically generate, upload, train,
publish, mutate routers, switch providers or compare external providers. Preserve
uncertain outcomes and never repeat a paid action just to obtain a clean result.
