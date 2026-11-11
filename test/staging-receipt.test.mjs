import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('../scripts/check-staging-receipt.mjs', import.meta.url).pathname;

test('staging receipt must prove the current source, run and archive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-receipt-'));
  try {
    const sha = 'a'.repeat(40);
    const digest = 'b'.repeat(64);
    const receipt = { app: 'push-relay', environment: 'staging', operation: 'install',
      source_sha: sha, archive_sha256: digest, release_identity: `${sha}-${digest.slice(0, 16)}`,
      workflow_run_id: '12', workflow_run_attempt: 1, serving_verified: true };
    writeFileSync(join(dir, 'release.sha256'), `${digest}  release.tar.gz\n`);
    for (const [change, success] of [[{}, true], [{ environment: 'production' }, false],
      [{ archive_sha256: 'c'.repeat(64) }, false], [{ workflow_run_id: '13' }, false],
      [{ serving_verified: false }, false], [{ source_sha: 'd'.repeat(40) }, false]]) {
      writeFileSync(join(dir, 'comail-release-receipt.json'), JSON.stringify({ ...receipt, ...change }));
      const result = spawnSync('node', [script], { cwd: dir, env: { ...process.env, RUNNER_TEMP: dir,
        GITHUB_SHA: sha, GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '1' }, encoding: 'utf8' });
      assert.equal(result.status === 0, success, JSON.stringify(change));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
