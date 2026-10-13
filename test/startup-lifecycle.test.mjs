import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import test from 'node:test';

import { startRelay } from './lifecycle.mjs';

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
