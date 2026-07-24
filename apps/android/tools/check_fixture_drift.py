#!/usr/bin/env python3
"""Mechanical A2 fixture derivation; intentionally no host/protocol interpretation."""
import argparse
import json
from pathlib import Path
import hashlib
import copy
import sys

root = Path(__file__).resolve().parents[3]
android = Path(__file__).resolve().parents[1]
canonical = root / "tests/fixtures/mobile-rpc-v1.json"
display = root / "tests/fixtures/display-state-v1.json"
preview = root / "tests/fixtures/transcript-preview-v2.json"
outputs = [
    android / "app/src/main/assets/mobile-rpc-v1.rich.json",
    android / "app/src/test/resources/mobile-rpc-v1.rich.json",
]

def compact(value):
    return json.dumps(value, indent=2, sort_keys=False) + "\n"

def derive():
    fixture = json.loads(canonical.read_text())
    state = json.loads(display.read_text())
    preview_result = json.loads(preview.read_text())
    # Add a second project by copying host-owned session fields unchanged except
    # for opaque identity/project. This exercises grouping without reinterpreting
    # status, archive, redaction, or attention semantics.
    second_project = copy.deepcopy(state["sessions"][1])
    second_project["session_id"] = "running-2"
    second_project["project"] = "context"
    state["sessions"].append(second_project)
    state["counts"]["total"] += 1
    state["counts"]["visible"] += 1
    state["counts"]["archive_unknown"] += 1
    state["counts"]["running"] += 1
    # Preserve the canonical request/initialize/preview/shutdown framing, while
    # replacing only empty example payloads with host-owned current goldens.
    for exchange in fixture["exchanges"]:
        method = exchange["request"]["method"]
        if method == "state/read":
            exchange["messages"][0]["result"] = state
        elif method == "preview/read":
            exchange["request"]["params"]["session_id"] = "waiting-1"
            preview_result["session_id"] = "waiting-1"
            exchange["messages"][0]["result"] = preview_result
    fixture["derived_from"] = {
        "mobile_rpc": "tests/fixtures/mobile-rpc-v1.json",
        "display_state": "tests/fixtures/display-state-v1.json",
        "preview": "tests/fixtures/transcript-preview-v2.json",
    }
    return compact(fixture).encode()

parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
payload = derive()
expected = hashlib.sha256(payload).hexdigest()
if args.check:
    wrong = [str(path) for path in outputs if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != expected]
    if wrong:
        print("fixture drift: " + ", ".join(wrong), file=sys.stderr)
        raise SystemExit(1)
    print("derived fixture copies match " + expected)
else:
    for output in outputs:
        output.write_bytes(payload)
    print("derived fixture copies written " + expected)
