import assert from 'node:assert/strict';
import test from 'node:test';

import { startRelay } from './lifecycle.mjs';
import { WEB_PUSH_ENV, WEB_SUBSCRIPTION } from './web-push-fixture.mjs';

const ID = 'subscription_web_123';
const FCM_TOKEN = 'f'.repeat(64);

test('registration rejects invalid input without storing records', async (t) => {
  const transports = [
    {
      name: 'FCM',
      route: '/api/push/register',
      env: {},
      cases: [
        ['missing ID', { fcmToken: FCM_TOKEN }, 'Invalid subscriptionId'],
        ['short ID', { subscriptionId: 'short', fcmToken: FCM_TOKEN }, 'Invalid subscriptionId'],
        ['short token', { subscriptionId: ID, fcmToken: 'too-short' }, 'Invalid fcmToken'],
        ['malformed JSON', '{not json', 'Invalid JSON'],
      ],
    },
    {
      name: 'Web Push',
      route: '/api/push/register/web',
      env: WEB_PUSH_ENV,
      cases: [
        ['missing ID', { subscription: WEB_SUBSCRIPTION }, 'Invalid subscriptionId'],
        [
          'non-HTTPS endpoint',
          {
            subscriptionId: ID,
            subscription: {
              ...WEB_SUBSCRIPTION,
              endpoint: 'http://push.example.test/subscription/123',
            },
          },
          'Invalid subscription',
        ],
        [
          'short p256dh key',
          {
            subscriptionId: ID,
            subscription: {
              ...WEB_SUBSCRIPTION,
              keys: { ...WEB_SUBSCRIPTION.keys, p256dh: 'short' },
            },
          },
          'Invalid subscription',
        ],
        [
          'short auth key',
          {
            subscriptionId: ID,
            subscription: {
              ...WEB_SUBSCRIPTION,
              keys: { ...WEB_SUBSCRIPTION.keys, auth: 'short' },
            },
          },
          'Invalid subscription',
        ],
        ['malformed JSON', '{not json', 'Invalid JSON'],
      ],
    },
  ];

  for (const transport of transports) {
    for (const [name, bodyOrRaw, error] of transport.cases) {
      await t.test(`${transport.name}: ${name}`, async (st) => {
        const relay = await startRelay({ env: transport.env });
        st.after(() => relay.stop());
        const response = typeof bodyOrRaw === 'string'
          ? await relay.json(transport.route, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: bodyOrRaw,
            })
          : await relay.post(transport.route, bodyOrRaw);
        assert.equal(response.status, 400);
        assert.deepEqual(response.body, { error });
        assert.equal((await relay.json('/api/health')).body.subscriptions, 0);
      });
    }
  }
});
