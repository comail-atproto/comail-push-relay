import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startRelay } from './lifecycle.mjs';

const SUBSCRIPTION_ID = 'subscription_12345';
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

test('stock EmailPush reloads existing subscriptions without exposing mail content', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'push-relay-existing-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await writeFile(path.join(dataDir, 'subscriptions.json'), JSON.stringify({ records: {
    [SUBSCRIPTION_ID]: {
      kind: 'web', verificationCode: 'existing-code', createdAt: Date.now(), lastPushAt: null,
      webPush: { endpoint: 'https://push.example.com/synthetic', keys: { p256dh: 'p', auth: 'a' } },
    },
  } }));
  const relay = await startRelay({ dataDir });
  t.after(() => relay.stop());
  assert.deepEqual(await relay.post(`/api/push/jmap/${SUBSCRIPTION_ID}`, {
    '@type': 'EmailPush', accountId: 'synthetic-account', state: '42',
    emails: [{ id: 'synthetic-message', subject: 'private-subject-canary', body: 'private-body-canary' }],
  }), { status: 200, body: { ok: false } });
  assert.doesNotMatch(relay.stdout() + relay.stderr(), /private-subject-canary|private-body-canary/);
  await relay.stop();
  const restarted = await startRelay({ dataDir });
  t.after(() => restarted.stop());
  assert.deepEqual(await restarted.json(`/api/push/verify/${SUBSCRIPTION_ID}`), {
    status: 200, body: { verificationCode: 'existing-code' },
  });
  assert.deepEqual(await restarted.json(`/api/push/active/${SUBSCRIPTION_ID}`), {
    status: 200, body: { active: true },
  });
});

test('retired approval dispatch stays unavailable with a legacy token', async (t) => {
  const token = 'a'.repeat(40);
  const relay = await startRelay({ env: { ACCESS_APPROVAL_DISPATCH_TOKEN: token } });
  t.after(() => relay.stop());
  const id = 'subscription_retired';
  assert.equal((await relay.post('/api/push/register', {
    subscriptionId: id, fcmToken: 'f'.repeat(64),
  })).status, 200);
  assert.equal((await relay.post('/api/push/internal/access-approval', {
    kind: 'access-approval', subscriptionIds: [id],
  }, `Bearer ${token}`)).status, 404);
  assert.equal((await relay.json('/api/health')).body.subscriptions, 1);
  assert.equal((await relay.json(`/api/push/active/${id}`)).body.active, true);
});
