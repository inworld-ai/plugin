#!/usr/bin/env python3
"""Local media -> evidence-backed candidate plan -> reviewed PCM dataset.

See ../references/dataset-format.md. No network, STT, upload or playback.
"""
import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import selectors
import struct
import subprocess
import tempfile
import time
from contextlib import contextmanager
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from fractions import Fraction

RATE = 48000
FRAME_BYTES = 3
DEFAULTS = dict(min_confidence=0.8, max_gap=0.3, min_clip=0.5,
                max_clip=30.0, holdout_seconds=30.0, train_cap_seconds=7200.0,
                max_pack_seconds=600.0, max_files=50, max_bytes=1_000_000_000)


class Invalid(ValueError):
    pass


def require(ok, message):
    if not ok:
        raise Invalid(message)


def number(value, name, low=0, high=1e12):
    require(type(value) in (int, float) and low <= value <= high and math.isfinite(value),
            'Invalid ' + name)
    return value


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    allow_nan=False).encode()).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def local_path(value, exists=True):
    require(isinstance(value, str) and '\x00' not in value and
            Path(value).is_absolute() and '://' not in value,
            'Expected absolute local filesystem path (no URLs/protocols)')
    p = Path(value)
    if exists:
        p = p.resolve(strict=True)
        require(p.is_file() and 0 < p.stat().st_size <= 8_000_000_000,
                'Expected nonempty regular local file <=8 GB')
    return p


def binary(name):
    found = shutil.which(name) or str(Path('/opt/homebrew/bin') / name)
    require(Path(found).is_file(), name + ' is not installed')
    return found


def capture_bounded(name, args, out, err, max_output=2_000_000, timeout=180):
    """Drain both pipes with byte limits; reap the direct child on every exit."""
    deadline = time.monotonic() + timeout
    sizes = {'stdout': 0, 'stderr': 0}
    with subprocess.Popen([binary(name)] + list(map(str, args)),
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={'PATH': os.defpath, 'LC_ALL': 'C'}) as child:
        try:
            with selectors.DefaultSelector() as selector:
                for pipe, label, target, limit in ((child.stdout, 'stdout', out, max_output),
                                                  (child.stderr, 'stderr', err, 2_000_000)):
                    os.set_blocking(pipe.fileno(), False)
                    selector.register(pipe, selectors.EVENT_READ, (label, target, limit))
                while selector.get_map():
                    remaining = deadline - time.monotonic()
                    require(remaining > 0, name + ' exceeded local timeout')
                    for key, _ in selector.select(min(remaining, 1)):
                        block = os.read(key.fileobj.fileno(), 65536)
                        if not block:
                            selector.unregister(key.fileobj)
                            continue
                        label, target, limit = key.data
                        sizes[label] += len(block)
                        require(sizes[label] <= limit, name + ' exceeded ' + label + ' byte limit')
                        target.write(block)
            try:
                return child.wait(timeout=max(0.001, deadline-time.monotonic()))
            except subprocess.TimeoutExpired as exc:
                raise Invalid(name + ' exceeded local timeout') from exc
        finally:
            if child.poll() is None:
                child.kill()
            child.wait()


def run(name, args, timeout=180):
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        code = capture_bounded(name, args, out, err, timeout=timeout)
        out.seek(0)
        err.seek(0)
        stdout, stderr = out.read().decode(errors='replace'), err.read().decode(errors='replace')
        require(code == 0, name + ' failed: ' + stderr[-1500:])
        return stdout, stderr


# Demuxer allowlist prevents local playlists/concat scripts from fetching nested
# media or other local files. Network protocols are disabled independently.
DEMUXERS = 'wav,mp3,flac,ogg,mov,matroska,webm,aac,aiff'
LOCAL_INPUT = ['-protocol_whitelist', 'file', '-format_whitelist', DEMUXERS]


def object_value(value, name):
    require(isinstance(value, dict), name + ' must be a JSON object')
    return value


