import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from codex_radar.cli import main as legacy_main
from codex_radar.hook import main, read_hook_payload


class HookEntrypointTests(unittest.TestCase):
    def test_dedicated_hook_records_one_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "state"
            payload = {
                "hook_event_name": "Stop",
                "session_id": "session-1",
                "cwd": tmp,
            }
            output = io.StringIO()
            with redirect_stdout(output), mock.patch(
                "sys.stdin", io.StringIO(json.dumps(payload))
            ):
                result = main(["--state-dir", str(state_dir), "--print-session"])

            self.assertEqual(0, result)
            self.assertEqual("session-1", json.loads(output.getvalue())["session_id"])
            self.assertTrue((state_dir / "sessions.json").is_file())

    def test_hook_rejects_non_object_payload(self) -> None:
        with self.assertRaisesRegex(SystemExit, "must be an object"):
            read_hook_payload(io.StringIO("[]"))

    def test_legacy_cli_hook_uses_same_entrypoint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, mock.patch(
            "sys.stdin",
            io.StringIO(
                json.dumps(
                    {
                        "hook_event_name": "Stop",
                        "session_id": "legacy-session",
                        "cwd": tmp,
                    }
                )
            ),
        ):
            self.assertEqual(0, legacy_main(["--state-dir", tmp, "hook"]))
            payload = json.loads((Path(tmp) / "sessions.json").read_text(encoding="utf-8"))
            self.assertIn("legacy-session", payload["sessions"])
