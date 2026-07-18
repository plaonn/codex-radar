import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path

from codex_radar.cli import build_parser, main
from codex_radar.store import load_sessions


class CliTests(unittest.TestCase):
    def test_module_execution_invokes_main(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "missing-state"
            env = dict(os.environ)
            env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")

            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "codex_radar.cli",
                    "--state-dir",
                    str(state_dir),
                    "path",
                ],
                check=False,
                capture_output=True,
                text=True,
                env=env,
            )

            self.assertEqual("", result.stderr)
            self.assertEqual(0, result.returncode)
            self.assertEqual(f"{state_dir}\n", result.stdout)

    def test_path_prints_state_dir_without_creating_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "missing-state"

            out = io.StringIO()
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "path"])

            self.assertEqual(f"{state_dir}\n", out.getvalue())
            self.assertFalse(state_dir.exists())

    def test_sessions_json_does_not_create_missing_state_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "missing-state"

            out = io.StringIO()
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "sessions", "--json"])

            self.assertEqual([], json.loads(out.getvalue()))
            self.assertFalse(state_dir.exists())

    def test_sessions_prints_display_status_and_filters_stale(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "sessions": {
                            "old-running": {
                                "session_id": "old-running",
                                "status": "running",
                                "project": "project-a",
                                "last_seen_at": "2000-01-01T00:00:00+00:00",
                            },
                            "done": {
                                "session_id": "done",
                                "status": "done",
                                "project": "project-b",
                                "last_seen_at": "2026-07-03T00:00:00+00:00",
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "sessions", "--status", "stale"])

            output = out.getvalue()
            self.assertIn("stale", output)
            self.assertIn("old-running", output)
            self.assertNotIn("project-b", output)

    def test_sessions_json_includes_display_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "done",
                                "last_seen_at": "2026-07-03T00:00:00+00:00",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "sessions", "--json"])

            payload = json.loads(out.getvalue())
            self.assertEqual("done", payload[0]["display_status"])

    def test_sessions_group_project_groups_text_output_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "a1": {
                                "session_id": "a1",
                                "status": "done",
                                "project": "project-a",
                                "last_seen_at": "2026-07-03T03:00:00+00:00",
                            },
                            "b1": {
                                "session_id": "b1",
                                "status": "done",
                                "project": "project-b",
                                "last_seen_at": "2026-07-03T02:00:00+00:00",
                            },
                            "a2": {
                                "session_id": "a2",
                                "status": "done",
                                "project": "project-a",
                                "last_seen_at": "2026-07-03T01:00:00+00:00",
                            },
                        }
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "sessions", "--group-project"])

        output = out.getvalue()
        self.assertIn("Project: project-a (2)", output)
        self.assertIn("Project: project-b (1)", output)
        self.assertLess(output.index("Project: project-a"), output.index("Project: project-b"))
        self.assertLess(output.index("a1"), output.index("a2"))

    def test_sessions_json_ignores_group_project_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "done",
                                "project": "project-a",
                                "last_seen_at": "2026-07-03T00:00:00+00:00",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "sessions", "--json", "--group-project"])

        payload = json.loads(out.getvalue())
        self.assertIsInstance(payload, list)
        self.assertEqual("session-1", payload[0]["session_id"])

    def test_sessions_filters_by_model_and_recent_duration(self) -> None:
        now = datetime.now(timezone.utc).replace(microsecond=0)
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "recent-target": {
                                "session_id": "recent-target",
                                "status": "done",
                                "model": "gpt-5",
                                "last_seen_at": (now - timedelta(hours=1)).isoformat(),
                            },
                            "old-target": {
                                "session_id": "old-target",
                                "status": "done",
                                "model": "gpt-5",
                                "last_seen_at": (now - timedelta(days=2)).isoformat(),
                            },
                            "recent-other-model": {
                                "session_id": "recent-other-model",
                                "status": "done",
                                "model": "gpt-4.1",
                                "last_seen_at": now.isoformat(),
                            },
                        }
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(
                    [
                        "--state-dir",
                        str(state_dir),
                        "sessions",
                        "--json",
                        "--model",
                        "gpt-5",
                        "--since",
                        "12h",
                    ]
                )

            payload = json.loads(out.getvalue())
            self.assertEqual(["recent-target"], [row["session_id"] for row in payload])

    def test_sessions_since_accepts_iso_timestamp(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "before": {
                                "session_id": "before",
                                "status": "done",
                                "last_seen_at": "2026-07-02T23:59:59+00:00",
                            },
                            "after": {
                                "session_id": "after",
                                "status": "done",
                                "last_seen_at": "2026-07-03T00:00:00+00:00",
                            },
                        }
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(
                    [
                        "--state-dir",
                        str(state_dir),
                        "sessions",
                        "--json",
                        "--since",
                        "2026-07-03T00:00:00+00:00",
                    ]
                )

            payload = json.loads(out.getvalue())
            self.assertEqual(["after"], [row["session_id"] for row in payload])

    def test_watch_once_reports_existing_done_when_requested(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "done",
                                "project": "project-a",
                                "last_event_name": "Stop",
                                "last_seen_at": "2026-07-03T00:00:00+00:00",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(
                    [
                        "--state-dir",
                        str(state_dir),
                        "watch",
                        "--once",
                        "--no-bell",
                        "--include-existing",
                        "--quiet-start",
                    ]
                )

            self.assertEqual(
                "codex-radar: done project=project-a event=Stop\n",
                out.getvalue(),
            )

    def test_watch_status_can_report_waiting_approval(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "waiting_approval",
                                "project": "project-a",
                                "last_event_name": "PermissionRequest",
                                "last_seen_at": "2026-07-03T00:00:00+00:00",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(
                    [
                        "--state-dir",
                        str(state_dir),
                        "watch",
                        "--once",
                        "--no-bell",
                        "--status",
                        "waiting_approval",
                        "--include-existing",
                        "--quiet-start",
                    ]
                )

            self.assertEqual(
                "codex-radar: waiting_approval project=project-a event=PermissionRequest\n",
                out.getvalue(),
            )

    def test_reconcile_dry_run_reports_terminal_update_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "state"
            state_dir.mkdir()
            rollout = Path(tmp) / "rollout-session-1.jsonl"
            rollout.write_text(
                json.dumps(
                    {
                        "timestamp": "2026-07-17T00:02:00Z",
                        "type": "event_msg",
                        "payload": {"type": "task_complete", "turn_id": "turn-1"},
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            original = {
                "sessions": {
                    "session-1": {
                        "session_id": "session-1",
                        "status": "running",
                        "last_seen_at": "2026-07-17T00:01:00+00:00",
                        "transcript_path": str(rollout),
                        "event_count": 1,
                    }
                }
            }
            (state_dir / "sessions.json").write_text(json.dumps(original), encoding="utf-8")

            out = io.StringIO()
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "reconcile", "--dry-run"])

            self.assertEqual(1, json.loads(out.getvalue())["updated_count"])
            self.assertEqual(original["sessions"], load_sessions(state_dir))

    def test_config_get_and_set_retention_days(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)

            out = io.StringIO()
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "config", "get", "retention_days"])
            self.assertEqual("7\n", out.getvalue())

            out = io.StringIO()
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "config", "set", "retention_days", "14"])
            self.assertEqual(14, json.loads(out.getvalue())["retention_days"])

            out = io.StringIO()
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "config", "get", "retention_days"])
            self.assertEqual("14\n", out.getvalue())

    def test_usage_json_reads_codex_home_without_creating_radar_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "missing-state"
            codex_home = Path(tmp) / "codex-home"
            rollout = codex_home / "sessions" / "2026" / "07" / "06" / "rollout-usage.jsonl"
            rollout.parent.mkdir(parents=True)
            rollout.write_text(
                json.dumps(
                    {
                        "timestamp": "2026-07-06T00:01:02+00:00",
                        "type": "event_msg",
                        "payload": {
                            "type": "token_count",
                            "info": {"last_token_usage": {"total_tokens": 7}},
                            "rate_limits": {
                                "primary": {"used_percent": 10, "window_minutes": 300},
                                "secondary": {"used_percent": 20, "window_minutes": 10080},
                            },
                        },
                    }
                )
                + "\n",
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(
                    [
                        "--state-dir",
                        str(state_dir),
                        "usage",
                        "--json",
                        "--codex-home",
                        str(codex_home),
                    ]
                )

            payload = json.loads(out.getvalue())
            self.assertEqual(True, payload["available"])
            self.assertEqual("2026-07-06T00:01:02+00:00", payload["client_event_at"])
            self.assertEqual("rollout-envelope-timestamp", payload["timestamp_provenance"])
            self.assertEqual("codex-session-rollout-v2", payload["source_adapter_revision"])
            self.assertEqual(10.0, payload["primary"]["used_percent"])
            self.assertEqual({"total_tokens": 7}, payload["last_token_usage"])
            self.assertFalse(state_dir.exists())

    def test_prune_reports_and_removes_old_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "events.jsonl").write_text('{"legacy": true}\n', encoding="utf-8")
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "old": {
                                "session_id": "old",
                                "status": "done",
                                "last_seen_at": "2000-01-01T00:00:00+00:00",
                            },
                            "recent": {
                                "session_id": "recent",
                                "status": "done",
                                "last_seen_at": datetime.now(timezone.utc).isoformat(),
                            },
                        }
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "prune", "--retention-days", "7"])

            payload = json.loads(out.getvalue())
            self.assertEqual(["old"], payload["removed_sessions"])
            self.assertTrue(payload["legacy_events_removed"])
            remaining = json.loads((state_dir / "sessions.json").read_text(encoding="utf-8"))
            self.assertEqual(["recent"], list(remaining["sessions"]))

    def test_completion_prints_shell_script(self) -> None:
        out = io.StringIO()
        with redirect_stdout(out):
            main(["completion", "fish"])

        output = out.getvalue()
        self.assertIn("complete -c codex-radar", output)
        self.assertIn("sessions tui", output)
        self.assertIn("group-project", output)
        self.assertIn("include-existing", output)
        self.assertIn("retention-days", output)
        self.assertIn("codex-home", output)
        self.assertIn("export", output)
        self.assertIn("state preview", output)
        self.assertIn("subcommand_from export", output)
        self.assertIn("subcommand_from preview' -l limit", output)

    def test_export_completion_is_present_in_all_shells(self) -> None:
        for shell in ("bash", "zsh", "fish"):
            with self.subTest(shell=shell):
                out = io.StringIO()
                with redirect_stdout(out):
                    main(["completion", shell])
                output = out.getvalue()
                self.assertIn("export", output)
                self.assertIn("state", output)
                self.assertIn("preview", output)
                self.assertIn("json", output)
                self.assertIn("limit", output)

    def test_thread_one_shot_commands_accept_documented_arguments(self) -> None:
        parser = build_parser()
        cases = [
            (["thread", "doctor"], "doctor"),
            (["thread", "start", "hello", "--cwd", "/repo", "--model", "gpt-test"], "start"),
            (["thread", "list", "--limit", "3"], "list"),
            (["thread", "read", "thread-1", "--turn-limit", "2"], "read"),
            (["thread", "send", "thread-1", "follow up"], "send"),
        ]

        for argv, command in cases:
            with self.subTest(argv=argv):
                self.assertEqual(command, parser.parse_args(argv).thread_command)

    def test_thread_completion_lists_one_shot_commands(self) -> None:
        for shell in ("bash", "zsh", "fish"):
            with self.subTest(shell=shell):
                out = io.StringIO()
                with redirect_stdout(out):
                    main(["completion", shell])
                output = out.getvalue()
                for command in ("doctor", "start", "list", "read", "send"):
                    self.assertIn(command, output)


if __name__ == "__main__":
    unittest.main()
