import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverStateChange } from '../dist/delivery.js';
import { pushesForwarded } from '../dist/metrics.js';
import { record, startTestRelay } from './handler-fixtures.mjs';

const change = {
  '@type': 'StateChange',
  changed: { 'urn:ietf:params:jmap:mail': { Mailbox: 'state-42' } },
};
const outcomes = [
  ['delivered', 'web', { ok: true, status: 201, unregistered: false }, 'ok'],
  ['server failure', 'web', { ok: false, status: 503, unregistered: false }, 'http-5xx'],
  ['client failure', 'web', { ok: false, status: 429, unregistered: false }, 'http-4xx'],
  ['transport failure', 'web', { ok: false, status: 0, unregistered: false }, 'fail'],
  ['unregistered FCM', 'fcm', { ok: false, status: 404, unregistered: true }, 'unregistered'],
  ['unregistered Web Push', 'web', { ok: false, status: 410, unregistered: true }, 'unregistered'],
];

test('app fixtures use independent store directories', async (t) => {
  const first = await startTestRelay();
  const second = await startTestRelay();
  t.after(() => first.close());
  t.after(() => second.close());

  assert.deepEqual(await first.post('/api/push/register', {
    subscriptionId: 'subscription_first_1',
    fcmToken: 'f'.repeat(64),
  }), { status: 200, body: { ok: true } });
  assert.equal((await first.json('/api/health')).body.subscriptions, 1);
  assert.equal((await second.json('/api/health')).body.subscriptions, 0);
  assert.deepEqual(Object.keys(await first.readRecords()), ['subscription_first_1']);
  assert.deepEqual(await second.readRecords(), {});
});

test('JMAP dispatch persists delivery outcomes and removes expired transports', async (t) => {
  for (const [name, kind, result, metric] of outcomes) {
    await t.test(name, async (st) => {
      const id = `subscription_${name.replaceAll(' ', '_')}`;
      const seeded = record(kind);
      const sent = [];
      const relay = await startTestRelay({
        records: { [id]: seeded },
        async deliverStateChange(subscription, body) {
          const send = (transport, record, change) => {
            sent.push({ transport, record: structuredClone(record), change });
            return result;
          };
          return deliverStateChange(subscription, body, {
            sendFcm: (record, change) => send('fcm', record, change),
            sendWeb: (record, change) => send('web', record, change),
          });
        },
      });
      st.after(() => relay.close());

      const before = await metricCount(metric, kind);
      const started = Date.now();
      const response = await relay.post(`/api/push/jmap/${id}`, change);
      const finished = Date.now();

      assert.deepEqual(response, { status: 200, body: { ok: result.ok } });
      assert.deepEqual(sent, [{ transport: kind, record: seeded, change }]);
      assert.equal(await metricCount(metric, kind), before + 1);
      const stored = await relay.readRecords();
      if (result.unregistered) {
        assert.equal(id in stored, false);
      } else {
        const { lastPushAt } = stored[id];
        assert.ok(lastPushAt >= started && lastPushAt <= finished);
      }
    });
  }
});

test('JMAP delivery exceptions return 500 without persisting state', async (t) => {
  const id = 'subscription_throw_1';
  const relay = await startTestRelay({
    records: { [id]: record('fcm') },
    async deliverStateChange() { throw new Error('injected delivery failure'); },
  });
  t.after(() => relay.close());

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
