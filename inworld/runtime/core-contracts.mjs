// Plugin-owned discovery/default corrections; keep the pinned CLI bytes intact.
// Verified 2026-11-02 against official public documentation:
// https://docs.inworld.ai/stt/overview
// https://docs.inworld.ai/stt/languages
// https://docs.inworld.ai/router/quickstart
// The unified catalog's actual model-discovery tool is list_llm_models.
const STT_MODEL = 'inworld/inworld-stt-1';
const chatModelDescription = 'Use an exact API model ID selected from list_llm_models, or an existing router returned by list_routers as inworld/<router-name>. Do not guess model IDs from examples.';

export function projectCoreTool(tool) {
  let description, field, changes;
  if (tool.name === 'transcribe_audio') {
    description = 'Transcribe a short audio file synchronously with Inworld STT. Defaults to inworld/inworld-stt-1, which supports 30 languages. Returns transcript text and optional word timestamps. For long recordings or speaker labels, use the add-transcription skill and its maintained async client. This tool has no Voice Profile input option.';
    field = 'model_id';
    changes = {
      default: STT_MODEL,
      description: 'STT model. Defaults to inworld/inworld-stt-1 (30 languages); groq/whisper-large-v3 remains an explicitly selectable legacy option for compatibility.',
    };
  } else if (tool.name === 'chat_completion' || tool.name === 'chat_completion_with_audio') {
    description = tool.name === 'chat_completion'
      ? `Call a text model through Inworld's OpenAI-compatible chat completions endpoint. ${chatModelDescription}`
      : `Call a chat model with Inworld TTS-2 in one request, returning transcript and raw PCM16 audio at 48 kHz mono, with no WAV header. Save as reply.pcm; this is not a playable WAV container. ${chatModelDescription} Verify that the selected model or router supports the requested audio response.`;
    field = 'model';
    changes = { description: chatModelDescription };
  } else return tool;

  // Change only discovery text/defaults. Preserve enum, required fields, bounds,
  // sample-rate behavior, annotations and every other schema field verbatim.
  const property = tool.inputSchema?.properties?.[field];
  return {
    ...tool, description,
    ...(property ? { inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...tool.inputSchema.properties, [field]: { ...property, ...changes },
        ...(tool.name === 'chat_completion_with_audio' && tool.inputSchema.properties.output_file ? {
          output_file: { ...tool.inputSchema.properties.output_file,
            description: 'Destination for raw PCM16 audio at 48 kHz mono, with no WAV header (e.g. reply.pcm). No container conversion is performed.' },
        } : {}),
      },
    } } : {}),
  };
}

export function coreCallParams(params) {
  if (params?.name !== 'transcribe_audio') return params;
  const args = params.arguments;
  // Leave invalid inputs for the existing validation path; never coerce explicit
  // caller values, including legacy IDs, null or an empty string.
  if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) return params;
  if (args && Object.hasOwn(args, 'model_id')) return params;
  // JSON Schema defaults are annotations. The core validates again with its own
  // Zod default, so the plugin must forward an explicit value when omitted.
  return { ...params, arguments: { ...args, model_id: STT_MODEL } };
}
