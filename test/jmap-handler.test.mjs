import assert from 'node:assert/strict';
import test from 'node:test';
import webpush from 'web-push';

import { deliverStateChange } from '../dist/delivery.js';
import { pushesForwarded } from '../dist/metrics.js';
import { record, startTestRelay } from './handler-fixtures.mjs';
import { serviceAccount, tokenUri } from './fcm-fixture.mjs';
import { WEB_PUSH_ENV } from './web-push-fixture.mjs';

const change = {
  '@type': 'StateChange',
  changed: { 'urn:ietf:params:jmap:mail': { Mailbox: 'state-42' } },
  subject: 'private subject',
  body: 'private body',
};

test('app fixtures use independent store directories', async (t) => {
  const first = await startTestRelay(t);
  const second = await startTestRelay(t);

  assert.deepEqual(await first.post('/api/push/register', {
    subscriptionId: 'subscription_first_1',
    fcmToken: 'f'.repeat(64),
  }), { status: 200, body: { ok: true } });
  assert.equal((await first.json('/api/health')).body.subscriptions, 1);
  assert.equal((await second.json('/api/health')).body.subscriptions, 0);
  assert.deepEqual(Object.keys(await first.readRecords()), ['subscription_first_1']);
  assert.deepEqual(await second.readRecords(), {});
});

test('JMAP provider outcomes update persisted state and metrics', async (t) => {
  const previousEnv = Object.fromEntries(Object.keys(WEB_PUSH_ENV).map((name) => [name, process.env[name]]));
  previousEnv.FCM_SERVICE_ACCOUNT_JSON = process.env.FCM_SERVICE_ACCOUNT_JSON;
  Object.assign(process.env, {
    ...WEB_PUSH_ENV,
    FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
  });
  t.after(() => restoreEnv(previousEnv));
  const now = 1_700_000_000_000;
  t.mock.method(Date, 'now', () => now);

  const cases = [
    { name: 'delivered', status: 201, metric: 'ok', ok: true },
    { name: 'expired', status: 404, metric: 'unregistered', remove: true },
    { name: 'gone', status: 410, metric: 'unregistered', remove: true },
    { name: 'server failure', status: 503, metric: 'http-5xx' },
    { name: 'rate limited', status: 429, metric: 'http-4xx' },
    { name: 'transport failure', status: 0, metric: 'fail' },
    { name: 'FCM unregistered', kind: 'fcm', status: 404, metric: 'unregistered', remove: true },
  ];
  const records = Object.fromEntries(cases.map(({ name, kind = 'web', status }) => {
    const seeded = record(kind, { accountLabel: 'mail account' });
    if (kind === 'web') seeded.webPush.endpoint += `/${status || 'no-status'}`;
    return [`subscription_${name.replaceAll(' ', '_')}`, seeded];
  }));
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (subscription, payload, options) => {
    sent.push({ subscription, payload: JSON.parse(payload), options });
    const status = Number(subscription.endpoint.split('/').at(-1));
    if (status === 201) return { statusCode: status };
    throw Object.assign(new Error(`push service ${status || 'unavailable'}`), {
      ...(status ? { statusCode: status } : {}),
    });
  });
  const providerRequests = [];
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1:')) return realFetch(url, init);
    providerRequests.push({ url: String(url), init });
    return String(url) === tokenUri
      ? Response.json({ access_token: 'fcm-test-token', expires_in: 3600 })
      : new Response('gone', { status: 404 });
  });
  const relay = await startTestRelay(t, { records, deliverStateChange });

  for (const outcome of cases) {
    await t.test(outcome.name, async () => {
      const id = `subscription_${outcome.name.replaceAll(' ', '_')}`;
      const transport = outcome.kind ?? 'web';
      const before = await metricCount(outcome.metric, transport);
      const sentBefore = sent.length;
      const requestsBefore = providerRequests.length;

      const response = await relay.post(`/api/push/jmap/${id}`, change);

      assert.deepEqual(response, { status: 200, body: { ok: outcome.ok ?? false } });
      if (outcome.kind === 'fcm') {
        assert.deepEqual(providerRequests.slice(requestsBefore).map(({ url }) => url), [
          tokenUri,
          'https://fcm.googleapis.com/v1/projects/test-project/messages:send',
        ]);
        const message = JSON.parse(providerRequests.at(-1).init.body).message;
        assert.equal(message.token, records[id].fcmToken);
        assert.equal(sent.length, sentBefore, 'FCM dispatch must not call Web Push');
      } else {
        assert.deepEqual(sent.slice(sentBefore), [{
          subscription: records[id].webPush,
          payload: {
            kind: 'jmap-state-change',
            accountLabel: 'mail account',
            changed: change.changed,
          },
          options: { TTL: 3600, urgency: 'high' },
        }]);
        assert.equal(providerRequests.length, requestsBefore, 'Web Push dispatch must not call FCM');
      }
      assert.equal(await metricCount(outcome.metric, transport), before + 1);
      const stored = await relay.readRecords();
      if (outcome.remove) {
        assert.equal(id in stored, false);
      } else {
        assert.equal(stored[id].lastPushAt, now);
      }
    });
  }
});

test('JMAP delivery exceptions return 500 without persisting state', async (t) => {
  const id = 'subscription_throw_1';
  const relay = await startTestRelay(t, {
    records: { [id]: record('fcm') },
    async deliverStateChange() { throw new Error('injected delivery failure'); },
  });

  assert.deepEqual(await relay.post(`/api/push/jmap/${id}`, change), {
    status: 500,
    body: { error: 'Internal server error' },
  });
  assert.equal((await relay.readRecords())[id].lastPushAt, null);
});

async function metricCount(result, transport) {
  const { values } = await pushesForwarded.get();
  return values.find((value) => (
    value.labels.result === result && value.labels.transport === transport
  ))?.value ?? 0;
}

function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
