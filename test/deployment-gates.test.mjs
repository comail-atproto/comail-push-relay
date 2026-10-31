import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const targets = { deploy: 'PRODUCTION' };

function eligible(job, target, org = 'true', packageFlag = 'true', event = 'push', result = 'success') {
  const block = workflow.match(new RegExp(`^  ${job}:\\n((?:    .*\\n|\\n)*)`, 'm'))[1];
  const expression = block.match(/^    if: (?:>-\n((?:      .+\n)+)|(.+)$)/m);
  const condition = (expression[1] || expression[2]).trim();
  const vars = Object.fromEntries([...workflow.matchAll(/vars\.(\w+)/g)].map((match) => [match[1], 'true']));
  for (const environment of ['STAGING', 'PRODUCTION']) {
    vars[`COMAIL_ORG_DEPLOY_${environment}_ENABLED`] = 'false';
    vars[`COMAIL_DEPLOY_${environment}_ENABLED`] = 'false';
  }
  // Actions compares strings without case sensitivity.
  vars[`COMAIL_ORG_DEPLOY_${target}_ENABLED`] = org.toLowerCase();
  vars[`COMAIL_DEPLOY_${target}_ENABLED`] = packageFlag.toLowerCase();
  const needs = Object.fromEntries(['frontend', 'release', 'build'].map((name) => [name, { result }]));
  return new Function('github', 'needs', 'vars', 'inputs', 'always', `return (${condition});`)(
    { event_name: event, ref: 'refs/heads/main' }, needs, vars,
    { target: target.toLowerCase(), action: 'promote' }, () => true,
  );
}

for (const [job, target] of Object.entries(targets)) {
  test(`${target} automatic releases require both matching controls`, () => {
    const values = ['true', 'TRUE', 'false', '', 'yes', '1', 'true '];
    for (const org of values) {
      for (const packageFlag of values) {
        assert.equal(eligible(job, target, org, packageFlag),
          org.toLowerCase() === 'true' && packageFlag.toLowerCase() === 'true', `${org}/${packageFlag}`);
      }
    }
    for (const result of ['failure', 'cancelled', 'skipped']) {
      assert.equal(eligible(job, target, 'true', 'true', 'push', result), false);
    }
    assert.equal(eligible(job, target, 'true', 'true', 'pull_request'), false);
  });
}

test('manual recovery remains available with automatic controls off', () => {
  assert.equal(eligible('deploy', 'PRODUCTION', 'false', 'false', 'workflow_dispatch'), true);
});
