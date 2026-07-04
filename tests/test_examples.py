import json
import tempfile
import unittest
from pathlib import Path

from codex_radar.store import load_sessions, record_hook_event


ROOT = Path(__file__).resolve().parents[1]
HOOKS_EXAMPLE = ROOT / "examples" / "hooks.json"
INSTALL_RUNBOOK = ROOT / "docs" / "runbooks" / "install-hooks.md"

RUNBOOK_EVENTS = (
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Stop",
)


def _load_hooks_example() -> dict:
    return json.loads(HOOKS_EXAMPLE.read_text(encoding="utf-8"))


def _iter_hook_commands(config: dict):
    for event_name, groups in config["hooks"].items():
        for group in groups:
            for hook in group["hooks"]:
                yield event_name, hook


class ExamplesTests(unittest.TestCase):
    def test_hooks_example_covers_runbook_hook_events(self) -> None:
        config = _load_hooks_example()

        self.assertEqual({"hooks"}, set(config))
        self.assertEqual(set(RUNBOOK_EVENTS), set(config["hooks"]))
        for event_name in RUNBOOK_EVENTS:
            self.assertIsInstance(config["hooks"][event_name], list)
            self.assertGreater(len(config["hooks"][event_name]), 0)

    def test_hooks_example_is_local_command_only(self) -> None:
        config = _load_hooks_example()

        for event_name, hook in _iter_hook_commands(config):
            with self.subTest(event_name=event_name):
                self.assertEqual("command", hook.get("type"))
                self.assertEqual("codex-radar hook", hook.get("command"))
                self.assertEqual(5, hook.get("timeout"))
                self.assertNotIn("env", hook)
                self.assertNotIn("cwd", hook)

    def test_hooks_example_records_each_configured_event(self) -> None:
        config = _load_hooks_example()

        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            for event_name in config["hooks"]:
                with self.subTest(event_name=event_name):
                    session = record_hook_event(
                        {
                            "hook_event_name": event_name,
                            "session_id": f"session-{event_name}",
                            "cwd": "/tmp/codex-radar",
                            "transcript_path": "/tmp/transcript.jsonl",
                            "model": "gpt-test",
                            "permission_mode": "default",
                        },
                        state_dir,
                    )
                    self.assertEqual(event_name, session["last_event_name"])

            sessions = load_sessions(state_dir)
            self.assertEqual(set(config["hooks"]), {item["last_event_name"] for item in sessions.values()})
            self.assertFalse((state_dir / "events.jsonl").exists())

    def test_install_runbook_keeps_hooks_json_as_manual_merge_artifact(self) -> None:
        runbook = INSTALL_RUNBOOK.read_text(encoding="utf-8")

        self.assertIn("examples/hooks.json", runbook)
        self.assertIn("~/.codex/hooks.json", runbook)
        self.assertIn("merge", runbook)
        self.assertIn("unrelated hook", runbook)
        self.assertNotIn("cp examples/hooks.json ~/.codex/hooks.json", runbook)
        self.assertNotIn("cat examples/hooks.json > ~/.codex/hooks.json", runbook)


if __name__ == "__main__":
    unittest.main()
