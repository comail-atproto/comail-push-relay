import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { startRelay } from './lifecycle.mjs';

const SUBSCRIPTION_ID = 'subscription_12345';
const DISPATCH_TOKEN = 'a'.repeat(40);
const FCM_TOKEN = 'f'.repeat(64);

test('relay reports its bound listen address and reaches readiness', async () => {
  const relay = await startRelay();
  try {
    assert.ok(Number.isInteger(relay.port) && relay.port > 0, `port=${relay.port}`);
    const health = (await relay.json('/api/health')).body;
    assert.equal(health.ok, true);
    assert.equal(health.subscriptions, 0);
    assert.equal(health.release_identity, undefined);
  } finally {
    await relay.stop();
  }
});

test('a startup failure surfaces bounded child diagnostics', async () => {
  await assert.rejects(startRelay({ env: { PORT: 'not-a-port' } }), (error) => {
    assert.match(error.message, /relay exited before signaling readiness/);
    assert.match(error.message, /child exit: code=/);
    assert.match(error.message, /stderr tail:/);
    return true;
  });
});

test('a spawn failure rejects promptly and removes the fixture store', { timeout: 1500 }, async () => {
  let dataDir;
  await assert.rejects(startRelay({ cwd: '/comail-test-missing-directory' }), (error) => {
    assert.match(error.message, /relay failed to spawn/);
    assert.match(error.message, /spawn error:/);
    dataDir = error.message.match(/data dir: (.*)/)[1];
    return true;
  });
  await assert.rejects(stat(dataDir), { code: 'ENOENT' });
});

test('registration validation matrix', async (t) => {
  const cases = [
    {
      name: 'valid FCM token is accepted',
      body: { subscriptionId: SUBSCRIPTION_ID, fcmToken: FCM_TOKEN },
      want: { status: 200, body: { ok: true } },
      stored: 1,
    },
    {
      name: 'missing subscriptionId is rejected',
      body: { fcmToken: FCM_TOKEN },
      want: { status: 400, body: { error: 'Invalid subscriptionId' } },
      stored: 0,
    },
    {
      name: 'short subscriptionId is rejected',
      body: { subscriptionId: 'short', fcmToken: FCM_TOKEN },
      want: { status: 400, body: { error: 'Invalid subscriptionId' } },
      stored: 0,
    },
    {
      name: 'short FCM token is rejected',
      body: { subscriptionId: SUBSCRIPTION_ID, fcmToken: 'too-short' },
      want: { status: 400, body: { error: 'Invalid fcmToken' } },
      stored: 0,
    },
    {
      name: 'invalid JSON body is rejected',
      raw: '{not json',
      want: { status: 400, body: { error: 'Invalid JSON' } },
      stored: 0,
    },
  ];

  for (const c of cases) {
    await t.test(c.name, async () => {
      const relay = await startRelay();
      try {
        const response = c.raw
          ? await relay.json('/api/push/register', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: c.raw,
            })
          : await relay.post('/api/push/register', c.body);
        assert.deepEqual(response, c.want);
        assert.equal((await relay.json('/api/health')).body.subscriptions, c.stored);
      } finally {
        await relay.stop();
      }
    });
  }
});

test('subscription lifecycle persists, verifies and tears down cleanly', async () => {
  const relay = await startRelay();
  try {
    assert.deepEqual(await relay.post('/api/push/register', {
      subscriptionId: SUBSCRIPTION_ID,
      fcmToken: FCM_TOKEN,
    }), { status: 200, body: { ok: true } });

    assert.deepEqual(await relay.json(`/api/push/verify/${SUBSCRIPTION_ID}`), {
      status: 200,
      body: { verificationCode: null },
    });
    assert.deepEqual(await relay.post(`/api/push/jmap/${SUBSCRIPTION_ID}`, {
      '@type': 'PushVerification',
      pushSubscriptionId: SUBSCRIPTION_ID,
      verificationCode: '123456',
    }), { status: 200, body: { ok: true } });
    assert.deepEqual(await relay.json(`/api/push/verify/${SUBSCRIPTION_ID}`), {
      status: 200,
      body: { verificationCode: '123456' },
    });
    assert.deepEqual(await relay.json(`/api/push/active/${SUBSCRIPTION_ID}`), {
      status: 200,
      body: { active: true },
    });

    const persisted = JSON.parse(
      await readFile(path.join(relay.dataDir, 'subscriptions.json'), 'utf8'),
    );
    assert.deepEqual(Object.keys(persisted.records), [SUBSCRIPTION_ID]);

    assert.deepEqual(
      await relay.json(`/api/push/register/${SUBSCRIPTION_ID}`, { method: 'DELETE' }),
      { status: 200, body: { ok: true } },
    );
    assert.equal((await relay.json(`/api/push/verify/${SUBSCRIPTION_ID}`)).status, 404);
    assert.equal((await relay.json('/api/health')).body.subscriptions, 0);
    const emptied = JSON.parse(
      await readFile(path.join(relay.dataDir, 'subscriptions.json'), 'utf8'),
    );
    assert.deepEqual(emptied.records, {});
  } finally {
    await relay.stop();
  }
});

test('access-approval dispatch enforces authorization and payload shape', async (t) => {
  const relay = await startRelay({
    env: { ACCESS_APPROVAL_DISPATCH_TOKEN: DISPATCH_TOKEN },
  });
  t.after(() => relay.stop());
  assert.deepEqual(await relay.post('/api/push/register', {
    subscriptionId: SUBSCRIPTION_ID,
    fcmToken: FCM_TOKEN,
  }), { status: 200, body: { ok: true } });
  assert.deepEqual(await relay.post('/api/push/internal/access-approval', {
    kind: 'access-approval', subscriptionIds: [SUBSCRIPTION_ID],
  }, `Bearer ${DISPATCH_TOKEN}`), {
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
      const response = await relay.json('/api/push/internal/access-approval', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(c.authorization ? { authorization: c.authorization } : {}),
        },
        body: JSON.stringify(c.body),
      });
      assert.deepEqual(response, c.want);
    });
  }
});
