import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverStateChange } from '../dist/delivery.js';
import { pushesForwarded } from '../dist/metrics.js';
import { startTestRelay } from './handler-fixtures.mjs';
import {
  mockWebPush,
  WEB_PUSH_PUBLIC_KEY,
  WEB_SUBSCRIPTION,
} from './web-push-fixture.mjs';

const ID = 'subscription_web_123';
const FCM_TOKEN = 'f'.repeat(64);
const ok = { status: 200, body: { ok: true } };
const verification = (code) => ({
  '@type': 'PushVerification',
  pushSubscriptionId: ID,
  verificationCode: code,
});

test('registration, StateChange, refresh, transport switches, and delete persist together', async (t) => {
  const createdAt = 1_700_000_000_000;
  const activeGraceMs = 10 * 60 * 1000;
  const webSubscription = {
    ...WEB_SUBSCRIPTION,
    endpoint: `${WEB_SUBSCRIPTION.endpoint}/201`,
  };
  let now = createdAt;
  t.mock.method(Date, 'now', () => now);
  mockWebPush(t);
  const relay = await startTestRelay(t, {
    getVapidPublicKey: () => WEB_PUSH_PUBLIC_KEY,
    deliverStateChange,
  });

  const read = async () => (await relay.readRecords())[ID];
  const verify = () => relay.json(`/api/push/verify/${ID}`);
  const stateChange = {
    '@type': 'StateChange',
    changed: { 'urn:ietf:params:jmap:mail': { Mailbox: 'state-42' } },
  };
  assert.deepEqual(await relay.post('/api/push/register/web', {
    subscriptionId: ID,
    subscription: webSubscription,
    accountLabel: 'initial',
  }), ok);
  const original = await read();
  assert.equal(original.accountLabel, 'initial');
  assert.equal(original.createdAt, createdAt);
  assert.deepEqual(await relay.post(`/api/push/jmap/${ID}`, verification('123456')), ok);
  now = createdAt + activeGraceMs - 1;
  assert.deepEqual(await relay.json(`/api/push/active/${ID}`), { status: 200, body: { active: true } });
  now += 1;
  assert.deepEqual(await relay.json(`/api/push/active/${ID}`), { status: 200, body: { active: false } });
  now += 1;
  const pushedAt = now;
  assert.deepEqual(await relay.post(`/api/push/jmap/${ID}`, stateChange), { status: 200, body: { ok: true } });
  const { values } = await pushesForwarded.get();
  assert.equal(values.find(({ labels }) => labels.transport === 'web' && labels.result === 'ok')?.value, 1);
  const pushed = await read();
  assert.equal(pushed.verificationCode, '123456');
  assert.equal(pushed.lastPushAt, pushedAt);
  assert.deepEqual(await relay.json(`/api/push/active/${ID}`), { status: 200, body: { active: true } });

  const transitions = [
    {
      name: 'Web Push refresh', route: '/api/push/register/web',
      body: { subscription: webSubscription, accountLabel: 'refreshed' },
      kind: 'web', label: 'refreshed',
    },
    {
      name: 'Web Push to FCM', route: '/api/push/register',
      body: { fcmToken: FCM_TOKEN, accountLabel: 'f'.repeat(140) },
      kind: 'fcm', label: 'f'.repeat(120),
    },
    {
      name: 'FCM to Web Push', route: '/api/push/register/web',
      body: { subscription: webSubscription, accountLabel: 'w'.repeat(140) },
      kind: 'web', label: 'w'.repeat(120),
    },
  ];
  for (const transition of transitions) {
    assert.deepEqual(await relay.post(`/api/push/jmap/${ID}`, verification('123456')), ok, transition.name);
    assert.deepEqual(await verify(), { status: 200, body: { verificationCode: '123456' } }, transition.name);
    assert.deepEqual(await relay.post(transition.route, { subscriptionId: ID, ...transition.body }), ok, transition.name);
    assert.deepEqual(await verify(), { status: 200, body: { verificationCode: null } }, transition.name);
    const current = await read();
    assert.equal(current.kind, transition.kind, transition.name);
    assert.equal(current.accountLabel, transition.label, transition.name);
    assert.equal(current.createdAt, original.createdAt, transition.name);
    assert.equal(current.lastPushAt, pushed.lastPushAt, transition.name);
  }

  assert.deepEqual(await relay.json(`/api/push/active/${ID}`), { status: 200, body: { active: true } });
  assert.deepEqual(await relay.json(`/api/push/register/${ID}`, { method: 'DELETE' }), ok);
  assert.deepEqual(await verify(), { status: 404, body: { error: 'Unknown subscription' } });
  assert.deepEqual(await relay.readRecords(), {});
  assert.equal((await relay.json('/api/health')).body.subscriptions, 0);
});

test('Web Push endpoints report unconfigured without VAPID keys', async (t) => {
  const relay = await startTestRelay(t);

  assert.deepEqual(await relay.json('/api/push/vapid-public-key'), {
    status: 503,
    body: { error: 'Web Push not configured' },
  });
  assert.deepEqual(await relay.post('/api/push/register/web', {
    subscriptionId: ID,
    subscription: WEB_SUBSCRIPTION,
  }), { status: 503, body: { error: 'Web Push not configured' } });
  assert.deepEqual(await relay.readRecords(), {});
});
