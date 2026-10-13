import assert from 'node:assert/strict';
import test from 'node:test';

import { startTestRelay } from './handler-fixtures.mjs';
import { WEB_PUSH_PUBLIC_KEY, WEB_SUBSCRIPTION } from './web-push-fixture.mjs';

const ID = 'subscription_web_123';
const FCM_TOKEN = 'f'.repeat(64);
const MAX_ID = 's'.repeat(128);
const MIN_ID = 'a'.repeat(8);
const MAX_FCM_TOKEN = 'f'.repeat(4096);
const ENDPOINT_PREFIX = 'https://push.example.test/';
const MAX_ENDPOINT = `${ENDPOINT_PREFIX}${'e'.repeat(2048 - ENDPOINT_PREFIX.length)}`;
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

test('registration accepts exact maximum lengths and minimum Web Push fields', async (t) => {
  const relay = await startTestRelay({ getVapidPublicKey: () => WEB_PUSH_PUBLIC_KEY });
  t.after(() => relay.close());

  const cases = [
    {
      name: 'FCM maximum ID and token',
      route: '/api/push/register',
      body: { subscriptionId: MAX_ID, fcmToken: MAX_FCM_TOKEN },
    },
    {
      name: 'Web Push maximum endpoint and keys',
      route: '/api/push/register/web',
      body: {
        ...webRegistration({
          endpoint: MAX_ENDPOINT,
          keys: { p256dh: 'p'.repeat(256), auth: 'a'.repeat(64) },
        }),
        subscriptionId: MAX_ID,
      },
    },
    {
      name: 'Web Push minimum ID and keys',
      route: '/api/push/register/web',
      body: { ...WEB_REGISTRATION, subscriptionId: MIN_ID },
    },
  ];

  for (const { name, route, body } of cases) {
    await t.test(name, async () => {
      assert.deepEqual(await relay.post(route, body), { status: 200, body: { ok: true } });
      const saved = (await relay.readRecords())[body.subscriptionId];
      const webPush = route === '/api/push/register/web';
      assert.equal(saved.kind, webPush ? 'web' : 'fcm');
      if (webPush) assert.deepEqual(saved.webPush, body.subscription);
      else assert.equal(saved.fcmToken, body.fcmToken);
    });
  }
});

test('registration rejects invalid input without writing records', async (t) => {
  const transports = [
    {
      name: 'FCM',
      route: '/api/push/register',
      cases: [
        ['missing ID', { fcmToken: FCM_TOKEN }, 'Invalid subscriptionId'],
        ['short ID', { ...FCM_REGISTRATION, subscriptionId: 'short' }, 'Invalid subscriptionId'],
        ['ID above maximum', { ...FCM_REGISTRATION, subscriptionId: `${MAX_ID}s` }, 'Invalid subscriptionId'],
        ['short token', { ...FCM_REGISTRATION, fcmToken: 'too-short' }, 'Invalid fcmToken'],
        ['token above maximum', { ...FCM_REGISTRATION, fcmToken: `${MAX_FCM_TOKEN}f` }, 'Invalid fcmToken'],
        ['token with invalid character', { ...FCM_REGISTRATION, fcmToken: `${FCM_TOKEN.slice(0, -1)}!` }, 'Invalid fcmToken'],
        ['malformed JSON', '{not json', 'Invalid JSON'],
      ],
    },
    {
      name: 'Web Push',
      route: '/api/push/register/web',
      cases: [
        ['missing ID', { subscription: WEB_SUBSCRIPTION }, 'Invalid subscriptionId'],
        ['non-HTTPS endpoint', webRegistration({ endpoint: 'http://push.example.test/subscription/123' }), 'Invalid subscription'],
        ['endpoint above maximum', webRegistration({ endpoint: `${MAX_ENDPOINT}e` }), 'Invalid subscription'],
        ['short p256dh key', webRegistration({ keys: { p256dh: 'short' } }), 'Invalid subscription'],
        ['p256dh key above maximum', webRegistration({ keys: { p256dh: 'p'.repeat(257) } }), 'Invalid subscription'],
        ['short auth key', webRegistration({ keys: { auth: 'short' } }), 'Invalid subscription'],
        ['auth key above maximum', webRegistration({ keys: { auth: 'a'.repeat(65) } }), 'Invalid subscription'],
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