def decoded_timebase(path, stream):
    """Check decoded frame PTS against cumulative samples, never repair gaps.

    Disk-backed compact frame records keep long-source memory bounded. Container
    timestamp rounding is allowed up to one tick; drift is checked against the
    absolute sample position, so rounding tolerance cannot accumulate per frame.
    """
    rate = int(stream['sample_rate'])
    tick = Fraction(stream['time_base'])
    require(rate > 0 and 0 < tick <= Fraction(1, 100), 'Unsupported audio timestamp precision')
    count, origin = 0, None
    deadline = time.monotonic() + 180
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        code = capture_bounded('ffprobe', ['-v', 'error', *LOCAL_INPUT,
                '-select_streams', str(stream['index']), '-show_frames', '-show_entries',
                'frame=pts,nb_samples', '-of', 'compact=p=0:nk=0', str(path)],
                out, err, max_output=64_000_000, timeout=180)
        require(code == 0 and err.tell() == 0, 'Audio timestamp decode failed')
        out.seek(0)
        for frame_index, line in enumerate(out):
            require(frame_index < 2_000_000 and len(line) <= 256, 'Audio frame record limit exceeded')
            require(time.monotonic() <= deadline, 'Audio timestamp validation exceeded local timeout')
            fields = dict(part.split('=', 1) for part in line.decode().strip().split('|') if '=' in part)
            if not fields:
                continue
            require(fields.get('pts', 'N/A') != 'N/A' and
                    fields.get('nb_samples', 'N/A') != 'N/A', 'Missing decoded audio timestamps/samples')
            pts, samples = int(fields['pts']), int(fields['nb_samples'])
            require(samples > 0, 'Invalid decoded audio frame')
            if origin is None:
                origin = pts
            require(abs((pts - origin) * tick - Fraction(count, rate)) <= tick + Fraction(1, rate),
                    'Discontinuous audio timestamps: canonicalize explicitly and rerun STT on that exact file; no automatic resampling repair')
            count += samples
            require(count <= rate * 86400, 'Decoded audio exceeds 24 hours')
    require(count > 0, 'No decoded audio frames')
    return dict(kind='decoded-audio-zero-origin', sample_rate_hz=rate, decoded_frames=count,
                timestamp_tick=str(tick), origin_seconds=0, presentation_origin_pts=origin)


def inspect(path, stream_index=None):
    p = local_path(str(path))
    before = file_hash(p)
    raw, _ = run('ffprobe', ['-v', 'error', *LOCAL_INPUT, '-show_entries',
                            'format=duration,format_name:stream=index,codec_type,codec_name,sample_rate,channels,duration,start_time,time_base',
                            '-of', 'json', p])
    data = json.loads(raw)
    audio = [s for s in data.get('streams', []) if s.get('codec_type') == 'audio']
    require(audio, 'No audio stream')
    if stream_index is None:
        require(len(audio) == 1, 'Multiple audio streams: choose --stream-index explicitly')
        stream = audio[0]
    else:
        stream = next((s for s in audio if s['index'] == stream_index), None)
        require(stream is not None, 'Chosen audio stream does not exist')
    timebase = decoded_timebase(p, stream)
    duration = timebase['decoded_frames'] / timebase['sample_rate_hz']
    number(duration, 'audio duration', 0.0001, 86400)
    require(before == file_hash(p), 'Source changed during inspection')
    return dict(path=str(p), sha256=before, duration=duration,
                stream_index=stream['index'], stream=stream, timebase=timebase,
                canonical_parent=dict(sha256=before, offset_seconds=0,
                                      evidence='Original local file; no window offset'))


def frames(seconds, rounding=ROUND_FLOOR):
    return int((Decimal(str(seconds)) * RATE).to_integral_value(rounding=rounding))


def settings(value):
    require(isinstance(value, dict) and not (set(value) - set(DEFAULTS)), 'Unknown settings')
    s = dict(DEFAULTS, **value)
    for key, val in s.items():
        number(val, key, 0 if key in ('max_gap', 'holdout_seconds', 'min_confidence') else 0.0001)
    require(s['min_confidence'] <= 1 and s['max_gap'] <= 2 and
            s['min_clip'] <= s['max_clip'] <= 180 and s['train_cap_seconds'] <= 10800 and
            s['max_pack_seconds'] <= 1800, 'Settings exceed local bounds')
    require(type(s['max_files']) is int and 1 <= s['max_files'] <= 50 and
            type(s['max_bytes']) is int and 1024 <= s['max_bytes'] <= 1_000_000_000,
            'Pack limits must be integers <=50 files / 1GB')
    return s


def canonical_offset(parent):
    if 'offset_frames' in parent:
        n = parent['offset_frames']
        require(type(n) is int and 0 <= n <= RATE * 1e12, 'Invalid canonical offset_frames')
        if 'offset_seconds' in parent:
            seconds = number(parent['offset_seconds'], 'canonical offset')
            require(abs(seconds * RATE - n) <= 1e-6, 'Conflicting canonical offsets')
        return n
    seconds = number(parent.get('offset_seconds'), 'canonical offset')
    n = round(seconds * RATE)
    require(abs(seconds * RATE - n) <= 1e-6, 'Canonical offset must align to a 48k frame; use offset_frames')
    return n


def text_warnings(selected):
    seen, repeated = set(), set()
    for c in selected:
        text = content_key(c)
        if text in seen:
            repeated.add(text)
        seen.add(text)
    return dict(repeated_transcripts=sorted(repeated),
                independence='Text equality/overlap is not audio identity. Alternate encodings/reuploads cannot be proven independent without correct canonical parent metadata.')


