import assert from 'node:assert/strict';
import test from 'node:test';

import { startRelay } from './lifecycle.mjs';

const TOKEN = 'a'.repeat(40);
const ID = 'subscription_12345';

const approval = (subscriptionIds) => ({ kind: 'access-approval', subscriptionIds });

test('access-approval dispatch checks bearer, payload, and distinct IDs', async (t) => {
  const relay = await startRelay({ env: { ACCESS_APPROVAL_DISPATCH_TOKEN: `  ${TOKEN}  ` } });
  t.after(() => relay.stop());

  const authorization = `Bearer ${TOKEN}`;
  const cases = [
    ['missing bearer', approval(['missing_123']), undefined, 401, 'Unauthorized'],
    ['wrong bearer', approval(['missing_123']), 'Bearer wrong', 401, 'Unauthorized'],
    ['same-length wrong bearer', approval(['missing_123']), `Bearer ${'b'.repeat(TOKEN.length)}`, 401, 'Unauthorized'],
    ['non-bearer scheme', approval(['missing_123']), `Token ${TOKEN}`, 401, 'Unauthorized'],
    ['wrong kind', { kind: 'other', subscriptionIds: ['missing_123'] }, authorization, 400, 'Invalid access approval dispatch'],
    ['empty IDs', approval([]), authorization, 400, 'Invalid access approval dispatch'],
    ['more than 16 IDs', approval(Array.from({ length: 17 }, (_, i) => `subscription_${i}`)), authorization, 400, 'Invalid access approval dispatch'],
    ['unknown ID is missing', approval(['missing_123']), authorization, 200, { delivered: 0, missing: 1, removed: 0, failed: 0 }],
    ['duplicate IDs count once', approval(['missing_123', 'missing_123']), authorization, 200, { delivered: 0, missing: 1, removed: 0, failed: 0 }],
  ];

  for (const [name, body, bearer, status, result] of cases) {
    await t.test(name, async () => {
      const response = await relay.post('/api/push/internal/access-approval', body, bearer);
      assert.equal(response.status, status);
      assert.deepEqual(response.body, typeof result === 'string' ? { error: result } : { ok: true, ...result });
    });
  }
});

test('access-approval dispatch is unavailable without a sufficiently long configured token', async (t) => {
  for (const [name, token] of [['missing', undefined], ['short', 'short']]) {
    await t.test(name, async (st) => {
      const relay = await startRelay({ env: { ACCESS_APPROVAL_DISPATCH_TOKEN: token } });
      st.after(() => relay.stop());
      assert.deepEqual(await relay.post('/api/push/internal/access-approval', approval([ID]), `Bearer ${TOKEN}`), {
        status: 503,
        body: { error: 'Access approval dispatch not configured' },
      });
    });
  }
});
