import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';

import { startRelay } from './lifecycle.mjs';
import { WEB_PUSH_ENV, WEB_PUSH_PUBLIC_KEY } from './web-push-fixture.mjs';

test('startup failures report child errors and remove their temporary stores', { timeout: 3000 }, async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'relay-startup-test-'));
  const oldTempDir = process.env.TMPDIR;
  process.env.TMPDIR = tempRoot;
  t.after(async () => {
    if (oldTempDir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = oldTempDir;
    await rm(tempRoot, { recursive: true, force: true });
  });

  await t.test('invalid listen port reports the cause', async () => {
    await assert.rejects(startRelay({ env: { PORT: 'not-a-port' } }), /options\.port should be/);
  });
  await t.test('spawn failure reports ENOENT', async () => {
    await assert.rejects(startRelay({ cwd: path.join(tempRoot, 'missing') }), /ENOENT/);
  });
  assert.deepEqual(await readdir(tempRoot), []);
});

test('readiness loads legacy records, configures Web Push, and drops expired records', async (t) => {
  const now = Date.now();
  const relay = await startRelay({
    env: WEB_PUSH_ENV,
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
  t.after(() => relay.close());

  assert.ok(Number.isInteger(relay.port) && relay.port > 0, `port=${relay.port}`);
  const health = (await relay.json('/api/health')).body;
  assert.equal(health.ok, true);
  assert.equal(health.subscriptions, 1);
  assert.equal(health.release_identity, undefined);
  assert.deepEqual(await relay.json('/api/push/vapid-public-key'), {
    status: 200,
    body: { publicKey: WEB_PUSH_PUBLIC_KEY },
  });
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
