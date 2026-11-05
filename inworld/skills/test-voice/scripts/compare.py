#!/usr/bin/env python3
"""Compare local TTS experiment records. No network, rendering or playback."""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import sys


CONFIG_KEYS = {"model", "voice", "language", "normalization", "dictionary_version",
               "app_version", "request_options", "audio_format"}
ROW_FIELDS = {"id", "status", "attempts", "audio_ref", "reason", "metrics", "reviews",
              "error", "errors", "request_id", "request_ids", "origin", "limitations", "recorded_at"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def string(value):
    return isinstance(value, str) and bool(value.strip())


def number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def same_json(left, right):
    return (json.dumps(left, sort_keys=True, allow_nan=False)
            == json.dumps(right, sort_keys=True, allow_nan=False))


def validate_case_metadata(row, case, config, label):
    # Optional echoes of effective inputs must agree with the frozen test.
    # Case request_options are top-level overrides of the run's options.
    expected = {**config, **{k: v for k, v in case.items() if k not in ROW_FIELDS}}
    expected["request_options"] = {**config["request_options"], **case.get("request_options", {})}
    for key in row.keys() - ROW_FIELDS:
        require(key in expected,
                f"{label}/{case['id']}: unsupported per-case metadata {key}; "
                "freeze generation metadata in the manifest")
        require(same_json(row[key], expected[key]),
                f"{label}/{case['id']}: effective {key} does not match manifest/run config")


def digest(manifest):
    """Canonical JSON, UTF-8, sorted keys, no insignificant spaces."""
    return hashlib.sha256(json.dumps(manifest, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def validate_manifest(manifest):
    require(isinstance(manifest, dict) and type(manifest.get("schema_version")) is int
            and manifest["schema_version"] == 1,
            "manifest: expected schema_version 1")
    require(string(manifest.get("suite_id")), "manifest: suite_id required")
    cases = manifest.get("cases")
    require(isinstance(cases, list) and cases, "manifest: nonempty cases required")
    seen = set()
    for case in cases:
        require(isinstance(case, dict), "manifest: case must be an object")
        cid = case.get("id")
        require(string(cid) and cid not in seen, "manifest: duplicate or missing case ID")
        seen.add(cid)
        for field in ("text", "language", "source", "expected"):
            require(string(case.get(field)), f"{cid}: {field} required")
        if "request_options" in case:
            require(isinstance(case["request_options"], dict), f"{cid}: request_options must be an object")
        require(case.get("split") in ("tuning", "held_out"), f"{cid}: invalid split")
        checks = case.get("checks")
        require(isinstance(checks, list) and checks and all(string(x) for x in checks)
                and len(checks) == len(set(checks)), f"{cid}: unique listening checks required")
    require(any(c["split"] == "held_out" for c in cases), "manifest: held_out case required")
    changes = manifest.get("allowed_config_changes", [])
    require(isinstance(changes, list) and all(string(x) for x in changes)
            and len(changes) == len(set(changes)), "manifest: invalid allowed_config_changes")
    policies = manifest.get("metrics", {})
    require(isinstance(policies, dict), "manifest: metrics must be an object")
    for name, policy in policies.items():
        require(string(name) and isinstance(policy, dict), "manifest: invalid metric policy")
        require(policy.get("direction") in ("lower", "higher"), f"{name}: direction required")
        require(string(policy.get("unit")) and string(policy.get("definition")),
                f"{name}: unit and measurement definition required")
        require(number(policy.get("max_regression")) and policy["max_regression"] >= 0,
                f"{name}: finite nonnegative max_regression required")
        require(type(policy.get("required")) is bool, f"{name}: required boolean required")


def validate_run(run, manifest, label):
    require(isinstance(run, dict) and type(run.get("schema_version")) is int
            and run["schema_version"] == 1,
            f"{label}: expected schema_version 1")
    require(run.get("manifest_sha256") == digest(manifest), f"{label}: manifest hash mismatch")
    require(run.get("provenance") in ("recorded", "simulated"), f"{label}: invalid provenance")
    require(string(run.get("run_id")) and string(run.get("recorded_at")),
            f"{label}: run_id and recorded_at required")
    config = run.get("config")
    require(isinstance(config, dict) and CONFIG_KEYS <= config.keys(),
            f"{label}: missing config provenance")
    for key, value in config.items():
        require(value is not None and (value != ""), f"{label}: unknown config {key}")
    for key in CONFIG_KEYS - {"request_options"}:
        require(string(config[key]), f"{label}: {key} must be a string")
    require(isinstance(config["request_options"], dict), f"{label}: request_options must be an object")
    rows = run.get("cases")
    require(isinstance(rows, list), f"{label}: cases must be an array")
    indexed = {}
    case_specs = {c["id"]: c for c in manifest["cases"]}
    for row in rows:
        require(isinstance(row, dict), f"{label}: case must be an object")
        cid = row.get("id")
        require(string(cid) and cid in case_specs and cid not in indexed,
                f"{label}: unknown, duplicate or missing case ID")
        validate_case_metadata(row, case_specs[cid], config, label)
        require(row.get("status") in ("ok", "error", "incomplete", "skipped"),
                f"{label}/{cid}: invalid render status")
        require(type(row.get("attempts")) is int and row["attempts"] >= 0,
                f"{label}/{cid}: nonnegative attempts required")
        require(row["status"] == "skipped" or row["attempts"] > 0,
                f"{label}/{cid}: attempted status requires attempts > 0")
        if row["status"] == "ok":
            require(string(row.get("audio_ref")), f"{label}/{cid}: audio_ref required")
        else:
            require(string(row.get("reason")), f"{label}/{cid}: failure/skip reason required")
        require(isinstance(row.get("metrics", {}), dict), f"{label}/{cid}: invalid metrics")
        for name, value in row.get("metrics", {}).items():
            require(value is None or number(value), f"{label}/{cid}/{name}: expected finite number or null")
        reviews = row.get("reviews", {})
        require(isinstance(reviews, dict), f"{label}/{cid}: reviews must be an object")
        allowed = case_specs[cid]["checks"]
        for check, review in reviews.items():
            require(check in allowed and isinstance(review, dict), f"{label}/{cid}: unknown listening check")
            require(review.get("status") in ("pass", "fail", "unknown"), f"{label}/{cid}: invalid review")
            if review["status"] != "unknown":
                require(all(string(review.get(k)) for k in ("listener", "notes", "audio_ref")),
                        f"{label}/{cid}/{check}: listener, notes and audio_ref required")
                require(review["audio_ref"] == row.get("audio_ref"),
                        f"{label}/{cid}/{check}: review audio_ref mismatch")
        indexed[cid] = row
    return indexed


def counts(cases, indexed):
    result = dict(expected=len(cases), ok=0, error=0, incomplete=0, skipped=0,
                  missing=0, attempted_cases=0, attempts=0, retries=0)
    for case in cases:
        row = indexed.get(case["id"])
        result[row["status"] if row else "missing"] += 1
        if row:
            result["attempted_cases"] += int(row["attempts"] > 0)
            result["attempts"] += row["attempts"]
            result["retries"] += max(0, row["attempts"] - 1)
    return result


def compare(manifest, baseline, candidate):
    validate_manifest(manifest)
    left = validate_run(baseline, manifest, "baseline")
    right = validate_run(candidate, manifest, "candidate")
    issues, regressions, results = [], [], []
    allowed = set(manifest.get("allowed_config_changes", []))
    keys = set(baseline["config"]) | set(candidate["config"])
    differences = {k: {"baseline": baseline["config"].get(k), "candidate": candidate["config"].get(k)}
                   for k in sorted(keys)
                   if not same_json(baseline["config"].get(k), candidate["config"].get(k))}
    for key in differences:
        if key not in allowed:
            issues.append(f"unplanned config mismatch: {key}")
    simulated = any(r["provenance"] == "simulated" for r in (baseline, candidate))
    if simulated:
        issues.append("simulated input: comparison is a rehearsal, not quality evidence")
    if baseline["run_id"] == candidate["run_id"]:
        issues.append("same run_id on both sides: independent candidate evidence not established")
    for case in manifest["cases"]:
        cid = case["id"]
        b, c = left.get(cid), right.get(cid)
        item = {"id": cid, "split": case["split"], "language": case["language"],
                "statuses": [r["status"] if r else "missing" for r in (b, c)],
                "attempts": [r["attempts"] if r else 0 for r in (b, c)],
                "reasons": [r.get("reason") if r else "missing case" for r in (b, c)],
                "audio_refs": [r.get("audio_ref") if r else None for r in (b, c)],
                "listening": {}, "metrics": {}}
        results.append(item)
        for label, row in (("baseline", b), ("candidate", c)):
            if row is None or row["status"] != "ok":
                issues.append(f"{cid}: {label} {row['status'] if row else 'missing'}")
        if b and b["status"] == "ok" and c and c["status"] in ("error", "incomplete"):
            regressions.append(f"{cid}: candidate render {c['status']}")
        for check in case["checks"]:
            states = []
            for row in (b, c):
                review = row.get("reviews", {}).get(check, {}) if row else {}
                states.append(review.get("status", "unknown") if row and row["status"] == "ok" else "unknown")
            item["listening"][check] = states
            if "unknown" in states:
                issues.append(f"{cid}/{check}: listening evidence incomplete")
            if states[1] == "fail":
                # Even an inherited defect blocks readiness; don't hide it as no regression.
                issues.append(f"{cid}/{check}: candidate fails listening check")
            if states == ["pass", "fail"]:
                regressions.append(f"{cid}/{check}: listening regression")
        for name, policy in manifest.get("metrics", {}).items():
            values = [r.get("metrics", {}).get(name) if r and r["status"] == "ok" else None for r in (b, c)]
            delta = None
            state = "unknown"
            if all(v is not None for v in values):
                delta = values[1] - values[0]
                require(number(delta), f"{cid}/{name}: metric delta exceeds supported finite numeric range")
                badness = delta if policy["direction"] == "lower" else -delta
                state = "regression" if badness > policy["max_regression"] else "within_tolerance"
                if state == "regression":
                    regressions.append(f"{cid}/{name}: metric regression")
            elif policy["required"]:
                issues.append(f"{cid}/{name}: required metric unknown")
            item["metrics"][name] = {"baseline": values[0], "candidate": values[1],
                                     "delta": delta, "state": state, "unit": policy["unit"]}
        observed_metrics = ((set(b.get("metrics", {})) if b else set()) |
                            (set(c.get("metrics", {})) if c else set()))
        item["unscored_metrics"] = sorted(observed_metrics - set(manifest.get("metrics", {})))
    # An invalid comparison never attributes a difference to the proposed change.
    mismatch = any(k not in allowed for k in differences)
    same_run = baseline["run_id"] == candidate["run_id"]
    verdict = ("inconclusive" if mismatch or simulated or same_run else "regression" if regressions
               else "inconclusive" if issues else "no_regression_observed")
    groups = {"all": manifest["cases"]}
    for field in ("split", "language"):
        for value in sorted({c[field] for c in manifest["cases"]}):
            groups[f"{field}:{value}"] = [c for c in manifest["cases"] if c[field] == value]
    return {"schema_version": 1, "verdict": verdict, "simulated": simulated,
            "manifest_sha256": digest(manifest), "run_ids": [baseline["run_id"], candidate["run_id"]],
            "source_records": {"baseline": copy.deepcopy(baseline), "candidate": copy.deepcopy(candidate)},
            "config_differences": differences, "issues": issues, "regressions": regressions,
            "counts": {key: {"baseline": counts(cases, left), "candidate": counts(cases, right)}
                       for key, cases in groups.items()},
            "cases": results,
            "limits": "Compares supplied records only; does not inspect audio or authenticate listening evidence. "
                      "No regression observed is not proof of semantic correctness or production readiness."}


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=unique,
                      parse_constant=lambda token: (_ for _ in ()).throw(ValueError(f"nonfinite JSON: {token}")))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest")
    parser.add_argument("baseline", nargs="?")
    parser.add_argument("candidate", nargs="?")
    parser.add_argument("--hash", action="store_true", help="Validate manifest and print its canonical SHA-256")
    args = parser.parse_args(argv)
    try:
        manifest = read_json(args.manifest)
        validate_manifest(manifest)
        if args.hash:
            require(not args.baseline and not args.candidate, "--hash takes only a manifest")
            print(digest(manifest))
            return 0
        require(args.baseline and args.candidate, "baseline and candidate paths required")
        report = compare(manifest, read_json(args.baseline), read_json(args.candidate))
        print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
        return {"no_regression_observed": 0, "regression": 1, "inconclusive": 2}[report["verdict"]]
    except (ValueError, OSError, TypeError, OverflowError) as exc:
        print(json.dumps({"verdict": "invalid_input", "error": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
