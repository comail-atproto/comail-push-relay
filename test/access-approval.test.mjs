import assert from 'node:assert/strict';
import test from 'node:test';

import { startRelay } from './lifecycle.mjs';

const DISPATCH_TOKEN = 'a'.repeat(40);
const SUBSCRIPTION_ID = 'subscription_12345';
const FCM_TOKEN = 'f'.repeat(64);

function dispatch(body, authorization) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  };
}

test('access-approval dispatch enforces authorization and payload shape', async (t) => {
  const relay = await startRelay({
    env: { ACCESS_APPROVAL_DISPATCH_TOKEN: DISPATCH_TOKEN },
  });
  t.after(() => relay.stop());
  assert.deepEqual(await relay.post('/api/push/register', {
    subscriptionId: SUBSCRIPTION_ID,
    fcmToken: FCM_TOKEN,
  }), { status: 200, body: { ok: true } });
  assert.deepEqual(await relay.json('/api/push/internal/access-approval', dispatch({
    kind: 'access-approval',
    subscriptionIds: [SUBSCRIPTION_ID],
  }, `Bearer ${DISPATCH_TOKEN}`)), {
    status: 200,
    body: { ok: true, delivered: 0, missing: 1, removed: 0, failed: 0 },
  });

  const unknown = { kind: 'access-approval', subscriptionIds: ['unknown_subscription'] };
  const cases = [
    {
      name: 'missing bearer is unauthorized',
      body: unknown,
      want: { status: 401, body: { error: 'Unauthorized' } },
    },
    {
      name: 'wrong bearer is unauthorized',
      body: unknown,
      authorization: 'Bearer wrong',
      want: { status: 401, body: { error: 'Unauthorized' } },
    },
    {
      name: 'same-length wrong bearer is unauthorized',
      body: unknown,
      authorization: `Bearer ${'b'.repeat(DISPATCH_TOKEN.length)}`,
      want: { status: 401, body: { error: 'Unauthorized' } },
    },
    {
      name: 'non-bearer scheme is unauthorized',
      body: unknown,
      authorization: `Token ${DISPATCH_TOKEN}`,
      want: { status: 401, body: { error: 'Unauthorized' } },
    },
    {
      name: 'malformed dispatch is rejected',
      body: { kind: 'other', subscriptionIds: ['unknown_subscription'] },
      authorization: `Bearer ${DISPATCH_TOKEN}`,
      want: { status: 400, body: { error: 'Invalid access approval dispatch' } },
    },
    {
      name: 'empty id list is rejected',
      body: { kind: 'access-approval', subscriptionIds: [] },
      authorization: `Bearer ${DISPATCH_TOKEN}`,
      want: { status: 400, body: { error: 'Invalid access approval dispatch' } },
    },
    {
      name: 'too many ids are rejected',
      body: {
        kind: 'access-approval',
        subscriptionIds: Array.from({ length: 17 }, (_, i) => `subscription_${i}`),
      },
      authorization: `Bearer ${DISPATCH_TOKEN}`,
      want: { status: 400, body: { error: 'Invalid access approval dispatch' } },
    },
    {
      name: 'duplicate unknown ids count once',
      body: { kind: 'access-approval', subscriptionIds: ['unknown_subscription', 'unknown_subscription'] },
      authorization: `Bearer ${DISPATCH_TOKEN}`,
      want: {
        status: 200,
        body: { ok: true, delivered: 0, missing: 1, removed: 0, failed: 0 },
      },
    },
    {
      name: 'unknown ids report as missing',
      body: unknown,
      authorization: `Bearer ${DISPATCH_TOKEN}`,
      want: {
        status: 200,
        body: { ok: true, delivered: 0, missing: 1, removed: 0, failed: 0 },
      },
    },
  ];

  for (const c of cases) {
    await t.test(c.name, async () => {
      assert.deepEqual(await relay.json('/api/push/internal/access-approval', dispatch(c.body, c.authorization)), c.want);
    });
  }
});

test('access-approval dispatch is disabled when the token is absent or too short', async (t) => {
  for (const token of [undefined, 'short']) {
    await t.test(token === undefined ? 'missing token' : 'short token', async (st) => {
      const relay = await startRelay({ env: { ACCESS_APPROVAL_DISPATCH_TOKEN: token } });
      st.after(() => relay.stop());
      assert.deepEqual(await relay.json('/api/push/internal/access-approval', dispatch({
        kind: 'access-approval',
        subscriptionIds: ['unknown_subscription'],
      }, `Bearer ${DISPATCH_TOKEN}`)), {
        status: 503,
        body: { error: 'Access approval dispatch not configured' },
      });
    });
  }
});

test('access-approval dispatch trims the configured token', async (t) => {
  const relay = await startRelay({
    env: { ACCESS_APPROVAL_DISPATCH_TOKEN: `  ${DISPATCH_TOKEN}  ` },
  });
  t.after(() => relay.stop());
  assert.deepEqual(await relay.json('/api/push/internal/access-approval', dispatch({
    kind: 'access-approval',
    subscriptionIds: ['unknown_subscription'],
  }, `Bearer ${DISPATCH_TOKEN}`)), {
    status: 200,
    body: { ok: true, delivered: 0, missing: 1, removed: 0, failed: 0 },
  });
});
