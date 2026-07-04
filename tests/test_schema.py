import json
import unittest
from pathlib import Path

from codex_radar.store import CACHE_SCHEMA_VERSION, SESSION_CACHE_FIELDS, load_sessions


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "schemas" / "session-cache-v1.schema.json"
EXAMPLE_PATH = ROOT / "examples" / "sessions.json"


class SchemaTests(unittest.TestCase):
    def test_session_cache_schema_matches_store_contract(self) -> None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        session_schema = schema["$defs"]["session"]

        self.assertEqual(CACHE_SCHEMA_VERSION, schema["properties"]["schema_version"]["const"])
        self.assertEqual(set(SESSION_CACHE_FIELDS), set(session_schema["required"]))
        self.assertEqual(set(SESSION_CACHE_FIELDS), set(session_schema["properties"]))
        self.assertFalse(schema["additionalProperties"])
        self.assertFalse(session_schema["additionalProperties"])

    def test_session_cache_example_matches_schema_contract(self) -> None:
        payload = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))

        self.assertEqual(CACHE_SCHEMA_VERSION, payload["schema_version"])
        self.assertEqual({"schema_version", "updated_at", "sessions"}, set(payload))
        self.assertGreaterEqual(len(payload["sessions"]), 1)
        for session_id, session in payload["sessions"].items():
            self.assertEqual(session_id, session["session_id"])
            self.assertEqual(set(SESSION_CACHE_FIELDS), set(session))

    def test_session_cache_example_is_loadable(self) -> None:
        sessions = load_sessions(EXAMPLE_PATH.parent)

        self.assertEqual(["session-approval", "session-running"], sorted(sessions))


if __name__ == "__main__":
    unittest.main()
