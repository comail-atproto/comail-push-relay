import assert from 'node:assert/strict';
import test from 'node:test';

import { startTestRelay } from './handler-fixtures.mjs';

const TOKEN = 'a'.repeat(40);
const ID = 'subscription_12345';
const approval = (subscriptionIds) => ({ kind: 'access-approval', subscriptionIds });

function configureToken(value) {
  if (value === undefined) delete process.env.ACCESS_APPROVAL_DISPATCH_TOKEN;
  else process.env.ACCESS_APPROVAL_DISPATCH_TOKEN = value;
}

test('access-approval checks bearer, payload, and unique missing IDs', async (t) => {
  const originalToken = process.env.ACCESS_APPROVAL_DISPATCH_TOKEN;
  const relay = await startTestRelay();
  t.after(async () => {
    try {
      await relay.close();
    } finally {
      configureToken(originalToken);
    }
  });

  for (const [name, token] of [['missing', undefined], ['short', 'short']]) {
    await t.test(`configuration: ${name}`, async () => {
      configureToken(token);
      assert.deepEqual(await relay.post(
        '/api/push/internal/access-approval', approval([ID]), `Bearer ${TOKEN}`,
      ), { status: 503, body: { error: 'Access approval dispatch not configured' } });
    });
  }

  configureToken(`  ${TOKEN}  `);
  const bearer = `Bearer ${TOKEN}`;
  const cases = [
    ['missing bearer', approval(['missing_123']), undefined, 401, 'Unauthorized'],
    ['wrong bearer', approval(['missing_123']), 'Bearer wrong', 401, 'Unauthorized'],
    ['same-length wrong bearer', approval(['missing_123']), `Bearer ${'b'.repeat(TOKEN.length)}`, 401, 'Unauthorized'],
    ['non-bearer scheme', approval(['missing_123']), `Token ${TOKEN}`, 401, 'Unauthorized'],
    ['wrong kind', { kind: 'other', subscriptionIds: ['missing_123'] }, bearer, 400, 'Invalid access approval dispatch'],
    ['empty IDs', approval([]), bearer, 400, 'Invalid access approval dispatch'],
    ['more than 16 IDs', approval(Array.from({ length: 17 }, (_, i) => `subscription_${i}`)), bearer, 400, 'Invalid access approval dispatch'],
    ['unknown IDs are deduplicated', approval(['missing_123', 'missing_456', 'missing_123']), bearer, 200, { delivered: 0, missing: 2, removed: 0, failed: 0 }],
  ];

  for (const [name, body, authorization, status, result] of cases) {
    await t.test(name, async () => {
      const response = await relay.post('/api/push/internal/access-approval', body, authorization);
      assert.equal(response.status, status);
      assert.deepEqual(response.body, typeof result === 'string' ? { error: result } : { ok: true, ...result });
    });
  }
});