def candidates(manifest):
    object_value(manifest, 'Manifest')
    require(manifest.get('version') == 1 and nonempty(manifest.get('target')), 'Need version 1 and target')
    s = settings(manifest.get('settings', {}))
    sources = manifest.get('sources')
    require(isinstance(sources, list) and 1 <= len(sources) <= 20, 'Need 1..20 sources')
    all_clips, diagnostics, source_ids, source_hashes = [], [], set(), set()
    for source in sources:
        object_value(source, 'Source')
        sid, session = source.get('id'), source.get('session_id')
        require(nonempty(sid) and nonempty(session) and sid not in source_ids, 'Unique source id and session_id required')
        source_ids.add(sid)
        local_path(source.get('path'))
        sha = source.get('sha256', '')
        require(isinstance(sha, str) and re.fullmatch('[a-f0-9]{64}', sha), 'Need inspected source sha256')
        require(sha not in source_hashes, 'Duplicate source hash, including renamed copies')
        source_hashes.add(sha)
        duration = number(source.get('duration'), 'duration', 0.0001, 86400)
        require(type(source.get('stream_index')) is int and source['stream_index'] >= 0, 'Need stream_index')
        parent = object_value(source.get('canonical_parent', {}), 'Canonical parent')
        require(isinstance(parent.get('sha256'), str) and re.fullmatch('[a-f0-9]{64}', parent['sha256']) and
                nonempty(parent.get('evidence')), 'Need canonical parent sha256 and offset evidence')
        parent_offset = canonical_offset(parent)
        timebase = object_value(source.get('timebase'), 'Source timebase; rerun inspect')
        require(timebase.get('kind') == 'decoded-audio-zero-origin' and timebase.get('origin_seconds') == 0,
                'Need inspected zero-origin decoded audio timebase')
        number(timebase.get('sample_rate_hz'), 'decoded sample rate', 1, 768000)
        number(timebase.get('decoded_frames'), 'decoded frames', 1)
        require(duration == timebase['decoded_frames'] / timebase['sample_rate_hz'], 'Duration differs from decoded timebase')
        a = object_value(source.get('analysis', {}), 'Analysis')
        require(a.get('timebase') == timebase, 'Analysis timebase must match inspected source; reconcile STT offsets or rerun STT')
        require(a.get('complete') is True and a.get('coverage') == [0, duration] and
                nonempty(a.get('provenance')), 'Complete analysis, full coverage and provenance required')
        mapping = object_value(a.get('target_mapping', {}), 'Target mapping')
        require(mapping.get('session_id') == session and mapping.get('target') == manifest['target'] and
                isinstance(mapping.get('labels'), list) and mapping['labels'] and
                all(nonempty(x) for x in mapping['labels']) and nonempty(mapping.get('evidence')),
                'Explicit session-scoped target mapping and attribution evidence required')
        policy = a.get('unscored_policy', 'allow-with-evidence')
        require(policy in ('exclude', 'allow-with-evidence'), 'Explicit unscored_policy required')
        if policy == 'allow-with-evidence':
            require(nonempty(a.get('unscored_evidence', mapping.get('evidence'))), 'Unscored selection needs evidence')
        words = a.get('words')
        require(isinstance(words, list) and 0 < len(words) <= 200000, 'Need complete normalized words')
        unique, seen, dedup = [], set(), 0
        for word in words:
            require(isinstance(word, dict) and nonempty(word.get('text')), 'Invalid word text')
            start = number(word.get('start'), 'word start', 0, duration)
            end = number(word.get('end'), 'word end', 0, duration)
            require(end > start and frames(end) > frames(start, ROUND_CEILING), 'Invalid word interval; reject whole analysis')
            label = word.get('speaker')
            require(label is None or nonempty(label), 'Speaker must be string or null')
            conf = word.get('confidence')
            if conf is not None:
                number(conf, 'word confidence', 0, 1)
            key = (start, end, label, word['text'], conf)
            if key in seen:
                dedup += 1
                continue
            seen.add(key)
            unique.append(dict(word, speaker=label, confidence=conf))
        unique.sort(key=lambda w: (w['start'], w['end'], w['text']))
        reported = [w['confidence'] for w in unique if w['confidence'] is not None]
        zero = bool(reported) and all(c == 0 for c in reported)
        # Sweep connected interval components: reject ALL overlapping words,
        # including same-label words; exact duplicate finals were removed above.
        overlap, component, end = set(), [], -1
        for i, w in enumerate(unique):
            if w['start'] >= end:
                if len(component) > 1:
                    overlap.update(component)
                component, end = [], -1
            component.append(i)
            end = max(end, w['end'])
        if len(component) > 1:
            overlap.update(component)
        groups, group = [], []
        rejected = dict(overlap=0, other_or_unknown=0, low_confidence=0, unscored=0, too_long=0)
        def flush():
            if group:
                groups.append(group[:])
                group.clear()
        for i, w in enumerate(unique):
            unscored = zero or w['confidence'] is None
            reason = ('overlap' if i in overlap else
                      'other_or_unknown' if w['speaker'] not in mapping['labels'] else
                      'unscored' if unscored and policy == 'exclude' else
                      'low_confidence' if not unscored and w['confidence'] < s['min_confidence'] else
                      'too_long' if w['end'] - w['start'] > s['max_clip'] else None)
            if reason:
                rejected[reason] += 1
                flush()
                continue
            if group and (w['speaker'] != group[-1]['speaker'] or
                          w['start'] - group[-1]['end'] > s['max_gap'] + 1e-9 or
                          w['end'] - group[0]['start'] > s['max_clip']):
                flush()
            group.append(w)
        flush()
        for group in groups:
            start, end = group[0]['start'], group[-1]['end']
            if end - start < s['min_clip']:
                continue
            clip = dict(source_id=sid, session_id=session, source_sha256=sha,
                        canonical_parent_sha256=parent['sha256'],
                        canonical_start_frame=parent_offset + frames(start, ROUND_CEILING),
                        canonical_end_frame=parent_offset + frames(end),
                        start=start, end=end, source_start_frame=frames(start, ROUND_CEILING),
                        source_end_frame=frames(end), text=' '.join(w['text'] for w in group),
                        words=group, interval_seconds=end-start,
                        summed_word_seconds=sum(w['end']-w['start'] for w in group),
                        confidence_status='unscored' if zero or any(w['confidence'] is None for w in group) else 'scored',
                        attribution=mapping, analysis_provenance=a['provenance'])
            clip['id'] = digest(clip)[:24]
            all_clips.append(clip)
        diagnostics.append(dict(source_id=sid, all_zero_confidence=zero, deduplicated_words=dedup,
                                rejected_words=rejected))
    require(len(all_clips) <= 10000, 'Too many candidates')
    return all_clips, diagnostics, s


