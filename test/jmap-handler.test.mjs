import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverStateChange } from '../dist/delivery.js';
import { pushesForwarded } from '../dist/metrics.js';
import { record, startTestRelay } from './handler-fixtures.mjs';
import { serviceAccount, tokenUri } from './fcm-fixture.mjs';
import { mockWebPush, webPushRecord } from './web-push-fixture.mjs';

const change = {
  '@type': 'StateChange',
  changed: { 'urn:ietf:params:jmap:mail': { Mailbox: 'state-42' } },
  subject: 'private subject',
  body: 'private body',
};

test('JMAP provider failures update persisted state and metrics', async (t) => {
  const sent = mockWebPush(t, {
    FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
  });
  const now = 1_700_000_000_000;
  t.mock.method(Date, 'now', () => now);

  const cases = [
    { name: 'expired', status: 404, metric: 'unregistered', remove: true },
    { name: 'gone', status: 410, metric: 'unregistered', remove: true },
    { name: 'server failure', status: 503, metric: 'http-5xx' },
    { name: 'rate limited', status: 429, metric: 'http-4xx' },
    { name: 'transport failure', status: 0, metric: 'fail' },
    { name: 'FCM unregistered', kind: 'fcm', status: 404, metric: 'unregistered', remove: true },
  ];
  const records = Object.fromEntries(cases.map(({ name, kind = 'web', status }) => {
    const seeded = kind === 'web'
      ? webPushRecord('mail account', status)
      : record(kind, { accountLabel: 'mail account' });
    return [`subscription_${name.replaceAll(' ', '_')}`, seeded];
  }));
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

      const response = await relay.post(`/api/push/jmap/${id}`, change);

      assert.deepEqual(response, { status: 200, body: { ok: false } });
      if (outcome.kind === 'fcm') {
        assert.deepEqual(providerRequests.map(({ url }) => url), [
          tokenUri,
          'https://fcm.googleapis.com/v1/projects/test-project/messages:send',
        ]);
        const message = JSON.parse(providerRequests.at(-1).init.body).message;
        assert.equal(message.token, records[id].fcmToken);
        assert.equal(sent.length, sentBefore, 'FCM dispatch must not call Web Push');
      } else {
        assert.equal(sent.length, sentBefore + 1);
        assert.deepEqual(sent.at(-1), {
          subscription: records[id].webPush,
          payload: {
            kind: 'jmap-state-change',
            accountLabel: 'mail account',
            changed: change.changed,
          },
          options: { TTL: 3600, urgency: 'high' },
        });
        assert.deepEqual(providerRequests, [], 'Web Push dispatch must not call FCM');
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

async function metricCount(result, transport) {
  const { values } = await pushesForwarded.get();
  return values.find((value) => (
    value.labels.result === result && value.labels.transport === transport
  ))?.value ?? 0;
}
