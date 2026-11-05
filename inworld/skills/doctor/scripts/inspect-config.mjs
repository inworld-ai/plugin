#!/usr/bin/env node
// Offline only. Input is a deliberately normalized, redacted summary, not app config.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const enumOf = (...values) => value => values.includes(value);
const bool = value => typeof value === 'boolean';
const integer = value => Number.isInteger(value) && value >= 0;
const names = value => Array.isArray(value) && value.length <= 100 &&
  value.every(v => typeof v === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,79}$/.test(v));
const shape = fields => value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.entries(value).every(([key, item]) => Object.hasOwn(fields, key) && fields[key](item));
const tasks = ['stt-stream', 'stt-file', 'stt-async', 'tts', 'realtime', 'voices-read',
  'voice-write', 'router-read', 'router-write', 'llm', 'dictionary'];
const schema = shape({
  task: enumOf(...tasks),
  auth: shape({ present: bool, credential: enumOf('api-key', 'one-time-token', 'session-token', 'unknown'),
    keyType: enumOf('standard', 'realtime-only', 'unknown'),
    transport: enumOf('basic', 'bearer', 'bearer-subprotocol', 'query', 'unknown'),
    client: enumOf('server', 'browser', 'unknown'), mintingToken: bool,
    reused: bool, expired: bool, voiceWrite: bool, routerWrite: bool }),
  response: shape({ httpStatus: value => Number.isInteger(value) && value >= 100 && value <= 599,
    grpcCode: value => Number.isInteger(value) && value >= 0 && value <= 16 }),
  audio: shape({ sourceKind: enumOf('raw-pcm', 'container', 'unknown'),
    encoding: enumOf('LINEAR16', 'PCM', 'AUTO_DETECT', 'MP3', 'OGG_OPUS', 'FLAC', 'WEBM', 'WAV', 'MP4', 'MXF', 'MULAW', 'ALAW', 'unknown'),
    actualRateHz: integer, declaredRateHz: integer, playbackRateHz: integer,
    actualChannels: integer, declaredChannels: integer, bitDepth: integer }),
  stt: shape({ diarization: bool, wordTimestamps: bool }),
  stream: shape({ finishRequested: bool, tailFlushed: bool, closeStreamCount: integer,
    endTurnBeforeClose: bool, socketClosedBeforeDrain: bool, serverClosedNormally: bool,
    usageReceived: bool, errorObserved: bool, drainTimedOut: bool,
    microphoneReleased: bool, interimAppended: bool, interimPromotedToFinal: bool }),
  dictionary: shape({ workspaceSelectorPresent: bool, namedSelectorPresent: bool,
    inlineIpaPresent: bool }),
  tool: shape({ present: bool, expectedFields: names, installedFields: names,
    expectedRequired: names, installedRequired: names, rejectsUnknownFields: bool }),
  feature: shape({ requested: bool, support: enumOf('supported', 'unsupported', 'unverified') }),
});

