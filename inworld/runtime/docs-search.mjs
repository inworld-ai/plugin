// Public documentation search deliberately never resolves or sends credentials.
import {fetchWithPolicy} from '../voice-lab/http.mjs';
import {responseFailure, withRecovery} from '../voice-lab/recovery.mjs';

const indexes = new Set(['docs', 'website', 'resolutions', 'ui-actions']);
export async function searchDocs(args = {}, signal) {
  try {
    if (typeof args.query !== 'string' || args.query.length < 1 || args.query.length > 500)
      throw Error('query must contain 1–500 characters.');
    if (args.indexes !== undefined && (!Array.isArray(args.indexes) || args.indexes.some(value => !indexes.has(value))))
      throw Error('Use the indexes declared by search_docs.');
    if (args.top_k !== undefined && (!Number.isInteger(args.top_k) || args.top_k < 1 || args.top_k > 25))
      throw Error('top_k must be an integer from 1 to 25.');
    const base = (process.env.INWORLD_API_BASE?.trim() || 'https://api.inworld.ai').replace(/\/+$/, '');
    const params = new URLSearchParams({q: args.query});
    if (args.indexes?.length) params.set('indexes', args.indexes.join(','));
    if (args.top_k !== undefined) params.set('topK', String(args.top_k));
    const response = await fetchWithPolicy(`${base}/api/v1/inworld-assistant/search?${params}`, {signal},
      {timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024});
    if (!response.ok) {
      await response.body?.cancel();
      throw responseFailure(response, 'GET');
    }
    const data = await response.json();
    if (!Array.isArray(data?.results)) throw Error('Documentation search returned invalid results.');
    return {content: [{type: 'text', text: JSON.stringify({query: data.query, indexes: data.indexes,
      count: data.results.length, results: data.results}, null, 2)}]};
  } catch (error) {
    return withRecovery({content: [{type: 'text', text:
      'Documentation search failed. No credentials were sent, and the request was not retried.'}]}, error);
  }
}
