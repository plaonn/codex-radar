import json
import os
import tempfile
import unittest
from pathlib import Path

from codex_radar.usage import format_usage_snapshot, usage_snapshot


def write_rollout(path: Path, lines: list[object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for item in lines:
            if isinstance(item, str):
                handle.write(item + "\n")
            else:
                handle.write(json.dumps(item) + "\n")


class UsageTests(unittest.TestCase):
    def test_usage_snapshot_reads_latest_token_count_rate_limits_without_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            codex_home = Path(tmp)
            rollout = codex_home / "sessions" / "2026" / "07" / "06" / "rollout-new.jsonl"
            write_rollout(
                rollout,
                [
                    {
                        "timestamp": "2026-07-05T23:58:00Z",
                        "type": "event_msg",
                        "payload": {"type": "token_count", "rate_limits": None},
                    },
                    "not json",
                    {
                        "timestamp": "2026-07-06T00:01:02.123456+00:00",
                        "type": "event_msg",
                        "payload": {
                            "type": "token_count",
                            "info": {
                                "model_context_window": 258400,
                                "last_token_usage": {"total_tokens": 100},
                                "total_token_usage": {"total_tokens": 500},
                            },
                            "rate_limits": {
                                "limit_id": "codex",
                                "plan_type": "prolite",
                                "primary": {
                                    "used_percent": 71.0,
                                    "window_minutes": 300,
                                    "resets_at": 1783285208,
                                },
                                "secondary": {
                                    "used_percent": 11,
                                    "window_minutes": 10080,
                                    "resets_at": 1783872008,
                                },
                            },
                        },
                    },
                ],
            )

            snapshot = usage_snapshot(codex_home, generated_at="2026-07-06T00:00:00+00:00")

        self.assertEqual(True, snapshot["available"])
        self.assertEqual("codex-session-rollout", snapshot["source"])
        self.assertEqual("codex-session-rollout-v2", snapshot["source_adapter_revision"])
        self.assertEqual("2026-07-06T00:01:02.123456+00:00", snapshot["client_event_at"])
        self.assertEqual(snapshot["client_event_at"], snapshot["observed_at"])
        self.assertEqual("client_event_at", snapshot["observed_at_provenance"])
        self.assertEqual("rollout-envelope-timestamp", snapshot["timestamp_provenance"])
        self.assertEqual(71.0, snapshot["primary"]["used_percent"])
        self.assertEqual(29.0, snapshot["primary"]["remaining_percent"])
        self.assertEqual("2026-07-05T21:00:08+00:00", snapshot["primary"]["resets_at_iso"])
        self.assertEqual(11.0, snapshot["secondary"]["used_percent"])
        self.assertEqual("prolite", snapshot["plan_type"])
        self.assertEqual(258400, snapshot["context_window"])
        self.assertEqual({"total_tokens": 100}, snapshot["last_token_usage"])
        self.assertNotIn(str(codex_home), json.dumps(snapshot))
        self.assertNotIn("rollout-new", json.dumps(snapshot))

    def test_usage_snapshot_returns_unavailable_without_token_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            codex_home = Path(tmp)
            write_rollout(
                codex_home / "sessions" / "2026" / "07" / "06" / "rollout-empty.jsonl",
                [{"type": "event_msg", "payload": {"type": "other"}}],
            )

            snapshot = usage_snapshot(codex_home, generated_at="2026-07-06T00:00:00+00:00")

        self.assertEqual(False, snapshot["available"])
        self.assertEqual("token_count_unavailable", snapshot["reason"])

    def test_usage_snapshot_handles_null_rate_limits(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            codex_home = Path(tmp)
            write_rollout(
                codex_home / "sessions" / "2026" / "07" / "06" / "rollout-null.jsonl",
                [
                    {
                        "timestamp": "2026-07-06T00:01:02+00:00",
                        "type": "event_msg",
                        "payload": {
                            "type": "token_count",
                            "info": {"model_context_window": 123},
                            "rate_limits": None,
                        },
                    }
                ],
            )

            snapshot = usage_snapshot(codex_home, generated_at="2026-07-06T00:00:00+00:00")

        self.assertEqual(False, snapshot["available"])
        self.assertEqual("rate_limits_unavailable", snapshot["reason"])
        self.assertEqual(123, snapshot["context_window"])
        self.assertEqual("2026-07-06T00:01:02+00:00", snapshot["client_event_at"])
        self.assertEqual("rollout-envelope-timestamp", snapshot["timestamp_provenance"])

    def test_usage_snapshot_does_not_invent_event_time_when_timestamp_is_missing_or_malformed(self) -> None:
        for timestamp in (None, "not-a-timestamp", "2026-07-06T00:01:02"):
            with self.subTest(timestamp=timestamp), tempfile.TemporaryDirectory() as tmp:
                codex_home = Path(tmp)
                item = {
                    "type": "event_msg",
                    "payload": {
                        "type": "token_count",
                        "rate_limits": {"primary": {"used_percent": 25, "window_minutes": 300}},
                    },
                }
                if timestamp is not None:
                    item["timestamp"] = timestamp
                write_rollout(
                    codex_home / "sessions" / "2026" / "07" / "06" / "rollout-no-time.jsonl",
                    [item],
                )

                snapshot = usage_snapshot(codex_home, generated_at="2026-07-06T00:00:00+00:00")

                self.assertEqual(True, snapshot["available"])
                self.assertEqual("unavailable", snapshot["timestamp_provenance"])
                self.assertNotIn("client_event_at", snapshot)
                self.assertNotIn("observed_at", snapshot)
                self.assertNotIn("observed_at_provenance", snapshot)

    def test_usage_snapshot_selects_latest_valid_event_time_instead_of_file_mtime(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            codex_home = Path(tmp)
            older_event = codex_home / "sessions" / "rollout-touched-later.jsonl"
            newer_event = codex_home / "sessions" / "rollout-touched-earlier.jsonl"
            write_rollout(
                older_event,
                [
                    {
                        "timestamp": "2026-07-06T00:00:00+00:00",
                        "type": "event_msg",
                        "payload": {
                            "type": "token_count",
                            "rate_limits": {"primary": {"used_percent": 10, "window_minutes": 300}},
                        },
                    }
                ],
            )
            write_rollout(
                newer_event,
                [
                    {
                        "timestamp": "2026-07-06T01:00:00+00:00",
                        "type": "event_msg",
                        "payload": {
                            "type": "token_count",
                            "rate_limits": {"primary": {"used_percent": 80, "window_minutes": 300}},
                        },
                    }
                ],
            )
            os.utime(newer_event, (1, 1))
            os.utime(older_event, (2, 2))

            snapshot = usage_snapshot(codex_home, generated_at="2026-07-06T02:00:00+00:00")

        self.assertEqual("2026-07-06T01:00:00+00:00", snapshot["client_event_at"])
        self.assertEqual(80.0, snapshot["primary"]["used_percent"])

    def test_usage_snapshot_ignores_malformed_time_when_a_valid_event_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            codex_home = Path(tmp)
            rollout = codex_home / "sessions" / "rollout-events.jsonl"
            write_rollout(
                rollout,
                [
                    {
                        "timestamp": "2026-07-06T01:00:00+00:00",
                        "type": "event_msg",
                        "payload": {
                            "type": "token_count",
                            "rate_limits": {"primary": {"used_percent": 40, "window_minutes": 300}},
                        },
                    },
                    {
                        "timestamp": "malformed",
                        "type": "event_msg",
                        "payload": {
                            "type": "token_count",
                            "rate_limits": {"primary": {"used_percent": 90, "window_minutes": 300}},
                        },
                    },
                ],
            )

            snapshot = usage_snapshot(codex_home)

        self.assertEqual("2026-07-06T01:00:00+00:00", snapshot["client_event_at"])
        self.assertEqual(40.0, snapshot["primary"]["used_percent"])

    def test_usage_snapshot_collapses_duplicate_events_across_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            codex_home = Path(tmp)
            event = {
                "timestamp": "2026-07-06T01:00:00+00:00",
                "type": "event_msg",
                "payload": {
                    "type": "token_count",
                    "rate_limits": {"primary": {"used_percent": 55, "window_minutes": 300}},
                },
            }
            write_rollout(codex_home / "sessions" / "rollout-a.jsonl", [event])
            write_rollout(codex_home / "sessions" / "rollout-b.jsonl", [event])

            snapshot = usage_snapshot(codex_home)

        self.assertEqual(True, snapshot["available"])
        self.assertEqual(2, snapshot["checked_files"])
        self.assertEqual("2026-07-06T01:00:00+00:00", snapshot["client_event_at"])
        self.assertEqual(55.0, snapshot["primary"]["used_percent"])

    def test_format_usage_snapshot_is_compact(self) -> None:
        text = format_usage_snapshot(
            {
                "available": True,
                "primary": {"used_percent": 71.0},
                "secondary": {"used_percent": 11.0},
                "plan_type": "prolite",
            }
        )

        self.assertEqual("Codex usage: 5h used 71%, 7d used 11%, plan prolite", text)

    def test_format_usage_snapshot_identifies_lone_seven_day_primary_window(self) -> None:
        text = format_usage_snapshot(
            {
                "available": True,
                "primary": {"used_percent": 24.0, "window_minutes": 10080},
                "secondary": None,
                "plan_type": "prolite",
            }
        )

        self.assertEqual("Codex usage: 7d used 24%, plan prolite", text)


if __name__ == "__main__":
    unittest.main()
