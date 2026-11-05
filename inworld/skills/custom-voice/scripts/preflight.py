#!/usr/bin/env python3
"""Read-only PCM WAV inspection. No network, playback, edits or API execution."""

import argparse
import hashlib
import json
from pathlib import Path
import wave


MODES = ("ivc-portal", "ivc-api", "ivc-mcp", "pvc-portal", "pvc-api")


def pcm_bits(source, container_end):
    """Read the original PCM bit depth; wave rounds non-byte depths upward."""
    while source.tell() + 8 <= container_end:
        chunk = source.read(8)
        size = int.from_bytes(chunk[4:], "little")
        end = source.tell() + size
        if end > container_end:
            raise ValueError("WAV subchunk exceeds RIFF bounds")
        if chunk[:4] == b"fmt ":
            if size < 16:
                raise ValueError("Incomplete WAV format chunk")
            fmt = source.read(16)
            if int.from_bytes(fmt[:2], "little") != 1:
                return None  # Float, compressed and extensible formats need another inspector.
            bits = int.from_bytes(fmt[14:16], "little")
            if bits not in (8, 16, 24, 32):
                raise ValueError("Unsupported PCM bit depth; expected 8, 16, 24 or 32")
            channels = int.from_bytes(fmt[2:4], "little")
            alignment = int.from_bytes(fmt[12:14], "little")
            if channels < 1 or alignment != channels * (bits // 8):
                raise ValueError("PCM block alignment does not match channels and bit depth")
            return bits
        source.seek(end + (size % 2))
    raise ValueError("Missing WAV format chunk")


def inspect_wav(path):
    """Inspect actual bytes; stream frames to detect a truncated data chunk."""
    path = Path(path)
    row = {"path": str(path), "errors": [], "warnings": [], "incomplete": False}
    try:
        if not path.is_file():
            raise ValueError("Not a regular file")
        row["size_bytes"] = path.stat().st_size
        if row["size_bytes"] == 0:
            raise ValueError("Empty file")
        if row["size_bytes"] > 1_000_000_000:
            row["incomplete"] = True
            row["warnings"].append("Local inspector skips files above 1,000,000,000 bytes")
            return row
        with path.open("rb") as source:
            header = source.read(12)
            if len(header) < 12 or header[:4] != b"RIFF" or header[8:] != b"WAVE":
                row["incomplete"] = True
                row["warnings"].append("Not RIFF WAV: use an existing local media inspector")
                return row
            if int.from_bytes(header[4:8], "little") + 8 > row["size_bytes"]:
                raise ValueError("Truncated RIFF container")
            bits = pcm_bits(source, int.from_bytes(header[4:8], "little") + 8)
            if bits is None:
                row["incomplete"] = True
                row["warnings"].append("Only plain integer PCM WAV is inspected locally")
                return row
        try:
            audio = wave.open(str(path), "rb")
        except wave.Error:
            row["incomplete"] = True
            row["warnings"].append("Unsupported or malformed WAV; inspect locally before use")
            return row
        with audio:
            frames = audio.getnframes()
            rate = audio.getframerate()
            channels = audio.getnchannels()
            width = audio.getsampwidth()
            if rate <= 0 or frames <= 0:
                raise ValueError("No audio frames")
            if audio.getcomptype() != "NONE" or width not in (1, 2, 3, 4):
                row["incomplete"] = True
                row["warnings"].append("Only integer PCM WAV is supported locally")
                return row
            decoded_bytes = 0
            pcm_digest = hashlib.sha256()
            while True:
                chunk = audio.readframes(65536)
                if not chunk:
                    break
                decoded_bytes += len(chunk)
                pcm_digest.update(chunk)
            if decoded_bytes != frames * channels * width:
                raise ValueError("Truncated or incomplete PCM frames")
            row.update(duration_seconds=frames / rate, sample_rate_hz=rate,
                       channels=channels, bits_per_sample=bits, pcm_sha256=pcm_digest.hexdigest())
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        row["sha256"] = digest.hexdigest()
    except (OSError, ValueError, EOFError, RuntimeError, wave.Error) as exc:
        row["errors"].append(str(exc))
    return row


def evaluate(rows, mode):
    """Apply documented surface limits to locally inspected material only."""
    if mode not in MODES:
        raise ValueError("Unknown mode")
    errors = []
    warnings = []
    pvc = mode.startswith("pvc-")
    total_bytes = sum(row.get("size_bytes", 0) for row in rows)
    total_duration = sum(row.get("duration_seconds", 0) for row in rows)
    complete = all(not row["incomplete"] and not row["errors"] for row in rows)
    if not rows:
        errors.append("Supply at least one sample")
    if mode == "ivc-portal" and len(rows) != 1:
        errors.append("IVC Portal takes one audio file")
    if pvc:
        if len(rows) > 50:
            errors.append("PVC voice exceeds 50 samples")
        if total_bytes > 1_000_000_000:
            errors.append("PVC voice exceeds 1,000,000,000 bytes")
        if complete and total_duration < 600:
            errors.append("PVC requires at least 600 seconds after trims")
        if total_duration > 2800:
            warnings.append("PVC training may truncate audio beyond approximately 2,800 seconds")
        warnings.append("Totals exclude existing remote samples and server trims")
    seen = set()
    seen_pcm = set()
    unique_duration = 0
    for row in rows:
        errors.extend(f"{row['path']}: {msg}" for msg in row["errors"])
        warnings.extend(f"{row['path']}: {msg}" for msg in row["warnings"])
        digest = row.get("sha256")
        if digest and digest in seen:
            errors.append(f"{row['path']}: duplicate file content; do not double-count duration")
        if digest:
            seen.add(digest)
        pcm_key = (row.get("pcm_sha256"), row.get("sample_rate_hz"),
                   row.get("channels"), row.get("bits_per_sample"))
        duplicate = bool(pcm_key[0] and pcm_key in seen_pcm)
        if duplicate:
            errors.append(f"{row['path']}: duplicate decoded PCM and format; do not double-count duration")
        else:
            unique_duration += row.get("duration_seconds", 0)
        if pcm_key[0]:
            seen_pcm.add(pcm_key)
        if not pvc:
            size_limit = {"ivc-portal": 12_000_000, "ivc-mcp": 4_000_000}.get(mode)
            if size_limit and row.get("size_bytes", 0) > size_limit:
                errors.append(f"{row['path']}: exceeds conservative local {size_limit}-byte {mode} limit")
            duration = row.get("duration_seconds")
            if duration is not None and duration < 3:
                errors.append(f"{row['path']}: shorter than 3 seconds")
            if duration is not None and duration > 30:
                warnings.append(f"{row['path']}: service cuts IVC audio at 30 seconds; avoid mid-word cuts")
            if row.get("sample_rate_hz", 22000) < 22000 or row.get("bits_per_sample", 16) < 16:
                warnings.append(f"{row['path']}: below recommended IVC 22 kHz/16-bit quality")
        elif (row.get("sample_rate_hz"), row.get("bits_per_sample"), row.get("channels")) != (48000, 24, 1):
            warnings.append(f"{row['path']}: PVC optimal recording recommendation is mono 48 kHz/24-bit PCM")
    if pvc and complete and unique_duration < 600 <= total_duration:
        errors.append("PVC requires at least 600 unique decoded seconds after deduplication")
    exit_code = 1 if errors else 2 if not complete else 0
    return {
        "mode": mode, "offline_only": True, "files": rows,
        "total_bytes": total_bytes, "total_duration_seconds": total_duration,
        "unique_decoded_duration_seconds": unique_duration,
        "upload_batch_count": (len(rows) + 9) // 10 if mode == "pvc-api" else None,
        "errors": errors, "warnings": warnings,
        "inspection_complete": complete, "exit_code": exit_code,
        "manual_checks": ["Consent and permitted use", "One speaker and matching language",
                          "Clean speech, no music, clipping or excessive silence",
                          "Held-out audition; local checks do not prove API acceptance"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=MODES, required=True)
    parser.add_argument("files", nargs="+")
    args = parser.parse_args()
    report = evaluate([inspect_wav(path) for path in args.files], args.mode)
    print(json.dumps(report, indent=2))
    return report["exit_code"]


if __name__ == "__main__":
    raise SystemExit(main())
