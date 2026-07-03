import json
import tempfile
import unittest
from pathlib import Path

from codex_radar.transcript import format_skim, skim_transcript


class TranscriptTests(unittest.TestCase):
    def test_skim_transcript_extracts_and_redacts_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "transcript.jsonl"
            path.write_text(
                "\n".join(
                    [
                        json.dumps({"role": "user", "content": [{"text": "hello"}]}),
                        json.dumps({"role": "assistant", "content": [{"text": "token=supersecret"}]}),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            entries = skim_transcript(path)
            output = format_skim(entries)

            self.assertIn("hello", output)
            self.assertIn("[REDACTED]", output)
            self.assertNotIn("supersecret", output)


if __name__ == "__main__":
    unittest.main()
