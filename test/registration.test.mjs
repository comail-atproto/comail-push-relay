import assert from 'node:assert/strict';
import test from 'node:test';

import { startTestRelay } from './handler-fixtures.mjs';
import { WEB_PUSH_PUBLIC_KEY, WEB_SUBSCRIPTION } from './web-push-fixture.mjs';

const ID = 'subscription_register_1';

test('registration routes parse JSON, validate, and leave rejected requests unwritten', async (t) => {
  const cases = [
    ['FCM malformed JSON', '/api/push/register', '{not json', 'Invalid JSON'],
    ['FCM missing ID', '/api/push/register', { fcmToken: 'f'.repeat(64) }, 'Invalid subscriptionId'],
    ['FCM validation', '/api/push/register', { subscriptionId: ID, fcmToken: 'short' }, 'Invalid fcmToken'],
    ['Web Push malformed JSON', '/api/push/register/web', '{not json', 'Invalid JSON'],
    ['Web Push missing ID', '/api/push/register/web', { subscription: WEB_SUBSCRIPTION }, 'Invalid subscriptionId'],
    ['Web Push validation', '/api/push/register/web', {
      subscriptionId: ID,
      subscription: { ...WEB_SUBSCRIPTION, endpoint: 'http://push.example.test/subscription/123' },
    }, 'Invalid subscription'],
  ];

  for (const [name, route, body, error] of cases) {
    await t.test(name, async (st) => {
      const relay = await startTestRelay(st, { getVapidPublicKey: () => WEB_PUSH_PUBLIC_KEY });
      const response = typeof body === 'string'
        ? await relay.json(route, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          })
        : await relay.post(route, body);
      assert.deepEqual(response, { status: 400, body: { error } });
      assert.deepEqual(await relay.readRecords(), {});
    });
  }
});
