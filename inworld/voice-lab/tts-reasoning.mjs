// Request controls for TTS Reasoning; no backend enablement is inferred.
export function reasoningFields({ modelId = 'inworld-tts-2', reasoning, reasoningContext } = {}) {
  if (reasoning !== undefined && !['default', 'on'].includes(reasoning)) throw new Error('reasoning must be default or on');
  if (reasoningContext !== undefined && (typeof reasoningContext !== 'string' || [...reasoningContext].length > 600)) {
    throw new Error('reasoning_context must be a string of at most 600 characters');
  }
  if (reasoningContext !== undefined && reasoning !== 'on') throw new Error('reasoning_context requires reasoning=on');
  if (reasoning === 'on' && modelId !== 'inworld-tts-2') throw new Error('TTS Reasoning requires inworld-tts-2; Flash is unsupported');
  return reasoning === 'on' ? { synthesisContext: { reasoning: 'REASONING_ON',
    ...(reasoningContext !== undefined ? { reasoningContext } : {}) } } : {};
}

export function auditionJobs({ voices, designs, compareReasoning, reasoning, reasoningContext, modelId }) {
  if (compareReasoning !== undefined && typeof compareReasoning !== 'boolean') throw new Error('compare_reasoning must be a boolean');
  if (!compareReasoning) reasoningFields({ modelId, reasoning, reasoningContext });
  const jobs = [...voices.map(voiceId => ({voiceId})), ...designs.map(design => ({design}))];
  if (!compareReasoning) return jobs.slice(0, 4).map(job => ({...job, reasoning, reasoningContext}));
  if (reasoning !== undefined) throw new Error('compare_reasoning chooses the two conditions; omit reasoning');
  // Context is read only by the generated-instruction condition.
  reasoningFields({modelId, reasoning:'on', reasoningContext});
  if (jobs.length > 2) throw new Error('compare_reasoning accepts at most two voices/designs (four clips total)');
  return jobs.flatMap(job => [
    {...job, reasoning:'default', condition:'workspace-default'},
    {...job, reasoning:'on', reasoningContext, condition:'reasoning-requested'},
  ]);
}
