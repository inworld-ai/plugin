// Offline only: no network, audio playback, SDK, credentials, or application mutations.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const string = x => typeof x === 'string' && x.length > 0;
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
const get = (x, path) => path.split('.').reduce((v, k) => object(v) && own(v, k) ? v[k] : undefined, x);
function requireThat(ok, message) { if (!ok) throw new Error(message); }
const fields = ['case', 'session', 'direction', 'event', 'at_ms', 'clock'];
export const canonicalAdapter = Object.freeze(Object.fromEntries(fields.map(k => [k, k])));

// Explicit field-path adapter, not protocol inference. Retain payload field names.
export function adaptEvents(rows, adapter) {
  requireThat(Array.isArray(rows), 'events must be an array');
  requireThat(object(adapter) && fields.every(k => string(adapter[k])), 'adapter must map all six canonical fields to explicit dot paths');
  const clocks = new Map();
  return rows.map((raw, index) => {
    requireThat(object(raw), `event ${index}: expected object`);
    const row = Object.fromEntries(fields.map(k => [k, get(raw, adapter[k])]));
    requireThat(string(row.case) && string(row.session), `event ${index}: case and session/connection epoch required`);
    requireThat(['server', 'client', 'app'].includes(row.direction), `event ${index}: unknown direction`);
    requireThat(object(row.event) && string(row.event.type), `event ${index}: event.type required`);
    requireThat(row.at_ms === undefined || (Number.isFinite(row.at_ms) && row.at_ms >= 0), `event ${index}: invalid at_ms`);
    requireThat(row.clock === undefined || string(row.clock), `event ${index}: invalid clock`);
    // Times are optional; never derive them from list position, audio duration, or wall time.
    if (row.at_ms !== undefined && row.clock !== undefined) {
      const key = JSON.stringify([row.case, row.clock]);
      requireThat(!clocks.has(key) || row.at_ms >= clocks.get(key), `event ${index}: clock moved backwards; preserve capture order`);
      clocks.set(key, row.at_ms);
    }
    return { ...row, index };
  });
}

function selector(s) {
  requireThat(object(s) && string(s.session) && ['server', 'client', 'app'].includes(s.direction)
    && string(s['event.type']), 'selectors need session, direction, and event.type');
  requireThat(Object.entries(s).every(([k, v]) => (['session', 'direction'].includes(k) || k.startsWith('event.'))
    && (typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v) || typeof v === 'string' || v === null)),
  'selector values must be exact JSON scalars on session, direction, or event.* paths');
  return s;
}
const matches = (row, s) => Object.entries(s).every(([key, value]) => get(row, key) === value);

function validateCheck(check) {
  requireThat(object(check) && string(check.id) && string(check.case), 'check needs id and case');
  requireThat(Array.isArray(check.requires) && check.requires.length > 0 && check.requires.every(string), 'check needs explicit observation capabilities');
  requireThat(['count', 'sequence', 'forbid_after', 'latency'].includes(check.kind), 'unknown check kind');
  if (check.kind === 'count') {
    selector(check.match);
    requireThat(Number.isInteger(check.exact) && check.exact >= 0, 'count.exact must be a nonnegative integer');
  } else if (check.kind === 'sequence') {
    requireThat(Array.isArray(check.steps) && check.steps.length >= 2, 'sequence needs at least two steps');
    check.steps.forEach(selector);
  } else {
    selector(check.after); selector(check.match);
    if (check.kind === 'latency') requireThat(Number.isFinite(check.max_ms) && check.max_ms >= 0, 'latency needs explicit max_ms');
  }
}

