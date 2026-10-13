import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import webpush from 'web-push';

import { startRelay } from './lifecycle.mjs';

const SUBSCRIPTION_ID = 'subscription_web_123';
const FCM_TOKEN = 'f'.repeat(64);
const KEYS = webpush.generateVAPIDKeys();
const WEB_SUBSCRIPTION = {
  endpoint: 'https://push.example.test/subscription/123',
  keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(16) },
};

function configuredRelay() {
  return startRelay({
    env: {
      VAPID_PUBLIC_KEY: KEYS.publicKey,
      VAPID_PRIVATE_KEY: KEYS.privateKey,
      VAPID_SUBJECT: 'mailto:test@example.test',
    },
  });
}

test('Web Push registration validation matrix', async (t) => {
  const cases = [
    {
      name: 'valid subscription is accepted',
      body: { subscriptionId: SUBSCRIPTION_ID, subscription: WEB_SUBSCRIPTION },
      want: { status: 200, body: { ok: true } },
      stored: 1,
    },
    {
      name: 'missing subscriptionId is rejected',
      body: { subscription: WEB_SUBSCRIPTION },
      want: { status: 400, body: { error: 'Invalid subscriptionId' } },
      stored: 0,
    },
    {
      name: 'non-HTTPS endpoint is rejected',
      body: {
        subscriptionId: SUBSCRIPTION_ID,
        subscription: { ...WEB_SUBSCRIPTION, endpoint: 'http://push.example.test/subscription/123' },
      },
      want: { status: 400, body: { error: 'Invalid subscription' } },
      stored: 0,
    },
    {
      name: 'short subscription key is rejected',
      body: {
        subscriptionId: SUBSCRIPTION_ID,
        subscription: {
          ...WEB_SUBSCRIPTION,
          keys: { ...WEB_SUBSCRIPTION.keys, p256dh: 'short' },
        },
      },
      want: { status: 400, body: { error: 'Invalid subscription' } },
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
    await t.test(c.name, async (st) => {
      const relay = await configuredRelay();
      st.after(() => relay.stop());
      const response = c.raw
        ? await relay.json('/api/push/register/web', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: c.raw,
          })
        : await relay.post('/api/push/register/web', c.body);
      assert.deepEqual(response, c.want);
      assert.equal((await relay.json('/api/health')).body.subscriptions, c.stored);
    });
  }
});

test('Web Push registration refreshes labels and verification across transport changes', async (t) => {
  const relay = await configuredRelay();
  t.after(() => relay.stop());

  assert.deepEqual(await relay.json('/api/push/vapid-public-key'), {
    status: 200,
    body: { publicKey: KEYS.publicKey },
  });
  assert.deepEqual(await relay.post('/api/push/register', {
    subscriptionId: SUBSCRIPTION_ID,
    fcmToken: FCM_TOKEN,
    accountLabel: 'f'.repeat(140),
  }), { status: 200, body: { ok: true } });
  assert.deepEqual(await relay.post(`/api/push/jmap/${SUBSCRIPTION_ID}`, {
    '@type': 'PushVerification',
    pushSubscriptionId: SUBSCRIPTION_ID,
    verificationCode: '111111',
  }), { status: 200, body: { ok: true } });
  const original = JSON.parse(
    await readFile(path.join(relay.dataDir, 'subscriptions.json'), 'utf8'),
  ).records[SUBSCRIPTION_ID];
  assert.equal(original.accountLabel.length, 120);

  assert.deepEqual(await relay.post('/api/push/register/web', {
    subscriptionId: SUBSCRIPTION_ID,
    subscription: WEB_SUBSCRIPTION,
    accountLabel: 'w'.repeat(140),
  }), { status: 200, body: { ok: true } });
  const webRecord = JSON.parse(
    await readFile(path.join(relay.dataDir, 'subscriptions.json'), 'utf8'),
  ).records[SUBSCRIPTION_ID];
  assert.equal(webRecord.kind, 'web');
  assert.equal(webRecord.accountLabel.length, 120);
  assert.equal(webRecord.createdAt, original.createdAt);
  assert.equal(webRecord.lastPushAt, null);
  assert.deepEqual(await relay.json(`/api/push/verify/${SUBSCRIPTION_ID}`), {
    status: 200,
    body: { verificationCode: null },
  });
  assert.deepEqual(await relay.json(`/api/push/active/${SUBSCRIPTION_ID}`), {
    status: 200,
    body: { active: true },
  });

  assert.deepEqual(await relay.post(`/api/push/jmap/${SUBSCRIPTION_ID}`, {
    '@type': 'PushVerification',
    pushSubscriptionId: SUBSCRIPTION_ID,
    verificationCode: '222222',
  }), { status: 200, body: { ok: true } });
  assert.deepEqual(await relay.post('/api/push/register/web', {
    subscriptionId: SUBSCRIPTION_ID,
    subscription: WEB_SUBSCRIPTION,
    accountLabel: 'refreshed',
  }), { status: 200, body: { ok: true } });
  assert.deepEqual(await relay.json(`/api/push/verify/${SUBSCRIPTION_ID}`), {
    status: 200,
    body: { verificationCode: null },
  });
  assert.equal(JSON.parse(
    await readFile(path.join(relay.dataDir, 'subscriptions.json'), 'utf8'),
  ).records[SUBSCRIPTION_ID].createdAt, original.createdAt);

  assert.deepEqual(await relay.post(`/api/push/jmap/${SUBSCRIPTION_ID}`, {
    '@type': 'PushVerification',
    pushSubscriptionId: SUBSCRIPTION_ID,
    verificationCode: '333333',
  }), { status: 200, body: { ok: true } });
  assert.deepEqual(await relay.post('/api/push/register', {
    subscriptionId: SUBSCRIPTION_ID,
    fcmToken: FCM_TOKEN,
    accountLabel: 'mobile',
  }), { status: 200, body: { ok: true } });
  const fcmRecord = JSON.parse(
    await readFile(path.join(relay.dataDir, 'subscriptions.json'), 'utf8'),
  ).records[SUBSCRIPTION_ID];
  assert.equal(fcmRecord.kind, 'fcm');
  assert.equal(fcmRecord.accountLabel, 'mobile');
  assert.equal(fcmRecord.createdAt, original.createdAt);
  assert.equal(fcmRecord.lastPushAt, null);
  assert.deepEqual(await relay.json(`/api/push/verify/${SUBSCRIPTION_ID}`), {
    status: 200,
    body: { verificationCode: null },
  });
});

test('Web Push endpoints report unconfigured without VAPID keys', async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());

  assert.deepEqual(await relay.json('/api/push/vapid-public-key'), {
    status: 503,
    body: { error: 'Web Push not configured' },
  });
  assert.deepEqual(await relay.post('/api/push/register/web', {
    subscriptionId: SUBSCRIPTION_ID,
    subscription: WEB_SUBSCRIPTION,
  }), {
    status: 503,
    body: { error: 'Web Push not configured' },
  });
  assert.equal((await relay.json('/api/health')).body.subscriptions, 0);
});
