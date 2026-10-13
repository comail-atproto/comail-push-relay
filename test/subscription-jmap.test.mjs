import assert from 'node:assert/strict';
import test from 'node:test';

import { startRelay } from './lifecycle.mjs';

const SUBSCRIPTION_ID = 'subscription_12345';
const FCM_TOKEN = 'f'.repeat(64);

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
    await t.test(c.name, async (st) => {
      const relay = await startRelay();
      st.after(() => relay.stop());
      const response = c.raw
        ? await relay.json('/api/push/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: c.raw,
          })
        : await relay.post('/api/push/register', c.body);
      assert.deepEqual(response, c.want);
      assert.equal((await relay.json('/api/health')).body.subscriptions, c.stored);
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
