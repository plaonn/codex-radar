import re
import unittest
from pathlib import Path

from codex_radar import __version__


ROOT = Path(__file__).resolve().parents[1]
PYPROJECT = ROOT / "pyproject.toml"


class VersionMetadataTests(unittest.TestCase):
    def test_imported_version_matches_project_package_metadata(self) -> None:
        metadata = PYPROJECT.read_text(encoding="utf-8")
        match = re.search(
            r"^\[project\]\n(?:.*\n)*?^version = \"([^\"]+)\"$",
            metadata,
            re.MULTILINE,
        )

        self.assertIsNotNone(match, "pyproject project.version must be declared")
        self.assertEqual(match.group(1), __version__)


if __name__ == "__main__":
    unittest.main()
