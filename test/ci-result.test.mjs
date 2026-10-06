import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const gate = workflow.match(/^  ci:\n([\s\S]*?)(?=^  [\w-]+:|(?![\s\S]))/m)?.[1];

test('the required ci check reports the owner build result on source events', () => {
  assert.ok(gate, 'release workflow must produce the required ci check');
  assert.match(gate, /^    name: ci$/m);
  assert.match(gate, /^    needs: build$/m);
  assert.match(gate, /^    if: always\(\) && github\.event_name != 'workflow_dispatch'$/m);
  assert.match(gate, /BUILD_RESULT: \$\{\{ needs\.build\.result \}\}/);
  assert.doesNotMatch(gate, /secrets\.|uses:|: write/);

  const command = gate.match(/^        run: (.+)$/m)?.[1];
  assert.ok(command, 'the result check must execute a command');
  for (const result of ['success', 'failure', 'cancelled', 'skipped', '', 'unknown']) {
    const run = spawnSync('bash', ['-euo', 'pipefail', '-c', command], {
      env: { ...process.env, BUILD_RESULT: result },
      encoding: 'utf8',
    });
    assert.equal(run.status === 0, result === 'success', `build result: ${result || 'missing'}`);
  }
});
