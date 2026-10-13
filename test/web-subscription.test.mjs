import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { startRelay } from './lifecycle.mjs';
import {
  WEB_PUSH_ENV,
  WEB_PUSH_PUBLIC_KEY,
  WEB_SUBSCRIPTION,
} from './web-push-fixture.mjs';

const ID = 'subscription_web_123';
const FCM_TOKEN = 'f'.repeat(64);
const ok = { status: 200, body: { ok: true } };

test('registration refresh preserves creation time and clears verification across transports', async (t) => {
  const relay = await startRelay({ env: WEB_PUSH_ENV });
  t.after(() => relay.stop());

  const record = async () => JSON.parse(
    await readFile(path.join(relay.dataDir, 'subscriptions.json'), 'utf8'),
  ).records[ID];
  const verify = () => relay.json(`/api/push/verify/${ID}`);
  const pushVerification = (code) => relay.post(`/api/push/jmap/${ID}`, {
    '@type': 'PushVerification',
    pushSubscriptionId: ID,
    verificationCode: code,
  });

  assert.deepEqual(await relay.json('/api/push/vapid-public-key'), {
    status: 200,
    body: { publicKey: WEB_PUSH_PUBLIC_KEY },
  });
  assert.deepEqual(await relay.post('/api/push/register', {
    subscriptionId: ID,
    fcmToken: FCM_TOKEN,
    accountLabel: 'f'.repeat(140),
  }), ok);
  assert.deepEqual(await verify(), { status: 200, body: { verificationCode: null } });
  const original = await record();
  assert.equal(original.accountLabel.length, 120);

  const transitions = [
    {
      name: 'FCM refresh',
      route: '/api/push/register',
      body: { subscriptionId: ID, fcmToken: 'g'.repeat(64), accountLabel: 'f'.repeat(140) },
      kind: 'fcm',
      label: 'f'.repeat(120),
    },
    {
      name: 'FCM to Web Push',
      route: '/api/push/register/web',
      body: { subscriptionId: ID, subscription: WEB_SUBSCRIPTION, accountLabel: 'w'.repeat(140) },
      kind: 'web',
      label: 'w'.repeat(120),
    },
    {
      name: 'Web Push refresh',
      route: '/api/push/register/web',
      body: { subscriptionId: ID, subscription: WEB_SUBSCRIPTION, accountLabel: 'refreshed' },
      kind: 'web',
      label: 'refreshed',
    },
    {
      name: 'Web Push to FCM',
      route: '/api/push/register',
      body: { subscriptionId: ID, fcmToken: FCM_TOKEN, accountLabel: 'mobile' },
      kind: 'fcm',
      label: 'mobile',
    },
  ];

  for (const transition of transitions) {
    assert.deepEqual(await pushVerification('123456'), ok, transition.name);
    assert.deepEqual(await verify(), {
      status: 200,
      body: { verificationCode: '123456' },
    }, transition.name);
    assert.deepEqual(await relay.post(transition.route, transition.body), ok, transition.name);
    assert.deepEqual(await verify(), { status: 200, body: { verificationCode: null } }, transition.name);
    const refreshed = await record();
    assert.equal(refreshed.kind, transition.kind, transition.name);
    assert.equal(refreshed.accountLabel, transition.label, transition.name);
    assert.equal(refreshed.createdAt, original.createdAt, transition.name);
    assert.equal(refreshed.lastPushAt, null, transition.name);
  }

  assert.deepEqual(await relay.json(`/api/push/active/${ID}`), {
    status: 200,
    body: { active: true },
  });
  assert.deepEqual(await relay.json(`/api/push/register/${ID}`, { method: 'DELETE' }), ok);
  assert.deepEqual(await verify(), { status: 404, body: { error: 'Unknown subscription' } });
  assert.equal((await relay.json('/api/health')).body.subscriptions, 0);
  assert.deepEqual(JSON.parse(
    await readFile(path.join(relay.dataDir, 'subscriptions.json'), 'utf8'),
  ).records, {});
});

test('Web Push endpoints report unconfigured without VAPID keys', async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());

  assert.deepEqual(await relay.json('/api/push/vapid-public-key'), {
    status: 503,
    body: { error: 'Web Push not configured' },
  });
  assert.deepEqual(await relay.post('/api/push/register/web', {
    subscriptionId: ID,
    subscription: WEB_SUBSCRIPTION,
  }), { status: 503, body: { error: 'Web Push not configured' } });
  assert.equal((await relay.json('/api/health')).body.subscriptions, 0);
});
