import assert from 'node:assert/strict';
import test from 'node:test';

import { startRelay } from './lifecycle.mjs';

const SUBSCRIPTION_ID = 'subscription_12345';
const FCM_TOKEN = 'f'.repeat(64);

test('subscription routes reject invalid IDs and active lookup leaves unknown IDs alone', async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());

  const cases = [
    ['unregister invalid ID', 'DELETE', '/api/push/register/invalid!id', 400, 'Invalid subscriptionId'],
    ['verify invalid ID', 'GET', '/api/push/verify/invalid!id', 400, 'Invalid subscriptionId'],
    ['active invalid ID', 'GET', '/api/push/active/invalid!id', 400, 'Invalid subscriptionId'],
    ['JMAP invalid ID', 'POST', '/api/push/jmap/invalid!id', 400, 'Invalid subscriptionId'],
    ['active unknown ID', 'GET', '/api/push/active/unknown_123', 404, 'Unknown subscription'],
  ];
  for (const [name, method, route, status, error] of cases) {
    await t.test(name, async () => {
      assert.deepEqual(await relay.json(route, { method }), { status, body: { error } });
    });
  }
});

test('JMAP callbacks reject missing records and malformed or unsupported bodies', async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());
  assert.deepEqual(await relay.post('/api/push/register', {
    subscriptionId: SUBSCRIPTION_ID,
    fcmToken: FCM_TOKEN,
  }), { status: 200, body: { ok: true } });

  const cases = [
    {
      name: 'unknown subscription is not found',
      id: 'unknown_subscription',
      raw: JSON.stringify({ '@type': 'PushVerification', verificationCode: '123456' }),
      want: { status: 404, body: { error: 'Unknown subscription' } },
    },
    {
      name: 'invalid JSON is rejected',
      id: SUBSCRIPTION_ID,
      raw: '{not json',
      want: { status: 400, body: { error: 'Invalid JMAP push body' } },
    },
    {
      name: 'missing type is rejected',
      id: SUBSCRIPTION_ID,
      raw: JSON.stringify({ verificationCode: '123456' }),
      want: { status: 400, body: { error: 'Invalid JMAP push body' } },
    },
    {
      name: 'unsupported type is rejected',
      id: SUBSCRIPTION_ID,
      raw: JSON.stringify({ '@type': 'Other' }),
      want: { status: 400, body: { error: 'Unsupported JMAP push type' } },
    },
  ];

  for (const c of cases) {
    await t.test(c.name, async () => {
      assert.deepEqual(await relay.json(`/api/push/jmap/${c.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: c.raw,
      }), c.want);
    });
  }
});