def content_key(clip):
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', '', clip['text']).casefold()).strip()


def validate_selection(clips, selection, s):
    require(isinstance(selection, dict) and set(selection) == {'train', 'holdout'} and
            all(isinstance(selection[k], list) for k in selection), 'Need train/holdout ID arrays')
    lookup = {c['id']: c for c in clips}
    ids = selection['train'] + selection['holdout']
    require(ids and len(ids) <= 1000 and all(isinstance(i, str) for i in ids) and
            len(set(ids)) == len(ids) and all(i in lookup for i in ids),
            'Missing, unknown or duplicate selected IDs (max 1000)')
    selected = [dict(lookup[i], purpose=purpose) for purpose in ('train', 'holdout') for i in selection[purpose]]
    require(selection['train'], 'At least one training clip required')
    parents = {}
    for c in selected:
        parents.setdefault(c['canonical_parent_sha256'], []).append(c)
    for group in parents.values():
        group.sort(key=lambda c: c['canonical_start_frame'])
        for left, right in zip(group, group[1:]):
            require(left['canonical_end_frame'] <= right['canonical_start_frame'],
                    'Overlapping canonical source ranges, including split windows/holdout')
    require(sum(c['interval_seconds'] for c in selected if c['purpose'] == 'train') <= s['train_cap_seconds'] + 1e-8,
            'Training selection exceeds cap; select whole candidates')
    require(sum(c['interval_seconds'] for c in selected) <= 14400, 'Local render limit: 4 hours selected')
    return selected


def make_plan(manifest):
    clips, diag, s = candidates(manifest)
    # Reserve holdout first; never trim words to fill a cap. Duplicated content
    # or overlapping canonical windows require an explicit corrected selection.
    holdout, train, reserved, used = [], [], 0, 0
    for c in reversed(clips):
        if reserved < s['holdout_seconds']:
            holdout.insert(0, c['id'])
            reserved += c['interval_seconds']
    for c in clips:
        if c['id'] not in holdout and used + c['interval_seconds'] <= s['train_cap_seconds']:
            train.append(c['id'])
            used += c['interval_seconds']
    return dict(version=1, manifest=copy.deepcopy(manifest), candidates=clips, diagnostics=diag,
                selection=dict(train=train, holdout=holdout),
                review=dict(status='unreviewed', by=None, evidence=None), quality='unverified')


