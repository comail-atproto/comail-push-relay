"""CI telemetry is optional, scoped, and never an acceptance authority."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = 'push-relay'


class ReleaseObservationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.identity = "a" * 40 + "-" + "b" * 16
        self.receipt = {"app": APP, "environment": "production", "role": "edge" if APP == "relay" else APP,
            "operation": "install", "release_identity": self.identity, "source_sha": "a" * 40,
            "archive_sha256": "b" * 64, "workflow_run_id": "12345", "workflow_run_number": 42,
            "workflow_run_attempt": 1, "activation_sequence": 42, "serving_verified": True}
        self.status = {"app": APP, "environment": "production", "role": self.receipt["role"],
            "active": self.identity, "archive_sha256": "b" * 64, "observation_version": 1,
            "state": {"release": self.identity, "phase": "complete", "sequence": 42}}
        self.ssh = self.root / "ssh"
        self.ssh.write_text('#!/usr/bin/env bash\nset -euo pipefail\ncase "${!#}" in\n status) if [[ "${OBS_STATUS_FAIL:-}" == 1 ]]; then echo synthetic-private-network-detail >&2; exit 23; fi; if [[ "${OBS_HANG:-}" == 1 ]]; then exec sleep 30; fi; cat "$OBS_STATUS" ;;\n report) cat > "$OBS_REPORT"; exit "${OBS_EXIT:-0}" ;;\n rollback*) if [[ "${FAKE_BAD_STATUS:-}" == 1 ]]; then printf "synthetic-private-network-detail"; exit 0; fi; printf "%s\\n" "${FAKE_SSH_ERROR:-}" >&2; exit 91 ;;\n *) printf "%s\\n" "${FAKE_SSH_ERROR:-}" >&2; exit 91 ;;\nesac\n')
        self.ssh.chmod(0o700)
        timeout = self.root / "timeout"
        timeout.write_text('#!/bin/sh\nif [ "$1" = 120s ] && [ "${FAKE_SSH_TIMEOUT:-}" = 1 ]; then exit 124; fi\nshift; exec "$@"\n')
        timeout.chmod(0o700)

    def run_observation(self, mode="observe", expected=0, **extra):
        (self.root / "comail-release-receipt.json").write_text(json.dumps(self.receipt))
        (self.root / "status.json").write_text(json.dumps(self.status))
        env = dict(os.environ, PATH=str(self.root) + os.pathsep + os.environ["PATH"], RUNNER_TEMP=str(self.root),
            GITHUB_RUN_ID="12345", GITHUB_RUN_NUMBER="42", GITHUB_RUN_ATTEMPT="1", GITHUB_EVENT_NAME="workflow_dispatch",
            DEPLOY_ENVIRONMENT="production", DEPLOY_TARGET="production", DEPLOY_ROLE=self.receipt["role"],
            DEPLOY_KEY="synthetic-private-deploy-key", KNOWN_HOSTS="synthetic-known-host", DEPLOY_HOST="fixture.invalid",
            DEPLOY_ORIGIN="https://fixture.invalid", OBS_STATUS=str(self.root / "status.json"),
            OBS_REPORT=str(self.root / "reported.json"), RELEASE_OBSERVATION_STAGE="monitoring",
            RELEASE_OBSERVATION_RESULT="running", RELEASE_OBSERVATION_SECONDS="600", **extra)
        args = ["bash", "scripts/deploy-release.sh", mode]
        if APP in ("builders", "public"): args += [APP, "/", APP]
        result = subprocess.run(args, cwd=ROOT, env=env, text=True, capture_output=True)
        self.assertEqual(result.returncode, expected, result.stderr)
        self.assertNotIn("synthetic-private-deploy-key", result.stdout + result.stderr)
        return result

    def test_report_uses_the_selected_receipt_and_reported_window(self):
        self.receipt["private_message"] = "private@example.test"
        self.run_observation()
        report = json.loads((self.root / "reported.json").read_text())
        self.assertEqual((report["stage"], report["result"], report["observation_seconds"]), ("monitoring", "running", 600))
        self.assertEqual(report["receipt"]["release_identity"], self.identity)
        self.assertNotIn("private@example.test", json.dumps(report))

    def test_old_hosts_need_no_reporting_capability(self):
        self.status.pop("observation_version")
        self.run_observation()
        self.assertFalse((self.root / "reported.json").exists())

    def test_reporting_failure_does_not_fail_a_release(self):
        result = self.run_observation(OBS_EXIT="1")
        self.assertIn("Deployment status reporting unavailable", result.stderr)

    def test_stale_receipt_never_attaches_proof_to_a_newer_activation(self):
        self.status["state"]["sequence"] = 43
        self.run_observation()
        self.assertFalse((self.root / "reported.json").exists())

    def test_a_stuck_reporting_command_has_a_wall_clock_timeout(self):
        started = time.monotonic()
        self.run_observation(OBS_HANG="1")
        self.assertLess(time.monotonic() - started, 15)

    def test_native_deployment_failure_keeps_its_exit_code(self):
        self.run_observation(mode="rollback", expected=91, RELEASE_IDENTITY=self.identity)

    def test_verify_reads_status_without_printing_or_reporting_it(self):
        self.status["private_detail"] = "synthetic-private-network-detail"
        result = self.run_observation(mode="verify")
        self.assertNotIn("synthetic-private-network-detail", result.stdout + result.stderr)
        self.assertFalse((self.root / "reported.json").exists())

    def test_verify_failure_does_not_print_private_diagnostics(self):
        result = self.run_observation(mode="verify", expected=23, OBS_STATUS_FAIL="1")
        self.assertNotIn("synthetic-private-network-detail", result.stdout + result.stderr)
        self.assertFalse((self.root / "reported.json").exists())

    def test_failed_ssh_does_not_expose_private_diagnostics(self):
        marker = "synthetic-private-hostname.invalid"
        result = self.run_observation(mode="rollback", expected=91, RELEASE_IDENTITY=self.identity, FAKE_SSH_ERROR=marker)
        self.assertNotIn(marker, result.stdout + result.stderr)

    def test_invalid_remote_response_is_not_printed(self):
        result = self.run_observation(mode="rollback", expected=1, RELEASE_IDENTITY=self.identity, FAKE_BAD_STATUS="1")
        self.assertNotIn("synthetic-private-network-detail", result.stdout + result.stderr)

    def test_stalled_ssh_fails_with_bounded_timeout(self):
        self.run_observation(mode="rollback", expected=124, RELEASE_IDENTITY=self.identity, FAKE_SSH_TIMEOUT="1")

    def test_native_failure_cannot_send_a_leftover_receipt(self):
        self.run_observation(mode="rollback", expected=91, RELEASE_IDENTITY=self.identity, OBS_EXIT="1")
        self.assertFalse((self.root / "reported.json").exists())


if __name__ == "__main__":
    unittest.main()
