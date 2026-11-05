// Recovery advice never grants permission or retries a request.
export function retryAfterMs(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const ms = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  return Number.isFinite(ms) && ms >= 0 && ms <= Number.MAX_SAFE_INTEGER ? Math.ceil(ms) : null;
}

export class RequestFailure extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RequestFailure';
    this.recoveryDetails = details;
    if (Number.isInteger(details.status)) this.status = details.status;
  }
}

export function responseFailure(response, method = 'GET', message = `HTTP ${response.status}`, details = {}) {
  return new RequestFailure(message, {
    status: response.status, method: method.toUpperCase(), dispatched: true,
    retryAfterMs: retryAfterMs(response.headers?.get('retry-after')),
    ...details,
  });
}

export function recoveryFor(error, { tool, args = {} } = {}) {
  const d = error?.recoveryDetails ?? {};
  const status = d.status ?? error?.status;
  const read = ['GET', 'HEAD'].includes(d.method);
  let category = 'request_failed';
  let action = 'Inspect the failure and correct the request before another attempt.';
  if (d.download && [401, 403, 404, 410].includes(status)) {
    category = 'download_unavailable';
    action = 'The media download failed; this is not evidence that the Inworld API credential is invalid. Retrieve the original job to check output availability or refresh its signed link.';
  } else if (['link_expired', 'output_expired', 'output_unavailable'].includes(d.kind)) {
    category = d.kind;
    action = d.kind === 'link_expired' ? 'Retrieve the original job for a fresh link if its output is still retained.'
      : 'The existing job output is expired or unavailable. Refreshing a link may not recover the output; do not start another paid generation automatically.';
  } else if (d.kind === 'policy') {
    category = 'local_limit';
    action = 'A local queue or response-size bound stopped the request. Inspect the recorded outcome before changing limits or making another attempt.';
  } else if (status === 401) {
    category = 'authentication';
    action = 'Check the explicitly configured API credential in the host settings. Do not print it or repeat the same failing request before correcting authentication.';
  } else if (status === 403) {
    category = 'permission';
    action = 'Check workspace, resource access and required permissions. Do not assume the credential is invalid, mint a replacement, or broaden access automatically.';
  } else if (status === 429) {
    category = 'rate_limit';
    action = 'Respect Retry-After when provided; otherwise use bounded backoff. A later read may be repeated within the authorized scope. Do not automatically repeat paid or mutating requests.';
  } else if (d.kind === 'cancelled') {
    category = 'cancelled';
    action = 'The request was cancelled. Stop work; do not reconnect or resubmit automatically.';
  } else if (d.kind === 'timeout') {
    category = 'timeout';
    action = 'The deadline expired. Inspect existing results or job status before deciding whether another attempt is safe.';
  } else if (d.kind === 'transport') {
    category = 'connection';
    action = 'The connection failed. Inspect existing results or job status; a missing response does not establish that the service rejected the request.';
  } else if (status >= 500) {
    category = 'service';
    action = 'The service returned an error. A read may be repeated later within the authorized scope; a paid or mutating request may already have been accepted.';
  }
  const uncertain = d.dispatched === true && !read && (!status || status >= 500);
  const recovery = {
    category, automatic_retry: false,
    ...(Number.isInteger(status) ? { http_status: status } : {}),
    ...(Number.isFinite(d.retryAfterMs) && d.retryAfterMs >= 0 ? { retry_after_ms: d.retryAfterMs } : {}),
    outcome: d.partial ? 'partial' : uncertain ? 'unknown' : d.dispatched === false ? 'not_submitted' : status ? 'error_response' : 'unverified',
    next_action: action,
  };
  if (uncertain) recovery.next_action += ' Do not issue a replacement automatically; recover with the original job ID or documented idempotency key and exact payload, when supported.';
  if (d.partial) recovery.next_action += ' Partial bytes are not a completed result; do not report success or discard already recorded progress.';
  // Only the caller's validated job identifier is echoed, never signed URLs or credentials.
  if (['get_video', 'download_video', 'cancel_video'].includes(tool) && typeof args.video_id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(args.video_id)) {
    recovery.resume = { tool: 'get_video', arguments: { video_id: args.video_id } };
    recovery.next_action += ' When the user resumes, retrieve this same job to inspect status or obtain a fresh download link. Do not create a new job; expired output may no longer be recoverable.';
  }
  return recovery;
}

export function withRecovery(result, error, context) {
  const recovery = recoveryFor(error, context);
  return { ...result, isError: true,
    content: [...(result.content ?? []), { type: 'text', text: `Recovery (${recovery.category}): ${recovery.next_action}${recovery.retry_after_ms !== undefined ? ` Retry-After: ${recovery.retry_after_ms} ms.` : ''} No automatic retry was made.` }],
    structuredContent: { ...(result.structuredContent ?? {}), recovery },
  };
}
