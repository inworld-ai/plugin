#!/usr/bin/env python3
"""Offline STT JSONL summaries. No API calls; normalization is explicit and versioned."""
import argparse
import json
import math
import re
import statistics
import unicodedata
from collections import defaultdict
from pathlib import Path


def normalized(text):
    return unicodedata.normalize('NFKC', text).casefold()


def words(text):
    return re.findall(r'\w+', normalized(text), flags=re.UNICODE)


def characters(text):
    return [c for c in normalized(text) if not c.isspace() and not unicodedata.category(c).startswith('P')]


def errors(reference, hypothesis):
    previous = list(range(len(hypothesis) + 1))
    for i, expected in enumerate(reference, 1):
        current = [i]
        for j, actual in enumerate(hypothesis, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (expected != actual)))
        previous = current
    return previous[-1]


def timing(values):
    values = sorted(values)
    if not values:
        return None
    return {'n': len(values), 'median_ms': statistics.median(values),
            'p95_ms': values[max(0, math.ceil(0.95 * len(values)) - 1)],
            'tail_evidence': 'exploratory' if len(values) < 100 else 'sample percentile; assess workload coverage'}


def summarize(records):
    groups = defaultdict(list)
    seen = set()
    for row in records:
        if not isinstance(row, dict) or not all(isinstance(row.get(k), str) and row[k] for k in ('id', 'configuration', 'status')):
            raise ValueError('Each row requires nonempty id, configuration and status strings.')
        if row['status'] not in ('ok', 'error'):
            raise ValueError('status must be ok or error.')
        key = (row['configuration'], row['id'])
        if key in seen:
            raise ValueError(f'Duplicate configuration/sample {key}; give repeats distinct IDs.')
        seen.add(key)
        if row['status'] == 'ok' and not isinstance(row.get('hypothesis'), str):
            raise ValueError('Successful rows require a hypothesis string (empty is allowed).')
        if 'reference' in row and not isinstance(row['reference'], str):
            raise ValueError('reference must be a string; omit it when unknown.')
        if 'complete' in row and not isinstance(row['complete'], bool):
            raise ValueError('complete must be boolean, not a truthy string.')
        for metric, value in row.get('latency_ms', {}).items():
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError(f'Invalid latency {metric}; omit unknown measurements.')
        if 'cost_usd' in row and (isinstance(row['cost_usd'], bool) or not isinstance(row['cost_usd'], (int, float)) or not math.isfinite(row['cost_usd']) or row['cost_usd'] < 0):
            raise ValueError('cost_usd must be a known finite nonnegative amount.')
        if 'critical_entities' in row and (not isinstance(row['critical_entities'], dict) or not all(isinstance(k, str) and k and isinstance(v, str) and v for k, v in row['critical_entities'].items())):
            raise ValueError('critical_entities must map entity names to exact expected strings.')
        groups[(row['configuration'], row.get('stratum', 'all'))].append(row)
    output = []
    for (configuration, stratum), rows in sorted(groups.items()):
        good = [r for r in rows if r['status'] == 'ok']
        labelled = [r for r in good if 'reference' in r]
        ref_words = sum(len(words(r['reference'])) for r in labelled)
        ref_chars = sum(len(characters(r['reference'])) for r in labelled)
        word_errors = sum(errors(words(r['reference']), words(r['hypothesis'])) for r in labelled)
        char_errors = sum(errors(characters(r['reference']), characters(r['hypothesis'])) for r in labelled)
        expected_entities = sum(len(r.get('critical_entities', {})) for r in rows)
        # Exact occurrence in raw hypothesis, with lexical boundaries, is a conservative proxy.
        matched_entities = 0
        for r in good:
            for value in r.get('critical_entities', {}).values():
                if value and re.search(r'(?<!\w)' + re.escape(value) + r'(?!\w)', r['hypothesis']):
                    matched_entities += 1
        clocks = defaultdict(list)
        for r in good:
            for metric, value in r.get('latency_ms', {}).items():
                clocks[metric].append(value)
        costs = [r['cost_usd'] for r in rows if 'cost_usd' in r]
        output.append({'configuration': configuration, 'stratum': stratum, 'attempted': len(rows),
            'succeeded': len(good), 'failed': len(rows) - len(good),
            'incomplete': sum(r.get('complete') is False for r in rows),
            'completion_unknown': sum('complete' not in r for r in rows),
            'labelled_successes': len(labelled), 'reference_words': ref_words, 'word_errors': word_errors,
            'wer': word_errors / ref_words if ref_words else None,
            'reference_characters': ref_chars, 'character_errors': char_errors,
            'cer': char_errors / ref_chars if ref_chars else None,
            'critical_entity_exact_occurrence': {'matched': matched_entities, 'expected': expected_entities,
                'rate': matched_entities / expected_entities if expected_entities else None},
            'latency': {k: timing(v) for k, v in sorted(clocks.items())},
            'cost_usd': sum(costs) if len(costs) == len(rows) else None,
            'known_cost_usd': sum(costs) if costs else None, 'costed_attempts': len(costs)})
    return {'normalization': 'v1: NFKC + casefold; WER Unicode word runs; CER excludes whitespace/punctuation',
        'caveats': ['WER/CER cover labelled successful rows only; failures and incomplete results remain separate.',
                    'WER tokenization is not language-aware; prefer CER or a specified segmenter for unsegmented scripts.',
                    'Critical-entity exact occurrence is case-sensitive, not semantic extraction or diarization scoring.',
                    'Compare only matched sample sets/configurations and comparable measurement clocks.'],
        'groups': output}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        records = [json.loads(line) for line in args.input.read_text().splitlines() if line.strip()]
        if not records:
            raise ValueError('Input has no attempted samples.')
        result = json.dumps(summarize(records), ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    except (ValueError, OSError, TypeError, AttributeError) as error:
        parser.exit(2, f'STT scoring failed: {error}\n')
    if args.output:
        args.output.write_text(result)
    else:
        print(result, end='')


if __name__ == '__main__':
    main()
