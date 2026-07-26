#!/usr/bin/env python3
"""Guard A2 production code while allowing the isolated A3.0 SSH spike."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1] / "app/src/main"
forbidden = (
    "SharedPreferences", "DataStore", "Room.databaseBuilder", "FileOutputStream",
    "Log.", "Timber.", "Socket(", "ProcessBuilder", "WorkManager",
    "NotificationManager", "FOREGROUND_SERVICE", "ssh://",
)
hits = []
for path in list(root.rglob("*.kt")) + list(root.rglob("*.xml")):
    if "a3spike" in path.parts:
        # The adopted A3.0 experiment owns a bounded SSH transport write set.
        # Persistence, logging, background execution, and raw URI forms remain forbidden.
        spike_forbidden = forbidden
        tokens = spike_forbidden
    elif path.name == "AndroidManifest.xml":
        # INTERNET is required only by the isolated spike; no exported/background service is allowed.
        tokens = forbidden + ("android:service",)
    else:
        tokens = forbidden + ("android.permission.INTERNET",)
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if any(token in line for token in tokens):
            hits.append(f"{path}:{number}")
if hits:
    print("privacy boundary violation:\n" + "\n".join(hits), file=sys.stderr)
    raise SystemExit(1)
print("privacy-negative check passed")
