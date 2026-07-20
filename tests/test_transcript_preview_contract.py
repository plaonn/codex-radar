import json
import unittest
from datetime import datetime
from pathlib import Path

from codex_radar.transcript_preview import (
    LATEST_TRANSCRIPT_PREVIEW_VERSION,
    MAX_PREVIEW_LIMIT,
    TRANSCRIPT_PREVIEW_CONTRACT,
    TRANSCRIPT_PREVIEW_VERSION,
    build_transcript_preview,
    conversation_messages,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = ROOT / "tests" / "fixtures" / "transcript-preview-v1.json"
V2_FIXTURE_PATH = ROOT / "tests" / "fixtures" / "transcript-preview-v2.json"


class TranscriptPreviewContractTests(unittest.TestCase):
    def test_build_preview_matches_golden_contract(self) -> None:
        items = [
            {
                "timestamp": "2026-07-13T23:57:00Z",
                "role": "assistant",
                "content": [{"text": "old"}],
            },
            {
                "timestamp": "2026-07-13T23:58:00Z",
                "type": "event_msg",
                "payload": {"type": "user_message", "message": "show summary"},
            },
            {"role": "tool", "content": [{"text": "/private/tool output"}]},
            {
                "timestamp": "2026-07-14T00:01:00Z",
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "done token=supersecret"}],
                },
            },
        ]

        result = build_transcript_preview(
            "session-1",
            items,
            limit=2,
            generated_at="2026-07-14T00:00:00+00:00",
        )

        self.assertEqual(json.loads(FIXTURE_PATH.read_text(encoding="utf-8")), result)
        self.assertEqual(TRANSCRIPT_PREVIEW_CONTRACT, result["contract"])
        self.assertEqual(TRANSCRIPT_PREVIEW_VERSION, result["version"])

    def test_build_v2_preview_matches_timestamped_golden_contract(self) -> None:
        items = [
            {
                "timestamp": "2026-07-14T08:58:00+09:00",
                "type": "event_msg",
                "payload": {"type": "user_message", "message": "show summary"},
            },
            {
                "timestamp": "2026-07-14T09:01:00+09:00",
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "done token=supersecret"}],
                },
            },
        ]

        result = build_transcript_preview(
            "session-1",
            items,
            limit=2,
            contract_version=2,
            generated_at="2026-07-14T00:00:00+00:00",
        )

        self.assertEqual(json.loads(V2_FIXTURE_PATH.read_text(encoding="utf-8")), result)
        self.assertEqual(LATEST_TRANSCRIPT_PREVIEW_VERSION, result["version"])

    def test_preview_accepts_only_user_and_assistant_and_deduplicates_adjacent_messages(self) -> None:
        marker = "/private/tool-output"
        items = [
            {"role": "user", "content": [{"text": "same prompt"}]},
            {"type": "user_message", "message": "same prompt"},
            {"role": "tool", "content": [{"text": marker}]},
            {"type": "event", "message": marker},
            {"author": {"role": "assistant"}, "content": [{"text": "answer"}]},
        ]

        messages = conversation_messages(items)

        self.assertEqual(
            [{"role": "user", "text": "same prompt"}, {"role": "assistant", "text": "answer"}],
            messages,
        )
        self.assertNotIn(marker, json.dumps(messages))

    def test_duplicate_messages_keep_earliest_valid_top_level_timestamp(self) -> None:
        messages = conversation_messages(
            [
                {
                    "timestamp": "not-a-date",
                    "type": "user_message",
                    "message": "same prompt",
                },
                {
                    "timestamp": "2026-07-14T09:02:00+09:00",
                    "payload": {
                        "type": "user_message",
                        "message": "same prompt",
                        "timestamp": "2020-01-01T00:00:00Z",
                    },
                },
                {
                    "timestamp": "2026-07-14T08:59:00+09:00",
                    "role": "user",
                    "content": "same prompt",
                },
            ]
        )

        self.assertEqual(
            [
                {
                    "role": "user",
                    "text": "same prompt",
                    "timestamp": "2026-07-13T23:59:00+00:00",
                }
            ],
            messages,
        )

    def test_preview_omits_missing_malformed_naive_and_nested_only_timestamps(self) -> None:
        messages = conversation_messages(
            [
                {"role": "user", "content": "missing"},
                {
                    "timestamp": "invalid",
                    "role": "assistant",
                    "content": "malformed",
                },
                {
                    "timestamp": "2026-07-14T09:00:00",
                    "role": "user",
                    "content": "naive",
                },
                {
                    "role": "assistant",
                    "content": "nested",
                    "payload": {"timestamp": "2026-07-14T00:00:00Z"},
                },
            ]
        )

        self.assertEqual(
            [
                {"role": "user", "text": "missing"},
                {"role": "assistant", "text": "malformed"},
                {"role": "user", "text": "naive"},
                {"role": "assistant", "text": "nested"},
            ],
            messages,
        )

    def test_preview_limit_is_explicit_and_strictly_bounded(self) -> None:
        with self.assertRaises(TypeError):
            build_transcript_preview("session-1", [])  # type: ignore[call-arg]
        for invalid in (0, -1, MAX_PREVIEW_LIMIT + 1, True):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                build_transcript_preview("session-1", [], limit=invalid)
        with self.assertRaises(ValueError):
            build_transcript_preview("session-1", [], limit=1, contract_version=3)

    def test_preview_accepts_markdown_parts_and_role_gates_summary(self) -> None:
        messages = conversation_messages(
            [
                {"summary": "unscoped summary must stay hidden"},
                {"role": "assistant", "summary": "role-scoped summary"},
                {
                    "role": "assistant",
                    "content": [{"type": "markdown", "text": "## Markdown answer"}],
                },
            ]
        )

        self.assertEqual(
            [
                {"role": "assistant", "text": "role-scoped summary"},
                {"role": "assistant", "text": "## Markdown answer"},
            ],
            messages,
        )

    def test_preview_fails_closed_on_unsafe_identity_and_generated_timestamp(self) -> None:
        with self.assertRaises(ValueError):
            build_transcript_preview("/private/session", [], limit=1)

        result = build_transcript_preview(
            "safe-1",
            [],
            limit=1,
            generated_at="<b>not-a-date</b>",
        )

        self.assertIsNotNone(datetime.fromisoformat(result["generated_at"]).tzinfo)
        self.assertNotIn("not-a-date", json.dumps(result))

    def test_preview_does_not_expose_paths_html_or_raw_payload_fields(self) -> None:
        marker = "/private/raw-transcript.jsonl"
        result = build_transcript_preview(
            "session-1",
            [
                {"role": "tool", "content": [{"text": marker}]},
                {"type": "metadata", "payload": {"path": marker, "html": f"<p>{marker}</p>"}},
                {"role": "assistant", "content": [{"text": "safe answer"}]},
            ],
            limit=10,
            generated_at="2026-07-14T00:00:00+00:00",
        )

        encoded = json.dumps(result)
        self.assertNotIn(marker, encoded)
        self.assertNotIn("html", encoded)
        self.assertNotIn("payload", encoded)
        self.assertEqual([{"role": "assistant", "text": "safe answer"}], result["messages"])


if __name__ == "__main__":
    unittest.main()
