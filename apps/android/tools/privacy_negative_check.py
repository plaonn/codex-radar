#!/usr/bin/env python3
"""Guard the A3.1 privacy/lifecycle boundary while allowing its exact transport."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1] / "app/src/main"
forbidden = (
    "DataStore", "Room.databaseBuilder", "FileOutputStream", "Log.", "Timber.",
    "ProcessBuilder", "WorkManager", "NotificationManager", "FOREGROUND_SERVICE",
    "<service", "<receiver", "<provider", "ssh://",
)
hits = []
for path in list(root.rglob("*.kt")) + list(root.rglob("*.xml")):
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if any(token in line for token in forbidden):
            hits.append(f"{path}:{number}")
if hits:
    print("privacy boundary violation:\n" + "\n".join(hits), file=sys.stderr)
    raise SystemExit(1)

profile_store = root / "java/dev/codexradar/cockpit/profile/HostProfileStore.kt"
for path in root.rglob("*.kt"):
    if "getSharedPreferences(" in path.read_text() and path != profile_store:
        print(f"privacy boundary violation: preference access outside {profile_store}", file=sys.stderr)
        raise SystemExit(1)

manifest = (root / "AndroidManifest.xml").read_text()
if manifest.count("android.permission.INTERNET") != 1:
    print("privacy boundary violation: exact INTERNET permission missing", file=sys.stderr)
    raise SystemExit(1)
print("privacy-negative check passed")