export function evaluate(log, plan) {
  requireThat(object(log) && log.schema_version === 1, 'log schema_version must be 1');
  requireThat(['synthetic', 'recorded', 'unknown'].includes(log.provenance), 'declare log provenance');
  requireThat(object(log.cases), 'log.cases required');
  for (const [id, c] of Object.entries(log.cases)) {
    requireThat(object(c) && typeof c.complete === 'boolean' && Array.isArray(c.observed) && c.observed.every(string), `case ${id}: complete and observed required`);
  }
  const rows = adaptEvents(log.events, log.adapter);
  requireThat(rows.every(r => own(log.cases, r.case)), 'every event must belong to a declared case');
  requireThat(object(plan) && plan.schema_version === 1 && Array.isArray(plan.checks) && plan.checks.length > 0, 'plan schema_version 1 and nonempty checks required');
  plan.checks.forEach(validateCheck);
  requireThat(new Set(plan.checks.map(c => c.id)).size === plan.checks.length, 'check ids must be unique');
  const checks = plan.checks.map(check => {
    const result = (status, reason, evidence = [], extra = {}) => ({ id: check.id, case: check.case, status, reason, evidence, ...extra });
    const coverage = own(log.cases, check.case) ? log.cases[check.case] : undefined;
    if (!coverage) return result('incomplete', 'Case was not captured');
    const missing = check.requires.filter(c => !coverage.observed.includes(c));
    if (missing.length) return result('not_measured', `Missing observation capabilities: ${missing.join(', ')}`);
    const scope = rows.filter(r => r.case === check.case);
    const absent = () => result(coverage.complete ? 'failed' : 'incomplete', coverage.complete ? 'Expected evidence missing in closed observation window' : 'Observation window is incomplete');
    const success = (evidence, extra) => result(coverage.complete ? 'passed' : 'incomplete', coverage.complete ? 'Expectation observed in closed window' : 'Evidence observed; window remains incomplete', evidence, extra);
    if (check.kind === 'count') {
      const found = scope.filter(r => matches(r, check.match)).map(r => r.index);
      if (found.length > check.exact) return result('failed', 'Observed count exceeds expectation', found, { count: found.length });
      if (found.length < check.exact) return absent();
      return success(found, { count: found.length });
    }
    if (check.kind === 'sequence') {
      const evidence = [];
      let step = 0;
      for (const row of scope) {
        if (matches(row, check.steps[step])) { evidence.push(row.index); step++; }
        if (step === check.steps.length) return success(evidence);
      }
      return absent();
    }
    const anchors = scope.filter(r => matches(r, check.after));
    if (check.kind === 'forbid_after') {
      if (!anchors.length) return absent();
      const violations = scope.filter(r => r.index > anchors[0].index && matches(r, check.match));
      if (violations.length) return result('failed', 'Forbidden event observed after anchor', [anchors[0].index, ...violations.map(r => r.index)]);
      return success([anchors[0].index]);
    }
    const ends = scope.filter(r => matches(r, check.match));
    if (anchors.length !== 1 || ends.length !== 1) return result('not_measured', 'Latency requires exactly one start and one end; refine correlation selectors');
    const [a] = anchors, [b] = ends;
    if (a.at_ms === undefined || b.at_ms === undefined || !a.clock || a.clock !== b.clock)
      return result('not_measured', 'Latency requires measured timestamps on the same monotonic clock', [a.index, b.index]);
    if (b.index <= a.index) return result('failed', 'Latency end precedes start in capture order', [a.index, b.index]);
    const ms = b.at_ms - a.at_ms;
    return ms > check.max_ms ? result('failed', 'Measured latency exceeds declared budget', [a.index, b.index], { ms, max_ms: check.max_ms })
      : success([a.index, b.index], { ms, max_ms: check.max_ms });
  });
  const status = ['failed', 'incomplete', 'not_measured', 'passed'].find(s => checks.some(c => c.status === s));
  return { schema_version: 1, provenance: log.provenance, status, checks,
    limits: ['Event assertions only; no proof of heard audio, intelligibility, naturalness, or subjective quality.',
      'Coverage and adapter correctness are supplied by the app; synthetic evidence is not a live result.'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    requireThat(process.argv.length === 4, 'Usage: node evaluate.mjs LOG.json PLAN.json');
    const report = evaluate(...process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8'))));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'passed' ? 0 : report.status === 'failed' ? 1 : 2;
  } catch (error) {
    console.error(`Invalid evaluation input: ${error.message}`);
    process.exitCode = 3;
  }
}