def validate_plan(plan):
    object_value(plan, 'Plan')
    require(plan.get('version') == 1, 'Unsupported plan version')
    require('manifest' in plan, 'Plan missing manifest; run plan on an inspected source manifest')
    clips, _, s = candidates(plan['manifest'])
    require(plan.get('candidates') == clips, 'Candidates differ from retained analysis; re-plan and review')
    r = object_value(plan.get('review', {}), 'Review')
    require(r.get('status') == 'reviewed' and nonempty(r.get('by')) and nonempty(r.get('evidence')),
            'Plan-level review/selection required; no per-clip checkbox')
    selected = validate_selection(clips, plan.get('selection'), s)
    for source in plan['manifest']['sources']:
        actual = inspect(source['path'], source['stream_index'])
        require(actual['sha256'] == source['sha256'], 'Source hash changed')
        require(actual['timebase'] == source['timebase'], 'Source decoded timebase changed; inspect and reconcile analysis')
        require(abs(actual['duration'] - source['duration']) <= 1 / RATE,
                'Source duration changed or was not inspected')
    return selected, s


def pcm_info(path):
    """Parse RIFF PCM and PCM WAVE_FORMAT_EXTENSIBLE (including Python <3.12)."""
    size = Path(path).stat().st_size
    with open(path, 'rb') as f:
        header = f.read(12)
        require(len(header) == 12 and header[:4] == b'RIFF' and header[8:] == b'WAVE' and
                struct.unpack('<I', header[4:8])[0] + 8 == size, 'Invalid RIFF size/header')
        fmt, data = None, None
        while f.tell() < size:
            chunk = f.read(8)
            require(len(chunk) == 8, 'Truncated RIFF chunk')
            tag, length = struct.unpack('<4sI', chunk)
            offset = f.tell()
            require(offset + length + (length % 2) <= size, 'Truncated WAV data')
            if tag == b'fmt ':
                require(fmt is None and 16 <= length <= 1024, 'Invalid fmt chunk')
                raw = f.read(length)
                code, channels, rate, byte_rate, align, bits = struct.unpack('<HHIIHH', raw[:16])
                if code == 0xfffe:
                    require(length >= 40 and struct.unpack('<H', raw[16:18])[0] >= 22 and
                            struct.unpack('<H', raw[18:20])[0] == 24 and
                            raw[24:40] == bytes.fromhex('0100000000001000800000aa00389b71'),
                            'Not 24-bit extensible integer PCM')
                else:
                    require(code == 1, 'Not integer PCM')
                require((channels, rate, byte_rate, align, bits) == (1, RATE, RATE*3, 3, 24),
                        'Expected mono 48kHz 24-bit PCM')
                fmt = True
            elif tag == b'data':
                require(data is None and length > 0 and length % 3 == 0, 'Invalid PCM data chunk')
                data = dict(data_offset=offset, data_bytes=length, frames=length // 3)
            f.seek(offset + length + length % 2)
        require(fmt and data, 'Missing fmt/data chunk')
        return dict(data, duration=data['frames']/RATE, bytes=size, sha256=file_hash(path))


def pcm_blocks(path, info):
    with open(path, 'rb') as f:
        f.seek(info['data_offset'])
        remaining = info['data_bytes']
        while remaining:
            block = f.read(min(3 * 32768, remaining))
            require(block and len(block) % 3 == 0, 'Truncated PCM')
            remaining -= len(block)
            yield block


def signal_qc(path, info):
    h, peak, squares = hashlib.sha256(), 0, 0
    for block in pcm_blocks(path, info):
        h.update(block)
        for i in range(0, len(block), 3):
            value = int.from_bytes(block[i:i+3], 'little', signed=True)
            peak = max(peak, abs(value))
            squares += value * value
    rms = math.sqrt(squares / info['frames']) / 8388608
    return dict(pcm_sha256=h.hexdigest(), peak_dbfs=20*math.log10(peak/8388608) if peak else None,
                rms_dbfs=20*math.log10(rms) if rms else None,
                status='passed' if 0 < peak < 8388607 else 'failed',
                perceptual_quality='unverified')


def loudness(path):
    _, err = run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'info', *LOCAL_INPUT,
                          '-i', path, '-af', 'loudnorm=I=-23:TP=-5:LRA=11:print_format=json', '-f', 'null', '-'])
    found = re.findall(r'\{\s*"input_i"[^}]+\}', err)
    require(found, 'Loudness measurement unavailable')
    data = json.loads(found[-1])
    values = {k: float(data[k]) for k in ('input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset')}
    require(all(math.isfinite(v) for v in values.values()), 'Nonfinite loudness (silent/insufficient signal)')
    return values


