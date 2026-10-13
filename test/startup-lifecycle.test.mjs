import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { startRelay } from './lifecycle.mjs';

const SUBSCRIPTION_ID = 'subscription_12345';
const FCM_TOKEN = 'f'.repeat(64);

test('relay reports its bound listen address and reaches readiness', async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());

  assert.ok(Number.isInteger(relay.port) && relay.port > 0, `port=${relay.port}`);
  const health = (await relay.json('/api/health')).body;
  assert.equal(health.ok, true);
  assert.equal(health.subscriptions, 0);
  assert.equal(health.release_identity, undefined);
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

test('store loading migrates legacy records and drops records past TTL', async (t) => {
  const now = Date.now();
  const relay = await startRelay({
    initialRecords: {
      legacy_sub_123: {
        fcmToken: 'f'.repeat(64),
        verificationCode: '654321',
        createdAt: now - 11 * 60 * 1000,
        lastPushAt: null,
      },
      expired_sub_123: {
        fcmToken: 'g'.repeat(64),
        verificationCode: null,
        createdAt: now - 91 * 24 * 60 * 60 * 1000,
        lastPushAt: null,
      },
    },
  });
  t.after(() => relay.stop());

  assert.equal((await relay.json('/api/health')).body.subscriptions, 1);
  assert.deepEqual(await relay.json('/api/push/verify/legacy_sub_123'), {
    status: 200,
    body: { verificationCode: '654321' },
  });
  assert.deepEqual(await relay.json('/api/push/active/legacy_sub_123'), {
    status: 200,
    body: { active: false },
  });
  const metrics = await relay.request('/metrics').then((response) => response.text());
  assert.match(metrics, /^relay_subscriptions_active\{transport="fcm"\} 1$/m);
  assert.deepEqual(await relay.json('/api/push/verify/expired_sub_123'), {
    status: 404,
    body: { error: 'Unknown subscription' },
  });
});

test('subscription lifecycle persists, verifies and tears down cleanly', async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());

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
  const createdAt = persisted.records[SUBSCRIPTION_ID].createdAt;
  assert.deepEqual(Object.keys(persisted.records), [SUBSCRIPTION_ID]);

  assert.deepEqual(await relay.post('/api/push/register', {
    subscriptionId: SUBSCRIPTION_ID,
    fcmToken: 'g'.repeat(64),
  }), { status: 200, body: { ok: true } });
  assert.deepEqual(await relay.json(`/api/push/verify/${SUBSCRIPTION_ID}`), {
    status: 200,
    body: { verificationCode: null },
  });
  const refreshed = JSON.parse(
    await readFile(path.join(relay.dataDir, 'subscriptions.json'), 'utf8'),
  );
  assert.equal(refreshed.records[SUBSCRIPTION_ID].createdAt, createdAt);
  assert.equal(refreshed.records[SUBSCRIPTION_ID].lastPushAt, null);

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
});
