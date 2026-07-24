#!/usr/bin/env python3
"""Cheap guard against accidental A2 logging/persistence/transport additions."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1] / "app/src/main"
forbidden = (
    "SharedPreferences", "DataStore", "Room.databaseBuilder", "FileOutputStream",
    "Log.", "Timber.", "Socket(", "ProcessBuilder", "WorkManager",
    "NotificationManager", "FOREGROUND_SERVICE", "android.permission.INTERNET", "ssh://",
)
hits = []
for path in list(root.rglob("*.kt")) + list(root.rglob("*.xml")):
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if any(token in line for token in forbidden):
            hits.append(f"{path}:{number}")
if hits:
    print("privacy boundary violation:\n" + "\n".join(hits), file=sys.stderr)
    raise SystemExit(1)
print("privacy-negative check passed")
