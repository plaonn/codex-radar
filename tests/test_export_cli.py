import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from codex_radar.cli import main


class ExportCliTests(unittest.TestCase):
    def test_export_state_missing_source_is_json_only_and_no_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = root / "missing-state"
            codex_home = root / "codex-home"
            stdout = io.StringIO()
            stderr = io.StringIO()
            with mock.patch.dict(os.environ, {"CODEX_HOME": str(codex_home)}), redirect_stdout(
                stdout
            ), redirect_stderr(stderr):
                result = main(
                    ["--state-dir", str(state_dir), "export", "state", "--json"]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(0, result)
            self.assertEqual("codex-radar.display-state", payload["contract"])
            self.assertEqual({"status": "unavailable", "reason": "state_unavailable"}, payload["source"])
            self.assertEqual([], payload["sessions"])
            self.assertEqual("", stderr.getvalue())
            self.assertFalse(state_dir.exists())
            self.assertFalse(codex_home.exists())

    def test_export_state_emits_only_sanitized_builder_fields(self) -> None:
        marker = "/private/raw/session/transcript.jsonl"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = root / "state"
            codex_home = root / "codex-home"
            archived = codex_home / "archived_sessions" / "rollout-session-1.jsonl"
            state_dir.mkdir()
            archived.parent.mkdir(parents=True)
            archived.write_text("{}\n", encoding="utf-8")
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "done",
                                "project": "radar",
                                "cwd": "/private/raw/repo",
                                "transcript_path": marker,
                                "last_assistant_message": "private raw content",
                                "raw": {"path": marker},
                                "event_count": 2,
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            stdout = io.StringIO()
            stderr = io.StringIO()
            with mock.patch.dict(os.environ, {"CODEX_HOME": str(codex_home)}), redirect_stdout(
                stdout
            ), redirect_stderr(stderr):
                result = main(
                    ["--state-dir", str(state_dir), "export", "state", "--json"]
                )

            payload = json.loads(stdout.getvalue())
            encoded = stdout.getvalue()
            self.assertEqual(0, result)
            self.assertEqual("", stderr.getvalue())
            self.assertEqual("archived", payload["sessions"][0]["archive_state"])
            self.assertEqual(
                ["archive-state", "transcript-preview", "usage"],
                payload["capabilities"],
            )
            for forbidden in (
                marker,
                "/private/raw/repo",
                "transcript_path",
                "last_assistant_message",
                "private raw content",
                '"raw"',
            ):
                self.assertNotIn(forbidden, encoded)

    def test_export_state_invalid_source_uses_safe_protocol_reason(self) -> None:
        marker = "/private/broken/source"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = root / "state"
            state_dir.mkdir()
            (state_dir / "sessions.json").write_text(marker, encoding="utf-8")

            stdout = io.StringIO()
            stderr = io.StringIO()
            with mock.patch.dict(
                os.environ, {"CODEX_HOME": str(root / "codex-home")}
            ), redirect_stdout(stdout), redirect_stderr(stderr):
                result = main(
                    ["--state-dir", str(state_dir), "export", "state", "--json"]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(0, result)
            self.assertEqual({"status": "invalid", "reason": "state_invalid"}, payload["source"])
            self.assertNotIn(marker, stdout.getvalue())
            self.assertEqual("", stderr.getvalue())

    def test_export_preview_is_explicit_bounded_and_protocol_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = root / "state"
            codex_home = root / "codex-home"
            transcript = codex_home / "sessions" / "rollout-session-1.jsonl"
            state_dir.mkdir()
            transcript.parent.mkdir(parents=True)
            transcript.write_text(
                "\n".join(
                    json.dumps(item)
                    for item in (
                        {"role": "assistant", "content": [{"text": "old"}]},
                        {"role": "tool", "content": [{"text": "/private/tool-output"}]},
                        {"role": "user", "content": [{"text": "question"}]},
                        {"role": "assistant", "content": [{"text": "token=supersecret"}]},
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "done",
                                "transcript_path": str(transcript),
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            stdout = io.StringIO()
            stderr = io.StringIO()
            with mock.patch.dict(os.environ, {"CODEX_HOME": str(codex_home)}), redirect_stdout(
                stdout
            ), redirect_stderr(stderr):
                result = main(
                    [
                        "--state-dir",
                        str(state_dir),
                        "export",
                        "preview",
                        "session-1",
                        "--limit",
                        "2",
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(0, result)
            self.assertEqual("", stderr.getvalue())
            self.assertEqual("codex-radar.transcript-preview", payload["contract"])
            self.assertEqual(2, payload["limit"])
            self.assertEqual(
                [
                    {"role": "user", "text": "question"},
                    {"role": "assistant", "text": "[REDACTED]"},
                ],
                payload["messages"],
            )
            self.assertNotIn("/private/tool-output", stdout.getvalue())

    def test_export_preview_failure_has_empty_stdout_and_safe_stderr(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = root / "state"
            state_dir.mkdir()
            (state_dir / "sessions.json").write_text(
                json.dumps({"schema_version": 1, "sessions": {}}),
                encoding="utf-8",
            )
            stdout = io.StringIO()
            stderr = io.StringIO()
            with mock.patch.dict(
                os.environ, {"CODEX_HOME": str(root / "codex-home")}
            ), redirect_stdout(stdout), redirect_stderr(stderr):
                result = main(
                    [
                        "--state-dir",
                        str(state_dir),
                        "export",
                        "preview",
                        "/private/session-id",
                        "--limit",
                        "1",
                    ]
                )

            self.assertEqual(2, result)
            self.assertEqual("", stdout.getvalue())
            self.assertEqual("codex-radar export: invalid_session_id\n", stderr.getvalue())
            self.assertNotIn("/private", stderr.getvalue())

    def test_export_preview_does_not_match_a_longer_session_identity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = root / "state"
            codex_home = root / "codex-home"
            transcript = codex_home / "sessions" / "rollout-session-10.jsonl"
            state_dir.mkdir()
            transcript.parent.mkdir(parents=True)
            transcript.write_text(
                json.dumps({"role": "assistant", "content": "wrong session"}) + "\n",
                encoding="utf-8",
            )
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "done",
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            stdout = io.StringIO()
            stderr = io.StringIO()
            with mock.patch.dict(os.environ, {"CODEX_HOME": str(codex_home)}), redirect_stdout(
                stdout
            ), redirect_stderr(stderr):
                result = main(
                    [
                        "--state-dir",
                        str(state_dir),
                        "export",
                        "preview",
                        "session-1",
                        "--limit",
                        "1",
                    ]
                )

            self.assertEqual(2, result)
            self.assertEqual("", stdout.getvalue())
            self.assertEqual(
                "codex-radar export: transcript_unavailable\n",
                stderr.getvalue(),
            )

    def test_export_preview_rejects_symlink_transcript(self) -> None:
        marker = "arbitrary symlink target content"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = root / "state"
            codex_home = root / "codex-home"
            target = root / "private.jsonl"
            symlink = codex_home / "sessions" / "rollout-session-1.jsonl"
            state_dir.mkdir()
            symlink.parent.mkdir(parents=True)
            target.write_text(
                json.dumps({"role": "assistant", "content": marker}) + "\n",
                encoding="utf-8",
            )
            try:
                symlink.symlink_to(target)
            except (NotImplementedError, OSError) as exc:
                self.skipTest(f"symlink unsupported: {exc}")
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "done",
                                "transcript_path": str(symlink),
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            stdout = io.StringIO()
            stderr = io.StringIO()
            with mock.patch.dict(os.environ, {"CODEX_HOME": str(codex_home)}), redirect_stdout(
                stdout
            ), redirect_stderr(stderr):
                result = main(
                    [
                        "--state-dir",
                        str(state_dir),
                        "export",
                        "preview",
                        "session-1",
                        "--limit",
                        "1",
                    ]
                )

            self.assertEqual(2, result)
            self.assertEqual("", stdout.getvalue())
            self.assertNotIn(marker, stdout.getvalue())
            self.assertEqual(
                "codex-radar export: transcript_unavailable\n",
                stderr.getvalue(),
            )

    def test_moved_basename_fallback_requires_requested_session_identity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = root / "state"
            codex_home = root / "codex-home"
            unrelated = codex_home / "archived_sessions" / "rollout-session-2.jsonl"
            state_dir.mkdir()
            unrelated.parent.mkdir(parents=True)
            unrelated.write_text(
                json.dumps({"role": "assistant", "content": "wrong session"}) + "\n",
                encoding="utf-8",
            )
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "done",
                                "transcript_path": "/moved/rollout-session-2.jsonl",
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            stdout = io.StringIO()
            stderr = io.StringIO()
            with mock.patch.dict(os.environ, {"CODEX_HOME": str(codex_home)}), redirect_stdout(
                stdout
            ), redirect_stderr(stderr):
                result = main(
                    [
                        "--state-dir",
                        str(state_dir),
                        "export",
                        "preview",
                        "session-1",
                        "--limit",
                        "1",
                    ]
                )

            self.assertEqual(2, result)
            self.assertEqual("", stdout.getvalue())
            self.assertEqual(
                "codex-radar export: transcript_unavailable\n",
                stderr.getvalue(),
            )

    def test_moved_basename_fallback_preserves_exact_session_match(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = root / "state"
            codex_home = root / "codex-home"
            moved = codex_home / "archived_sessions" / "rollout-session-1.jsonl"
            state_dir.mkdir()
            moved.parent.mkdir(parents=True)
            moved.write_text(
                json.dumps({"role": "assistant", "content": "moved transcript"}) + "\n",
                encoding="utf-8",
            )
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "done",
                                "transcript_path": "/moved/rollout-session-1.jsonl",
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            stdout = io.StringIO()
            stderr = io.StringIO()
            with mock.patch.dict(os.environ, {"CODEX_HOME": str(codex_home)}), redirect_stdout(
                stdout
            ), redirect_stderr(stderr):
                result = main(
                    [
                        "--state-dir",
                        str(state_dir),
                        "export",
                        "preview",
                        "session-1",
                        "--limit",
                        "1",
                    ]
                )

            self.assertEqual(0, result)
            self.assertEqual("", stderr.getvalue())
            self.assertEqual(
                [{"role": "assistant", "text": "moved transcript"}],
                json.loads(stdout.getvalue())["messages"],
            )


if __name__ == "__main__":
    unittest.main()