export function inspectConfig(input) {
  if (!schema(input) || !Object.hasOwn(input, 'task'))
    throw new Error('Invalid diagnostic summary. Use the documented redacted input schema; do not supply raw config or credentials.');
  const findings = [];
  const add = (code, certainty, message, next) => findings.push({ code, certainty, message, next });
  const proven = (code, message, next) => add(code, 'proven-from-input', message, next);
  const check = (code, message, next) => add(code, 'needs-check', message, next);
  const { task, auth: a = {}, audio: audio = {}, stt = {}, stream: s = {},
    dictionary: d = {}, tool: t = {}, feature: f = {}, response: r = {} } = input;
  if (a.present === false) proven('credential-missing', 'The supplied summary declares no credential available to this process.',
    'Check presence and forwarding in the intended process without printing values. This does not establish account permissions.');
  else if (a.present === undefined) check('credential-unknown', 'Credential availability was not supplied.',
    'Provide presence metadata only; never paste or decode a key.');
  if (r.httpStatus === 401 || r.grpcCode === 16) check('authentication-rejected', 'The reported response rejected authentication.',
    'Check credential kind, forwarding, expiration and scheme. The status alone cannot distinguish a missing, expired or invalid credential.');
  if (r.httpStatus === 403 || r.grpcCode === 7) check('permission-rejected', 'The reported response denied access.',
    'Check the selected endpoint, workspace, key type and scoped permission. Do not conclude the key is absent or grant broad write access.');
  if (r.httpStatus === 429 || r.grpcCode === 8) check('resource-limit', 'The reported response indicates a limit or exhausted resource.',
    'Inspect the sanitized service reason and plan/concurrency limits; do not infer an IP limit or retry in a tight loop.');
  if (a.present !== false) {
    if (a.keyType === 'realtime-only' && task !== 'realtime')
      proven('key-type-mismatch', 'A Realtime-only parent key is declared for a direct platform API task.', 'Use a Standard key for this task; confirm the selected process receives it.');
    if (task === 'realtime' && a.credential === 'one-time-token')
      proven('realtime-token-mismatch', 'A one-time token is declared for Realtime.', 'Use the documented Realtime session-token flow.');
    if (a.mintingToken && a.credential !== undefined && !['unknown', 'api-key'].includes(a.credential))
      proven('token-cannot-mint', 'A token is declared as the credential for token minting.', 'The protected backend must authenticate the mint with its API key.');
    if (a.transport === 'query') proven('credential-in-url', 'A credential is declared in the URL query.', 'Remove it from URLs; use the documented header or browser subprotocol.');
    if (a.credential === 'api-key') {
      if (a.client === 'browser') proven('browser-api-key', 'A long-lived API key is declared in a browser client.', 'Keep the key on the backend and use the task-appropriate client token or relay.');
      if (['bearer', 'bearer-subprotocol'].includes(a.transport)) check('key-scheme-check', 'An API key is declared with a Bearer authentication scheme.', 'Verify the selected endpoint and client authentication contract. Basic with the copied credential is the standard direct flow, but a Bearer declaration alone does not prove rejection, especially on Router/LLM.');
    }
    if (['one-time-token', 'session-token'].includes(a.credential) && a.transport === 'basic')
      proven('token-scheme-mismatch', 'A token is declared with Basic authentication.', 'Use Bearer or the documented browser bearer_ subprotocol for the selected endpoint.');
    if (a.credential === 'one-time-token' && a.reused) proven('single-use-replay', 'A consumed one-time token is declared as reused.', 'Mint a fresh token per connection attempt, including retries.');
    if (a.expired) proven('credential-expired', 'The supplied metadata declares the credential expired.', 'Refresh through the appropriate backend flow; do not output credential values.');
    const permission = task === 'voice-write' ? 'voiceWrite' : task === 'router-write' ? 'routerWrite' : null;
    if (permission && a[permission] === false) proven('write-permission-disabled', 'The permission required by this write task is declared disabled.',
      'Describe the minimal permission change for review; do not change permissions or retry a mutation automatically.');
    else if (permission && a[permission] === undefined) check('write-permission-unknown', 'The task requires a write permission whose state was not supplied.', 'Inspect permission metadata, not secret values; read access does not prove write access.');
  }

  if (task.startsWith('stt-')) {
    if (task === 'stt-stream') {
      if (audio.sourceKind === 'container') proven('stream-container', 'The declared source is containerized audio, not raw PCM.', 'Decode to mono PCM16 before streaming; relabeling MediaRecorder WebM/Opus does not convert it.');
      if (audio.encoding !== undefined && !['unknown', 'LINEAR16'].includes(audio.encoding))
        proven('stt-stream-encoding', 'Streaming STT is declared with an encoding other than LINEAR16.', 'Send signed little-endian PCM16 and declare LINEAR16.');
      if (audio.actualChannels !== undefined && audio.actualChannels !== 1)
        proven('stt-stream-channels', 'The declared streaming source is not mono.', 'Downmix in the existing capture path and verify actual output channels.');
      if (audio.bitDepth !== undefined && audio.bitDepth !== 16)
        proven('stt-stream-depth', 'The declared streaming source is not 16-bit PCM.', 'Convert samples to signed little-endian PCM16.');
      if (audio.declaredRateHz === undefined) check('stream-rate-unknown', 'The raw stream rate was not supplied.', 'Inspect the actual capture rate and declare it; 16 kHz is not the only supported rate.');
    }
    if (audio.sourceKind === 'raw-pcm' || task === 'stt-stream') {
      if (task !== 'stt-stream' && audio.declaredRateHz === undefined)
        check('raw-rate-unknown', 'The request\'s declared PCM rate was not supplied.', 'Declare the actual rate for raw PCM even when source metadata gives its rate; container header inference does not apply.');
      if (audio.sourceKind === 'raw-pcm' && audio.encoding === 'AUTO_DETECT')
        check('raw-auto-detect', 'AUTO_DETECT is declared for headerless PCM.', 'Verify the selected endpoint and specify LINEAR16 with the actual rate for PCM16; there is no container header to infer it from.');
      if (audio.declaredRateHz === 0 || audio.actualRateHz === 0)
        proven('invalid-pcm-rate', 'The supplied PCM rate is zero.', 'Supply the actual positive capture rate; do not substitute an unknown rate with zero.');
      if (audio.actualRateHz !== undefined && audio.declaredRateHz !== undefined && audio.actualRateHz !== audio.declaredRateHz)
        proven('capture-rate-mismatch', 'Declared rate differs from the supplied actual PCM rate.', 'Match the declaration to the bytes or resample explicitly; changing a number does not resample audio.');
    }
    if (audio.actualChannels !== undefined && audio.declaredChannels !== undefined && audio.actualChannels !== audio.declaredChannels)
      proven('channel-declaration-mismatch', 'Declared and actual channel counts differ in the summary.', 'Match the declaration to the bytes after any downmix.');
    if (stt.diarization && task === 'stt-file') proven('sync-diarization', 'Speaker diarization is requested on synchronous STT.', 'Use the documented async or streaming path when speaker labels are required.');
    if (stt.diarization && stt.wordTimestamps === false) proven('diarization-timestamps', 'Diarization is enabled while word timestamps are explicitly disabled.', 'Enable both for a supported transcription mode.');
    else if (stt.diarization && stt.wordTimestamps === undefined) check('diarization-timestamps-unknown', 'Diarization timestamp configuration was not supplied.', 'Check that includeWordTimestamps is enabled.');
  }
  if (task === 'tts' && audio.encoding === 'PCM' && audio.declaredRateHz !== undefined && audio.playbackRateHz !== undefined && audio.declaredRateHz !== audio.playbackRateHz)
    proven('playback-rate-mismatch', 'Requested PCM output rate differs from the supplied player rate.', 'Configure the PCM player for the returned sample rate; verify actual playback separately.');
  if (task === 'tts' && ['WAV', 'LINEAR16'].includes(audio.encoding)) check('tts-container-framing', 'WAV framing needs endpoint-specific handling.',
    'Verify chunk headers against the selected TTS endpoint. LINEAR16 and headerless PCM are not interchangeable; do not treat encoded chunks as raw PCM.');

  if (task === 'stt-stream' && input.stream) {
    if (s.interimAppended || s.interimPromotedToFinal) proven('interim-consumer', 'The summary declares interims appended or promoted to final.', 'Replace the current interim; commit actual final events once.');
    if (s.endTurnBeforeClose) proven('shutdown-end-turn', 'The summary declares an endTurn immediately before shutdown.', 'For shutdown flush the tail, then send closeStream alone; endTurn is for ongoing manual turns.');
    if (s.finishRequested) {
      if (s.tailFlushed === false) proven('tail-not-flushed', 'The summary declares shutdown without flushing captured tail audio.', 'Flush the capture/worklet before closeStream.');
      if (s.closeStreamCount !== undefined && s.closeStreamCount !== 1) proven('shutdown-close-count', 'The summary declares shutdown with other than one closeStream.', 'Send closeStream once, then drain until server close.');
      if (s.socketClosedBeforeDrain) proven('shutdown-premature-close', 'The socket is declared closed before response drain.', 'Keep reading final transcripts and usage until server close.');
      if (s.usageReceived === false || s.serverClosedNormally === false || s.errorObserved || s.drainTimedOut)
        proven('stream-incomplete', 'The supplied shutdown metadata does not meet the maintained asset completion contract.', 'Surface the transcript as incomplete; preserve received finals and investigate the missing tail, usage or abnormal close.');
      if ([s.tailFlushed, s.usageReceived, s.serverClosedNormally, s.errorObserved, s.drainTimedOut].some(v => v === undefined) || s.closeStreamCount === undefined)
        check('shutdown-evidence-missing', 'Shutdown evidence is incomplete.', 'Supply metadata from a complete trace; silence or a final turn alone does not prove session completion.');
      if (s.microphoneReleased === false) proven('microphone-not-released', 'The summary declares capture still active after stop.', 'Release microphone tracks and AudioContext on stop and failures.');
    }
  }
  if (['dictionary', 'tts'].includes(task) && d.workspaceSelectorPresent && d.namedSelectorPresent)
    proven('dictionary-selector-conflict', 'Named dictionary settings and the workspace pronunciation selector are both present.', 'Choose pronunciationDictionarySettings or enable_custom_pronunciation/enableCustomPronunciation; their presence conflicts even if the workspace flag is false. Inline IPA can coexist and takes precedence.');
  if (t.present === false) proven('installed-tool-missing', 'The selected tool is declared absent from the installed tool list.', 'Compare the active server/package and advertised tools with the intended installation; a missing tool is not an API permission denial.');
  if (t.expectedFields && t.installedFields && t.expectedFields.some(field => !t.installedFields.includes(field)))
    add('tool-field-gap', t.rejectsUnknownFields === true ? 'proven-from-input' : 'needs-check',
      'Expected fields are absent from the supplied installed property list.', 'Compare the actual tools/list schema and app version. This may be a stale install, a different tool, or permissive schema; it does not prove the service lacks the feature.');
  if (t.expectedRequired && t.installedRequired && t.installedRequired.some(field => !t.expectedRequired.includes(field)))
    proven('tool-required-gap', 'The supplied installed schema requires fields absent from the expected required set.', 'Align the caller with the advertised schema; check package provenance before proposing an update.');
  if (f.requested && f.support !== 'supported') check('feature-support',
    f.support === 'unsupported' ? 'The supplied selected-mode capability evidence marks the feature unsupported.' : 'Support for the requested feature is unverified.',
    'Check current primary docs for the exact mode/model and installed schema. Do not copy another vendor flag; an app-side composition has separate costs and behavior.');
  check('live-verification', 'Offline inspection cannot establish service access, audio quality, latency or recognition accuracy.',
    'Reuse the developer app and recorded fixtures for a local reproduction. List any API/audio checks separately and run only within current authorization.');
  return { mode: 'offline', scope: 'user-supplied-redacted-metadata', findings };
}

// No path arguments, environment inspection, dotenv, file discovery, networking or writes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error();
    const input = readFileSync(0, 'utf8');
    if (Buffer.byteLength(input) > 65536) throw new Error();
    console.log(JSON.stringify(inspectConfig(JSON.parse(input)), null, 2));
  } catch {
    // Never include parser errors, input fragments, unknown keys or secret values.
    console.error('Invalid diagnostic summary. Expected redacted JSON on stdin (maximum 64 KiB); see references/input.md.');
    process.exitCode = 2;
  }
}