@contextmanager
def wav_writer(path, count):
    """Truthful PCM RIFF header, including pad OUTSIDE odd-length data."""
    size = count * 3
    with open(path, 'xb') as f:
        f.write(struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36+size+(size%2),
                            b'WAVE', b'fmt ', 16, 1, 1, RATE, RATE*3, 3, 24, b'data', size))
        class Writer:
            def writeframesraw(self, block):
                f.write(block)
        yield Writer()
        require(f.tell() == 44+size, 'PCM writer frame count mismatch')
        if size % 2:
            f.write(b'\0')


def source_fingerprint(path):
    stat = Path(path).stat()
    return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)


def assemble(plan, output, execute=False, normalize=False):
    selected, s = validate_plan(plan)
    out = local_path(str(output), exists=False)
    require(not out.exists() and not out.is_symlink(), 'Output must be a fresh directory; never overwrite')
    sources = {x['id']: x for x in plan['manifest']['sources']}
    fingerprints = {sid: source_fingerprint(source['path']) for sid, source in sources.items()}
    training_frames = sum(c['source_end_frame'] - c['source_start_frame'] for c in selected if c['purpose'] == 'train')
    require(training_frames * 3 + 44 <= s['max_bytes'], 'Training PCM exceeds packed byte budget')
    summary = dict(status='dry-run', clips=len(selected),
                   selected_train_interval_seconds=sum(c['interval_seconds'] for c in selected if c['purpose'] == 'train'),
                   summed_train_word_seconds=sum(c['summed_word_seconds'] for c in selected if c['purpose'] == 'train'),
                   quality='unverified', normalization=normalize, output=str(out),
                   confidence_caveat='Inworld word confidence is unpopulated: omitted or zero is unscored; nonzero values are imported metadata',
                   original_runtime_seconds=sum(x['duration'] for x in sources.values()),
                   transcript_warnings=text_warnings(selected),
                   loudness_targets=dict(integrated_lufs=-23, true_peak_dbtp=-5) if normalize else None)
    if not execute:
        return summary
    out.mkdir(mode=0o700)  # parent must already exist
    report = dict(summary, status='rendering', plan_sha256=digest(plan),
                  manifest=plan['manifest'], selection=plan['selection'], review=plan['review'],
                  clips=[], packed=[], upload_ready=False,
                  requires_before_upload=['revalidate sources/output hashes and PCM mapping',
                                          'establish source-audio rights and voice consent',
                                          'review speaker purity and audio quality; verify current service limits'])
    try:
        for sub in ('clips', 'holdout', 'packed'):
            (out / sub).mkdir(mode=0o700)
        pcm_seen = set()
        for c in selected:
            source = sources[c['source_id']]
            require(source_fingerprint(source['path']) == fingerprints[c['source_id']], 'Source changed before extraction')
            destination = out / ('holdout' if c['purpose'] == 'holdout' else 'clips') / (c['id'] + '.wav')
            trim = (f'asetpts=PTS-STARTPTS,aresample={RATE},aformat=channel_layouts=mono,'
                    f"atrim=start_sample={c['source_start_frame']}:end_sample={c['source_end_frame']},asetpts=PTS-STARTPTS")
            run('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-n', *LOCAL_INPUT,
                           '-i', source['path'], '-map', f"0:{source['stream_index']}", '-vn',
                           '-af', trim, '-ar', RATE, '-ac', 1, '-c:a', 'pcm_s24le', '-map_metadata', '-1', destination])
            require(source_fingerprint(source['path']) == fingerprints[c['source_id']], 'Source changed during extraction')
            measurements = None
            if normalize:
                before = loudness(destination)
                gain = min(-23-before['input_i'], -5-before['input_tp'])
                require(abs(gain) <= 12, 'Required loudness gain exceeds bounded +/-12dB; inspect source')
                normalized = destination.with_suffix('.normalized.wav')
                run('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-n', *LOCAL_INPUT,
                               '-i', destination, '-af', f'volume={gain}dB', '-ar', RATE, '-ac', 1,
                               '-c:a', 'pcm_s24le', '-map_metadata', '-1', normalized])
                after = loudness(normalized)
                require(after['input_tp'] <= -4.8 and abs(after['input_i'] + 23) <= 1,
                        'Normalized output missed loudness/peak QC; no automatic repair')
                # Both paths belong to this fresh run; never overwrite an external file.
                destination.unlink()
                normalized.rename(destination)
                measurements = dict(before=before, after=after, gain_db=gain)
            info = pcm_info(destination)
            require(info['frames'] == c['source_end_frame'] - c['source_start_frame'], 'Rendered frame count mismatch')
            qc = signal_qc(destination, info)
            require(qc['status'] == 'passed', 'Signal QC failed (silent or full scale)')
            require(qc['pcm_sha256'] not in pcm_seen, 'Duplicate decoded PCM content, including holdout')
            pcm_seen.add(qc['pcm_sha256'])
            report['clips'].append(dict(c, path=str(destination), audio=info, qc=qc, loudness=measurements))
        train = [c for c in report['clips'] if c['purpose'] == 'train']
        max_frames = frames(s['max_pack_seconds'])
        groups, group, count = [], [], 0
        for c in train:
            n = c['audio']['frames']
            require(n <= max_frames, 'A whole clip exceeds max_pack_seconds; re-plan')
            if group and count + n > max_frames:
                groups.append(group)
                group, count = [], 0
            group.append(c)
            count += n
        if group:
            groups.append(group)
        require(len(groups) <= s['max_files'], 'Too many packed files; raise pack duration within bounds or reduce selection')
        for i, group in enumerate(groups):
            dest = out / 'packed' / f'train-{i+1:03}.wav'
            mapping, offset, content = [], 0, hashlib.sha256()
            with wav_writer(dest, sum(c['audio']['frames'] for c in group)) as writer:
                for c in group:
                    for block in pcm_blocks(c['path'], c['audio']):
                        writer.writeframesraw(block)
                        content.update(block)
                    n = c['audio']['frames']
                    mapping.append(dict(clip_id=c['id'], clip_pcm_sha256=c['qc']['pcm_sha256'],
                                        source_id=c['source_id'], source_sha256=c['source_sha256'],
                                        source_start_frame=c['source_start_frame'], source_end_frame=c['source_end_frame'],
                                        canonical_parent_sha256=c['canonical_parent_sha256'],
                                        canonical_start_frame=c['canonical_start_frame'], canonical_end_frame=c['canonical_end_frame'],
                                        packed_start_frame=offset, packed_end_frame=offset+n))
                    offset += n
            info = pcm_info(dest)
            require(info['frames'] == offset and signal_qc(dest, info)['pcm_sha256'] == content.hexdigest(),
                    'Packed PCM mapping verification failed')
            report['packed'].append(dict(path=str(dest), audio=info, pcm_sha256=content.hexdigest(), mapping=mapping))
        require(sum(p['audio']['bytes'] for p in report['packed']) <= s['max_bytes'], 'Packed WAV headers exceed byte budget')
        report.update(status='rendered', actual_train_seconds=sum(c['audio']['duration'] for c in train),
                      actual_holdout_seconds=sum(c['audio']['duration'] for c in report['clips'] if c['purpose'] == 'holdout'),
                      file_duration_minimum_600s_met=sum(c['audio']['duration'] for c in train) >= 600,
                      holdout_reservation_met=sum(c['audio']['duration'] for c in report['clips'] if c['purpose'] == 'holdout') >= s['holdout_seconds'])
        # Verify every source again before publishing a successful local report.
        for source in sources.values():
            require(file_hash(source['path']) == source['sha256'], 'Source changed before completion')
    except Exception as exc:
        report.update(status='failed', error=str(exc))
        write_json(out / 'dataset.json', report)
        raise
    write_json(out / 'dataset.json', report)
    return report


