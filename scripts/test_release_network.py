"""Deployment connection failures must not expose private diagnostics."""
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReleaseNetworkTests(unittest.TestCase):
    def test_connection_and_cleanup_hide_command_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            commands = {
                "curl": '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done; : > "$2"\n',
                "sha256sum": '#!/bin/sh\nexit 0\n',
                "tar": '#!/bin/sh\ncp "$RUNNER_TEMP/fake-tailscale" "$RUNNER_TEMP/release-network/tailscale"\ncp "$RUNNER_TEMP/fake-tailscaled" "$RUNNER_TEMP/release-network/tailscaled"\n',
                "timeout": '#!/bin/sh\nif [ "$1" = 120s ] && [ "${FAIL_TIMEOUT:-}" = 1 ]; then echo synthetic-private-network-detail >&2; exit 124; fi\nshift; exec "$@"\n',
                "sudo": '#!/bin/sh\ncase "$1" in systemd-run) shift 3;; systemctl) exit 0;; esac\nexec "$@"\n',
                "fake-tailscaled": '#!/usr/bin/env python3\nimport socket,sys\np = next(x.split("=", 1)[1] for x in sys.argv if x.startswith("--socket="))\ns = socket.socket(socket.AF_UNIX); s.bind(p); s.close()\n',
                "fake-tailscale": '#!/bin/sh\necho "$2" >> "$RUNNER_TEMP/commands"\necho synthetic-private-network-detail\necho synthetic-private-network-detail >&2\nif [ "$2" = up ] && [ "${FAIL_UP:-}" = 1 ]; then exit 7; fi\n',
            }
            for name, body in commands.items():
                path = root / name
                path.write_text(body)
                path.chmod(0o700)
            env = dict(os.environ, PATH=directory + os.pathsep + os.environ["PATH"], RUNNER_TEMP=directory,
                       TAILSCALE_SECRET="synthetic-key", TAILSCALE_TAG="tag:synthetic")
            connect = subprocess.run(["bash", "scripts/release-network.sh", "connect"], cwd=ROOT,
                                     env=env, text=True, capture_output=True, timeout=10)
            self.assertEqual(connect.returncode, 0, connect.stderr)
            disconnect = subprocess.run(["bash", "scripts/release-network.sh", "disconnect"], cwd=ROOT,
                                        env=env, text=True, capture_output=True, timeout=10)
            self.assertEqual(disconnect.returncode, 0, disconnect.stderr)
            self.assertNotIn("synthetic-private-network-detail", connect.stdout + connect.stderr + disconnect.stdout + disconnect.stderr)
            self.assertEqual((root / "commands").read_text().splitlines(), ["up", "logout"])
            shutil.rmtree(root / "release-network")
            failed = subprocess.run(["bash", "scripts/release-network.sh", "connect"], cwd=ROOT,
                                    env={**env, "FAIL_UP": "1"}, text=True, capture_output=True, timeout=10)
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn("Network setup failed", failed.stderr)
            self.assertNotIn("synthetic-private-network-detail", failed.stdout + failed.stderr)
            self.assertEqual((root / "commands").read_text().splitlines(), ["up", "logout", "up", "logout"])
            shutil.rmtree(root / "release-network")
            timed_out = subprocess.run(["bash", "scripts/release-network.sh", "connect"], cwd=ROOT,
                                       env={**env, "FAIL_TIMEOUT": "1"}, text=True, capture_output=True, timeout=10)
            self.assertNotEqual(timed_out.returncode, 0)
            self.assertNotIn("synthetic-private-network-detail", timed_out.stdout + timed_out.stderr)
            self.assertEqual((root / "commands").read_text().splitlines(), ["up", "logout", "up", "logout", "logout"])

    def test_download_failure_has_a_bounded_private_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            curl = root / "curl"
            curl.write_text('#!/bin/sh\nprintf "synthetic-private-network-detail\\n" >&2\nexit 1\n')
            curl.chmod(0o700)
            env = dict(os.environ, PATH=directory + os.pathsep + os.environ["PATH"], RUNNER_TEMP=directory,
                       TAILSCALE_SECRET="synthetic-key", TAILSCALE_TAG="tag:synthetic")
            result = subprocess.run(["bash", "scripts/release-network.sh", "connect"], cwd=ROOT,
                                    env=env, text=True, capture_output=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("synthetic-private-network-detail", result.stdout + result.stderr)
            self.assertIn("Network setup failed", result.stderr)


if __name__ == "__main__":
    unittest.main()
