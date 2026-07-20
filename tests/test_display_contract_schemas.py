import json
import re
import unittest
from datetime import datetime
from pathlib import Path

from codex_radar.display_state import DISPLAY_STATE_CONTRACT, DISPLAY_STATE_VERSION
from codex_radar.transcript_preview import (
    LATEST_TRANSCRIPT_PREVIEW_VERSION,
    MAX_PREVIEW_LIMIT,
    TRANSCRIPT_PREVIEW_CONTRACT,
    TRANSCRIPT_PREVIEW_VERSION,
)


ROOT = Path(__file__).resolve().parents[1]


class DisplayContractSchemaTests(unittest.TestCase):
    def assert_datetime(self, value: str) -> None:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        self.assertIsNotNone(parsed.tzinfo)

    def assert_identity(self, value: str, property_schema: dict) -> None:
        self.assertGreaterEqual(len(value), property_schema["minLength"])
        self.assertLessEqual(len(value), property_schema["maxLength"])
        self.assertIsNotNone(re.fullmatch(property_schema["pattern"], value))

    def test_display_state_schema_and_fixture_match_versioned_contract(self) -> None:
        schema = json.loads(
            (ROOT / "docs" / "schemas" / "display-state-v1.schema.json").read_text(encoding="utf-8")
        )
        fixture = json.loads(
            (ROOT / "tests" / "fixtures" / "display-state-v1.json").read_text(encoding="utf-8")
        )

        self.assertEqual(DISPLAY_STATE_CONTRACT, schema["properties"]["contract"]["const"])
        self.assertEqual(DISPLAY_STATE_VERSION, schema["properties"]["version"]["const"])
        self.assertEqual(DISPLAY_STATE_CONTRACT, fixture["contract"])
        self.assertEqual(DISPLAY_STATE_VERSION, fixture["version"])
        self.assertFalse(schema["additionalProperties"])
        self.assertFalse(schema["$defs"]["session"]["additionalProperties"])
        self.assert_datetime(fixture["generated_at"])
        session_id_schema = schema["$defs"]["session"]["properties"]["session_id"]
        for session in fixture["sessions"]:
            self.assert_identity(session["session_id"], session_id_schema)
            for field in ("first_seen_at", "last_seen_at", "display_state_started_at"):
                if field in session:
                    self.assert_datetime(session[field])
        self.assertEqual(
            fixture["counts"]["total"],
            fixture["counts"]["active"]
            + fixture["counts"]["archived"]
            + fixture["counts"]["archive_unknown"],
        )

    def test_preview_schema_and_fixture_match_versioned_contract(self) -> None:
        for version in (TRANSCRIPT_PREVIEW_VERSION, LATEST_TRANSCRIPT_PREVIEW_VERSION):
            with self.subTest(version=version):
                schema = json.loads(
                    (ROOT / "docs" / "schemas" / f"transcript-preview-v{version}.schema.json").read_text(encoding="utf-8")
                )
                fixture = json.loads(
                    (ROOT / "tests" / "fixtures" / f"transcript-preview-v{version}.json").read_text(encoding="utf-8")
                )

                self.assertEqual(TRANSCRIPT_PREVIEW_CONTRACT, schema["properties"]["contract"]["const"])
                self.assertEqual(version, schema["properties"]["version"]["const"])
                self.assertEqual(MAX_PREVIEW_LIMIT, schema["properties"]["limit"]["maximum"])
                self.assertEqual(TRANSCRIPT_PREVIEW_CONTRACT, fixture["contract"])
                self.assertEqual(version, fixture["version"])
                self.assertFalse(schema["additionalProperties"])
                self.assertFalse(schema["$defs"]["message"]["additionalProperties"])
                self.assert_datetime(fixture["generated_at"])
                self.assert_identity(fixture["session_id"], schema["properties"]["session_id"])
                for message in fixture["messages"]:
                    if "recorded_at" in message:
                        self.assert_datetime(message["recorded_at"])

    def test_schema_constraints_reject_empty_identity_and_malformed_timestamp(self) -> None:
        display_schema = json.loads(
            (ROOT / "docs" / "schemas" / "display-state-v1.schema.json").read_text(encoding="utf-8")
        )
        identity_schema = display_schema["$defs"]["session"]["properties"]["session_id"]

        with self.assertRaises(AssertionError):
            self.assert_identity("", identity_schema)
        with self.assertRaises((AssertionError, ValueError)):
            self.assert_datetime("not-a-date")


if __name__ == "__main__":
    unittest.main()
