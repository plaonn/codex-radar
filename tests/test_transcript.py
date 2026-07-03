import json
import tempfile
import unittest
from pathlib import Path

from codex_radar.transcript import format_skim, skim_transcript


class TranscriptTests(unittest.TestCase):
    def write_transcript(self, path: Path, lines: list[str]) -> None:
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def test_skim_transcript_extracts_and_redacts_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "transcript.jsonl"
            self.write_transcript(
                path,
                [
                    json.dumps({"role": "user", "content": [{"text": "hello"}]}),
                    json.dumps({"role": "assistant", "content": [{"text": "token=supersecret"}]}),
                ],
            )

            entries = skim_transcript(path)
            output = format_skim(entries)

            self.assertIn("hello", output)
            self.assertIn("[REDACTED]", output)
            self.assertNotIn("supersecret", output)

    def test_skim_transcript_skips_invalid_jsonl_and_non_dict_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "transcript.jsonl"
            self.write_transcript(
                path,
                [
                    json.dumps({"role": "user", "content": [{"text": "before"}]}),
                    "{invalid json",
                    json.dumps(["list entries should not be previewed"]),
                    json.dumps("string entries should not be previewed"),
                    json.dumps({"role": "assistant", "content": [{"text": "after"}]}),
                ],
            )

            entries = skim_transcript(path)

            self.assertEqual([("user", "before"), ("assistant", "after")], entries)

    def test_skim_transcript_redacts_home_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "transcript.jsonl"
            home_path = Path.home() / "private" / "transcript.jsonl"
            self.write_transcript(
                path,
                [
                    json.dumps({"role": "assistant", "content": [{"text": f"open {home_path}"}]}),
                ],
            )

            output = format_skim(skim_transcript(path))

            self.assertIn("~/private/transcript.jsonl", output)
            self.assertNotIn(str(Path.home()), output)

    def test_skim_transcript_limit_returns_latest_previewable_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "transcript.jsonl"
            self.write_transcript(
                path,
                [
                    json.dumps({"role": "user", "content": [{"text": "first"}]}),
                    json.dumps({"role": "assistant", "content": [{"text": "second"}]}),
                    json.dumps({"role": "user", "content": [{"text": "third"}]}),
                ],
            )

            entries = skim_transcript(path, limit=2)

            self.assertEqual([("assistant", "second"), ("user", "third")], entries)

    def test_skim_transcript_zero_limit_returns_all_previewable_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "transcript.jsonl"
            self.write_transcript(
                path,
                [
                    json.dumps({"role": "user", "content": [{"text": "first"}]}),
                    json.dumps({"role": "assistant", "content": [{"text": "second"}]}),
                ],
            )

            entries = skim_transcript(path, limit=0)

            self.assertEqual([("user", "first"), ("assistant", "second")], entries)

    def test_skim_transcript_returns_no_entries_without_previewable_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "transcript.jsonl"
            self.write_transcript(
                path,
                [
                    "",
                    "{invalid json",
                    json.dumps({"role": "assistant", "content": [{"type": "image"}]}),
                    json.dumps({"role": "user", "content": [{"text": "   "}]}),
                    json.dumps({"role": "entry", "metadata": {"path": str(Path.home())}}),
                ],
            )

            entries = skim_transcript(path)

            self.assertEqual([], entries)
            self.assertEqual("", format_skim(entries))


if __name__ == "__main__":
    unittest.main()
