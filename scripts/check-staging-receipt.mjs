import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const receipt = JSON.parse(readFileSync(join(process.env.RUNNER_TEMP, 'comail-release-receipt.json'), 'utf8'));
const digest = readFileSync('release.sha256', 'utf8').split(/\s+/)[0];
const sha = process.env.GITHUB_SHA;
if (!/^[0-9a-f]{64}$/.test(digest) || !/^[0-9a-f]{40}$/.test(sha) ||
    receipt.app !== 'push-relay' || receipt.environment !== 'staging' ||
    receipt.operation !== 'install' || receipt.source_sha !== sha ||
    receipt.archive_sha256 !== digest || receipt.release_identity !== `${sha}-${digest.slice(0, 16)}` ||
    receipt.workflow_run_id !== process.env.GITHUB_RUN_ID ||
    receipt.workflow_run_attempt !== Number(process.env.GITHUB_RUN_ATTEMPT) ||
    receipt.serving_verified !== true) {
  throw new Error('Staging receipt does not match this release');
}
