"""Offline request planner. Never reads credentials, contacts APIs, or writes files.

Checks documented structural limits only; the service owns lexical normalization,
language/phone validation, availability, permissions and concurrency validation.
"""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import re


def nonblank(value, label, limit=None):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a nonblank string")
    if limit is not None and len(value) > limit:
        raise ValueError(f"{label} exceeds {limit} Unicode code points")


def resource_name(name):
    if not isinstance(name, str) or not re.fullmatch(
        r"workspaces/[^/\s{}?#%]+/pronunciationDictionaries/[^/\s{}?#%]+", name
    ):
        raise ValueError("Use a full returned dictionary name, without placeholders")
    return name


def entries_shape(entries):
    if not isinstance(entries, list) or len(entries) > 1000:
        raise ValueError("pronunciations must be an array of at most 1000 entries")
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {
            "displayHeadword", "languageCode", "phoneSymbols"
        }:
            raise ValueError("Each entry needs exactly displayHeadword, languageCode, phoneSymbols")
        word, language, phones = (entry[k] for k in (
            "displayHeadword", "languageCode", "phoneSymbols"
        ))
        nonblank(word, "displayHeadword", 128)
        if any(c.isspace() for c in word):
            raise ValueError("Headword must be one lexical token; phrases are unsupported")
        nonblank(language, "languageCode")
        if language.lower() == "auto":
            raise ValueError("Use an exact concrete palette language code")
        # No invented BCP-47 catalog or lowercase canonicalization here.
        if not isinstance(phones, list) or not 1 <= len(phones) <= 64:
            raise ValueError("phoneSymbols needs 1–64 complete phone tokens")
        for phone in phones:
            nonblank(phone, "phone token", 16)
            if "/" in phone or any(c.isspace() for c in phone):
                raise ValueError("Use whole phone tokens without slash delimiters or whitespace")
        identity = (language, word)
        if identity in seen:
            raise ValueError("Duplicate exact headword/language; service also checks normalized identities")
        seen.add(identity)
    encoded = json.dumps({"pronunciations": entries}, ensure_ascii=False).encode("utf-8")
    if len(encoded) > 512 * 1024:
        raise ValueError("Entry JSON alone exceeds the 512 KiB dictionary limit")


def update_plan(current, desired):
    """Complete replacement from a GET snapshot and desired full entries."""
    name = resource_name(current.get("name"))
    nonblank(current.get("etag"), "current etag")
    before = current.get("pronunciations")
    entries_shape(before)
    entries_shape(desired)
    return {
        "dryRun": True,
        "request": {
            "method": "PATCH", "path": f"/pronunciations/v1/{name}",
            "query": {"updateMask": "pronunciations"},
            "body": {"pronunciations": deepcopy(desired), "etag": current["etag"]},
        },
        "review": {
            "before": deepcopy(before), "after": deepcopy(desired),
            "clearsDictionary": len(desired) == 0,
            "removedExactEntries": [deepcopy(e) for e in before if e not in desired],
            "addedExactEntries": [deepcopy(e) for e in desired if e not in before],
        },
        "requiresServiceValidation": True,
    }


def rename_plan(current, display_name):
    name = resource_name(current.get("name"))
    nonblank(current.get("etag"), "current etag")
    nonblank(display_name, "displayName", 64)
    return {
        "dryRun": True,
        "request": {
            "method": "PATCH", "path": f"/pronunciations/v1/{name}",
            "query": {"updateMask": "displayName"},
            "body": {"displayName": display_name, "etag": current["etag"]},
        },
        "review": {"before": current.get("displayName"), "after": display_name},
    }


def named_selection(names, request_config=None):
    """Return selector fragment; optional config is checked for conflicts, not merged.

    Caller must inspect the final serialized request for SDK-injected defaults.
    """
    config = request_config if request_config is not None else {}
    if any(k in config for k in ("enable_custom_pronunciation", "enableCustomPronunciation")):
        raise ValueError("Remove the workspace boolean entirely, even when false")
    if not isinstance(names, list) or not 1 <= len(names) <= 3:
        raise ValueError("Select 1–3 distinct full returned names")
    checked = [resource_name(n) for n in names]
    if len(set(checked)) != len(checked):
        raise ValueError("Duplicate dictionary selection")
    if len({n.split('/')[1] for n in checked}) != 1:
        raise ValueError("All dictionaries must belong to one workspace")
    return {"pronunciationDictionarySettings": {
        "dictionaries": [{"dictionary": n} for n in checked]
    }}


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    update = commands.add_parser("update", help="Preview a complete entry replacement")
    update.add_argument("current")
    update.add_argument("entries")
    rename = commands.add_parser("rename", help="Preview metadata-only rename")
    rename.add_argument("current")
    rename.add_argument("display_name")
    selection = commands.add_parser("selection", help="Preview an ordered named selector")
    selection.add_argument("names")
    args = parser.parse_args()
    try:
        if args.command == "update":
            result = update_plan(load_json(args.current), load_json(args.entries))
        elif args.command == "rename":
            result = rename_plan(load_json(args.current), args.display_name)
        else:
            result = {"dryRun": True, "selector": named_selection(load_json(args.names)),
                      "requiresAvailabilityCheck": True}
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, TypeError, AttributeError, OSError) as exc:
        parser.exit(2, f"Cannot plan: {exc}\n")


if __name__ == "__main__":
    main()
