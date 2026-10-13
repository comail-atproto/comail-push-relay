import assert from 'node:assert/strict';
import test from 'node:test';

import { startTestRelay } from './handler-fixtures.mjs';
import { WEB_PUSH_PUBLIC_KEY, WEB_SUBSCRIPTION } from './web-push-fixture.mjs';

const ID = 'subscription_web_123';
const FCM_TOKEN = 'f'.repeat(64);
const FCM_REGISTRATION = { subscriptionId: ID, fcmToken: FCM_TOKEN };
const WEB_REGISTRATION = { subscriptionId: ID, subscription: WEB_SUBSCRIPTION };

function webRegistration(subscriptionChanges) {
  return {
    ...WEB_REGISTRATION,
    subscription: {
      ...WEB_SUBSCRIPTION,
      ...subscriptionChanges,
      keys: { ...WEB_SUBSCRIPTION.keys, ...subscriptionChanges.keys },
    },
  };
}

test('registration rejects invalid input without writing records', async (t) => {
  const transports = [
    {
      name: 'FCM',
      route: '/api/push/register',
      cases: [
        ['missing ID', { fcmToken: FCM_TOKEN }, 'Invalid subscriptionId'],
        ['short ID', { ...FCM_REGISTRATION, subscriptionId: 'short' }, 'Invalid subscriptionId'],
        ['short token', { ...FCM_REGISTRATION, fcmToken: 'too-short' }, 'Invalid fcmToken'],
        ['malformed JSON', '{not json', 'Invalid JSON'],
      ],
    },
    {
      name: 'Web Push',
      route: '/api/push/register/web',
      cases: [
        ['missing ID', { subscription: WEB_SUBSCRIPTION }, 'Invalid subscriptionId'],
        ['non-HTTPS endpoint', webRegistration({ endpoint: 'http://push.example.test/subscription/123' }), 'Invalid subscription'],
        ['short p256dh key', webRegistration({ keys: { p256dh: 'short' } }), 'Invalid subscription'],
        ['short auth key', webRegistration({ keys: { auth: 'short' } }), 'Invalid subscription'],
        ['malformed JSON', '{not json', 'Invalid JSON'],
      ],
    },
  ];

  for (const transport of transports) {
    const relay = await startTestRelay({ getVapidPublicKey: () => WEB_PUSH_PUBLIC_KEY });
    t.after(() => relay.close());
    for (const [name, bodyOrRaw, error] of transport.cases) {
      await t.test(`${transport.name}: ${name}`, async () => {
        const response = typeof bodyOrRaw === 'string'
          ? await relay.json(transport.route, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: bodyOrRaw,
            })
          : await relay.post(transport.route, bodyOrRaw);
        assert.equal(response.status, 400);
        assert.deepEqual(response.body, { error });
        assert.deepEqual(await relay.readRecords(), {});
      });
    }
  }
});
