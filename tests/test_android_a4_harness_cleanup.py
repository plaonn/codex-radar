import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "apps" / "android" / "tools"
sys.path.insert(0, str(TOOLS))


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


A4 = load_module("test_run_a4_smoke_module", TOOLS / "run_a4_smoke.py")
A31 = sys.modules["run_a31_smoke"]


class A4HarnessCleanupTest(unittest.TestCase):
    def test_emulator_start_failure_releases_owned_process(self):
        fake_process = mock.Mock()
        fake_process.poll.return_value = None

        def adb_result(*args, **kwargs):
            return subprocess.CompletedProcess(
                args[0],
                0,
                stdout="List of devices attached\n",
                stderr="",
            )

        def close_owned_process(process, serial, log):
            self.assertIs(process, fake_process)
            self.assertEqual("", serial)
            log.close()

        with tempfile.TemporaryDirectory() as raw:
            with (
                mock.patch.object(A4.shutil, "which", return_value="/emulator"),
                mock.patch.object(A4.subprocess, "run", side_effect=adb_result),
                mock.patch.object(A4.subprocess, "Popen", return_value=fake_process),
                mock.patch.object(A4.time, "monotonic", side_effect=[0, 31]),
                mock.patch.object(
                    A4, "stop_emulator", side_effect=close_owned_process
                ) as stop,
            ):
                with self.assertRaisesRegex(
                    RuntimeError, "emulator_serial_unavailable"
                ):
                    A4.start_emulator(Path(raw))
        stop.assert_called_once()

    def test_sshd_start_failure_releases_owned_process_and_log(self):
        fake_process = mock.Mock(pid=12345)
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            config = root / "sshd.conf"
            log = root / "sshd.log"
            config.write_text("Port 54321\n", encoding="utf-8")
            with (
                mock.patch.object(A31, "run"),
                mock.patch.object(A31.subprocess, "Popen", return_value=fake_process),
                mock.patch.object(A31.time, "monotonic", side_effect=[0, 6]),
                mock.patch.object(A31, "stop_server") as stop,
            ):
                with self.assertRaisesRegex(
                    RuntimeError, "disposable_sshd_not_listening"
                ):
                    A31.start_sshd(config, log)
            stop.assert_called_once_with(fake_process)
            self.assertTrue(log.exists())
            self.assertEqual("", log.read_text(encoding="utf-8"))

    def test_instrumentation_timeout_terminates_process(self):
        process = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(60)"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        with mock.patch.object(A4.subprocess, "Popen", return_value=process):
            with self.assertRaisesRegex(
                RuntimeError, "a4_foreground_instrumentation_timeout"
            ):
                A4.instrument_with_transitions(
                    "emulator-test",
                    [],
                    Path("/unused"),
                    {},
                    timeout_seconds=0.1,
                )
        self.assertIsNotNone(process.poll())

    def test_artifact_privacy_failure_still_removes_artifacts(self):
        with tempfile.TemporaryDirectory() as raw:
            android = Path(raw)
            output = (
                android
                / "app"
                / "build"
                / "outputs"
                / "androidTest-results"
                / "result.txt"
            )
            output.parent.mkdir(parents=True)
            output.write_text("a4_public_key_openssh=disposable", encoding="utf-8")
            with mock.patch.object(A4, "ANDROID", android):
                with self.assertRaisesRegex(
                    RuntimeError, "a4_android_test_artifact_privacy_failed"
                ):
                    A4.scan_and_remove_android_test_artifacts()
            self.assertFalse(
                (android / "app" / "build" / "outputs" / "androidTest-results").exists()
            )


if __name__ == "__main__":
    unittest.main()