def validate_dataset(plan, dataset_path):
    """Read-only revalidation of source, selection, PCM bytes and integer mappings."""
    selected, s = validate_plan(plan)
    root = local_path(str(dataset_path)).parent.resolve()
    report = object_value(read_json(dataset_path), 'Dataset')
    require(report.get('status') == 'rendered' and report.get('plan_sha256') == digest(plan),
            'Dataset failed or plan changed; render a fresh directory')
    require(report.get('manifest') == plan['manifest'] and report.get('selection') == plan['selection'] and
            report.get('review') == plan['review'], 'Dataset provenance changed')
    clips = report.get('clips', [])
    require(isinstance(clips, list) and all(isinstance(c, dict) for c in clips), 'Dataset clips must be object array')
    require(len(clips) == len(selected), 'Dataset clip selection changed')
    by_id, seen_pcm = {}, set()
    for expected, clip in zip(selected, clips):
        require(all(clip.get(k) == v for k, v in expected.items()), 'Rendered clip differs from candidate')
        path = local_path(clip['path'])
        require(path.parent == root / ('holdout' if clip['purpose'] == 'holdout' else 'clips'),
                'Clip path outside dataset')
        info = pcm_info(path)
        qc = signal_qc(path, info)
        require(info == clip['audio'] and qc == clip['qc'] and qc['status'] == 'passed' and
                info['frames'] == expected['source_end_frame'] - expected['source_start_frame'],
                'Rendered clip hash/format/frame/QC changed')
        require(qc['pcm_sha256'] not in seen_pcm, 'Duplicate PCM content')
        seen_pcm.add(qc['pcm_sha256'])
        by_id[clip['id']] = clip
    packed = report.get('packed', [])
    require(isinstance(packed, list) and all(isinstance(c, dict) for c in packed), 'Dataset packed must be object array')
    require(0 < len(packed) <= s['max_files'], 'Invalid packed file count')
    mapped = []
    for packed_file in packed:
        path = local_path(packed_file['path'])
        require(path.parent == root / 'packed', 'Packed path outside dataset')
        info = pcm_info(path)
        require(info == packed_file['audio'] and info['frames'] <= frames(s['max_pack_seconds']),
                'Packed file hash/format/frame count changed')
        offset, whole = 0, hashlib.sha256()
        with open(path, 'rb') as f:
            f.seek(info['data_offset'])
            require(isinstance(packed_file.get('mapping'), list), 'Packed mapping must be array')
            for entry in packed_file['mapping']:
                object_value(entry, 'Packed mapping entry')
                c = by_id.get(entry['clip_id'])
                require(c is not None and c['purpose'] == 'train', 'Holdout/unknown clip in training pack')
                n = c['audio']['frames']
                expected = dict(clip_id=c['id'], clip_pcm_sha256=c['qc']['pcm_sha256'],
                                source_id=c['source_id'], source_sha256=c['source_sha256'],
                                source_start_frame=c['source_start_frame'], source_end_frame=c['source_end_frame'],
                                canonical_parent_sha256=c['canonical_parent_sha256'],
                                canonical_start_frame=c['canonical_start_frame'], canonical_end_frame=c['canonical_end_frame'],
                                packed_start_frame=offset, packed_end_frame=offset+n)
                require(entry == expected and offset + n <= info['frames'], 'Packed offset/source mapping changed')
                h, remaining = hashlib.sha256(), n * 3
                while remaining:
                    block = f.read(min(98304, remaining))
                    require(block, 'Truncated packed PCM')
                    remaining -= len(block)
                    h.update(block)
                    whole.update(block)
                require(h.hexdigest() == c['qc']['pcm_sha256'], 'Packed range differs from individual clip PCM')
                offset += n
                mapped.append(c['id'])
        require(offset == info['frames'] and whole.hexdigest() == packed_file['pcm_sha256'], 'Packed PCM mismatch')
    require(mapped == plan['selection']['train'], 'Training mapping missing/duplicated/reordered clips')
    require(sum(p['audio']['bytes'] for p in packed) <= s['max_bytes'], 'Packed byte budget exceeded')
    train = [c for c in clips if c['purpose'] == 'train']
    require(report['actual_train_seconds'] == sum(c['audio']['duration'] for c in train) and
            report['actual_holdout_seconds'] == sum(c['audio']['duration'] for c in clips if c['purpose'] == 'holdout'),
            'Dataset duration totals changed')
    return dict(status='validated-local', quality='unverified', upload_ready=False,
                actual_train_seconds=report['actual_train_seconds'],
                file_duration_minimum_600s_met=report['actual_train_seconds'] >= 600,
                note='Mechanical integrity only; remote cloning still requires established rights and quality review')


