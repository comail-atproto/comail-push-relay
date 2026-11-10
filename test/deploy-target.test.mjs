import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('deployment binds the archive and receipt to the selected environment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-deploy-'));
  try {
    mkdirSync(join(dir, 'bin'));
    symlinkSync(join(root, 'scripts'), join(dir, 'scripts'));
    writeFileSync(join(dir, 'bin', 'timeout'), '#!/bin/bash\nshift\nexec "$@"\n', { mode: 0o755 });
    const sha = 'a'.repeat(40);
    writeFileSync(join(dir, 'release.json'), JSON.stringify({ source_sha: sha }));
    execFileSync('tar', ['-czf', 'release.tar.gz', 'release.json'], { cwd: dir });
    const checksum = execFileSync('sha256sum', ['release.tar.gz'], { cwd: dir, encoding: 'utf8' });
    writeFileSync(join(dir, 'release.sha256'), checksum);
    const digest = checksum.split(' ')[0];
    const identity = `${sha}-${digest.slice(0, 16)}`;
    const ssh = `#!/bin/bash\ncommand="\${!#}"\nprintf '%s\\n' "$command" >> "$SSH_LOG"\ncase "$command" in\n  seed*) echo '{"previous":""}' ;;\n  status) printf '%s\\n' "$SSH_STATUS" ;;\nesac\n`;
    writeFileSync(join(dir, 'bin', 'ssh'), ssh, { mode: 0o755 });
    const base = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, RUNNER_TEMP: dir,
      DEPLOY_KEY: 'test', KNOWN_HOSTS: 'test', DEPLOY_HOST: 'test', DEPLOY_ORIGIN: 'https://example.test',
      GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_NUMBER: '5', GITHUB_EVENT_NAME: 'push', GITHUB_SHA: sha,
      SSH_LOG: join(dir, 'ssh.log'), SSH_STATUS: JSON.stringify({ app: 'push-relay', environment: 'staging', active: identity, archive_sha256: digest, state: { phase: 'complete' } }) };
    const run = (env, mode = 'seed') => spawnSync('bash', [join(root, 'scripts/deploy-release.sh'), mode], { cwd: dir, env, encoding: 'utf8' });
    let result = run({ ...base, DEPLOY_TARGET: 'staging' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(join(dir, 'ssh.log'), 'utf8'), /install [a-f0-9]{40} [a-f0-9]{64} staging/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'comail-release-receipt.json'))).environment, 'staging');
    result = run({ ...base, DEPLOY_TARGET: 'invalid' });
    assert.notEqual(result.status, 0);
    result = run({ ...base, SSH_STATUS: JSON.stringify({ app: 'push-relay', environment: 'production', active: identity, archive_sha256: digest, state: { phase: 'complete' } }) });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(join(dir, 'comail-release-receipt.json'))).environment, 'production');
    result = run({ ...base, DEPLOY_TARGET: 'staging', SSH_STATUS: JSON.stringify({ app: 'push-relay', environment: 'production', active: identity, archive_sha256: digest, state: { phase: 'complete' } }) });
    assert.notEqual(result.status, 0);
    writeFileSync(base.SSH_LOG, '');
    result = run({ ...base, DEPLOY_TARGET: 'staging', RELEASE_IDENTITY: identity,
      SSH_STATUS: JSON.stringify({ app: 'push-relay', environment: 'production' }) }, 'rollback');
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(base.SSH_LOG, 'utf8'), 'status\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
