// Contextual guidance is additive advice, never authorization to call another tool.
const hint = (id, why, type, name, requires = []) => ({ id, why, action: { type, name }, requires });

export function nextSteps(name, args, data) {
  if (!data || typeof data !== 'object') return [];
  if (name === 'find_voices') {
    if (data.clips?.length) return [hint('listen', 'Listen to the actual app line before choosing a voice; catalog ranking does not establish audio quality.', 'review', 'listen-and-choose')];
    if (!data.matches?.length || (data.match_quality === 'filter-only' && data.has_description_query !== false)) return [hint('refine-brief', 'No descriptive match was established. Refine the voice brief before generating more samples.', 'skill', 'find-voice')];
    return [hint('audition', 'Compare a shortlist on the same real app line before selecting a voice.', 'tool', 'compare_voices', ['app line', 'authorization to generate audio'])];
  }
  if (['compare_voices', 'design_voice'].includes(name) && data.clips?.length)
    return [hint('listen', 'Listen before choosing. A favorite does not by itself authorize publishing a voice or changing the app.', 'review', 'listen-and-choose')];
  if (name === 'check_speech_text' && data.changed)
    return [hint('review-text', 'Check that the revised text preserves meaning, identifiers and intended pronunciation before synthesis.', 'review', 'review-speech-text')];
  if (name === 'benchmark_models' && Array.isArray(data.results) && data.results.length) {
    const incomplete = data.results.some(row => ['failed', 'incomplete', 'unknown', 'skipped'].some(k => Number((row.counts ?? row)[k]) > 0));
    return [incomplete
      ? hint('resolve-coverage', 'Some requested attempts did not succeed. Keep every outcome in the report and investigate coverage before making a migration decision.', 'skill', 'benchmark-models')
      : hint('validate-app', 'Check representative app behavior, quality, cache usage and cost alongside timings before deciding whether to switch.', 'skill', 'benchmark-models')];
  }
  if (['create_video', 'get_video'].includes(name) && data.id) {
    if (['queued', 'in_progress'].includes(data.status)) return [hint('poll-job', 'Poll the existing job ID until terminal; do not create a replacement to check progress.', 'tool', 'get_video')];
    if (data.status === 'completed') return [hint('download-job', 'Download the completed job using its existing ID.', 'tool', 'download_video')];
    if (['failed', 'cancelled'].includes(data.status)) return [hint('review-job', 'Review the terminal outcome. A replacement generation needs authorization for another paid request.', 'review', 'review-video-failure')];
  }
  return [];
}

export function withNextSteps(name, args, result, { skillPrefix = '' } = {}) {
  if (!result || result.isError) return result;
  const steps = nextSteps(name, args, result.structuredContent).map(step => step.action.type === 'skill' && skillPrefix === 'inworld-'
    ? { ...step, action: { ...step.action, name: `inworld-${step.action.name}` } } : step);
  if (!steps.length) return result;
  return {
    ...result,
    content: [...(result.content ?? []), { type: 'text', text: 'Suggested next steps (not authorization):\n' + steps.map(s => `- ${s.why} Action: ${s.action.name}.${s.requires.length ? ` Requires: ${s.requires.join(', ')}.` : ''}`).join('\n') }],
    structuredContent: { ...result.structuredContent, guidance_version: 1, next_steps: steps },
  };
}