def write_json(path, data):
    with open(path, 'x', encoding='utf-8') as f:
        json.dump(data, f, indent=2, allow_nan=False)
        f.write('\n')


def read_json(path):
    p = local_path(str(path))
    require(p.stat().st_size <= 64_000_000, 'JSON exceeds 64MB')
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('inspect', help='Inspect one local media file; emit metadata JSON')
    p.add_argument('source')
    p.add_argument('--stream-index', type=int)
    p = commands.add_parser('plan', help='Derive candidates from complete normalized analysis')
    p.add_argument('manifest')
    p = commands.add_parser('assemble', help='Validate a reviewed plan; dry-run unless --execute')
    p.add_argument('plan')
    p.add_argument('--output', required=True, help='Absolute fresh directory; existing parent required')
    p.add_argument('--execute', action='store_true')
    p.add_argument('--normalize', action='store_true', help='Bounded constant gain to -23 LUFS / -5dBTP, with finite QC')
    p = commands.add_parser('validate', help='Read-only source/output/frame-map revalidation before any separate upload')
    p.add_argument('plan')
    p.add_argument('dataset')
    args = parser.parse_args()
    try:
        if args.command == 'inspect':
            result = inspect(args.source, args.stream_index)
        elif args.command == 'plan':
            result = make_plan(read_json(args.manifest))
        elif args.command == 'validate':
            result = validate_dataset(read_json(args.plan), args.dataset)
        else:
            result = assemble(read_json(args.plan), args.output, args.execute, args.normalize)
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0
    except (Invalid, OSError, ValueError, KeyError, TypeError, OverflowError, struct.error) as exc:
        print(json.dumps(dict(status='failed', error=str(exc), quality='unverified')))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
