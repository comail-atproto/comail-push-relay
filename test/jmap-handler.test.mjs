import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverStateChange } from '../dist/delivery.js';
import { createJmapHandler } from '../dist/jmap.js';
import { pushesForwarded } from '../dist/metrics.js';
import { jsonBody, memoryStore, record, request, response } from './handler-fixtures.mjs';

const CHANGE = {
  '@type': 'StateChange',
  changed: { 'urn:ietf:params:jmap:mail': { Mailbox: 'state-42' } },
};

const outcomes = [
  { name: 'delivered', kind: 'web', result: { ok: true, status: 201, unregistered: false }, metric: 'ok' },
  { name: 'transient server failure', kind: 'web', result: { ok: false, status: 503, unregistered: false }, metric: 'http-5xx' },
  { name: 'transient client failure', kind: 'web', result: { ok: false, status: 429, unregistered: false }, metric: 'http-4xx' },
  { name: 'transport failure', kind: 'web', result: { ok: false, status: 0, unregistered: false }, metric: 'fail' },
  { name: 'unregistered FCM', kind: 'fcm', result: { ok: false, status: 404, unregistered: true }, metric: 'unregistered' },
  { name: 'unregistered Web Push', kind: 'web', result: { ok: false, status: 410, unregistered: true }, metric: 'unregistered' },
];

test('JMAP persists delivery outcomes and removes expired transports', async (t) => {
  for (const outcome of outcomes) {
    await t.test(outcome.name, async () => {
      const id = `subscription_${outcome.name.replaceAll(' ', '_')}`;
      const seeded = record(outcome.kind);
      const store = memoryStore(new Map([[id, seeded]]));
      const before = await metricCount(outcome.metric, outcome.kind);
      let refreshes = 0;
      const transports = {
        async sendFcm(gotRecord, change) {
          assert.equal(outcome.kind, 'fcm');
          assert.deepEqual(gotRecord, seeded);
          assert.deepEqual(change, CHANGE);
          return outcome.result;
        },
        async sendWeb(gotRecord, change) {
          assert.equal(outcome.kind, 'web');
          assert.deepEqual(gotRecord, seeded);
          assert.deepEqual(change, CHANGE);
          return outcome.result;
        },
      };
      const handler = createJmapHandler({
        store,
        async deliverStateChange(gotRecord, change) {
          return deliverStateChange(gotRecord, change, transports);
        },
        async refreshActiveGauge() { refreshes += 1; },
      });
      const res = response();

      const started = Date.now();
      await handler(request(CHANGE), id, res);
      const finished = Date.now();

      assert.equal(res.statusCode, 200);
      assert.deepEqual(jsonBody(res), { ok: outcome.result.ok });
      assert.equal(await metricCount(outcome.metric, outcome.kind), before + 1);
      assert.equal(refreshes, Number(outcome.result.unregistered));
      if (outcome.result.unregistered) {
        assert.equal(store.records.has(id), false);
      } else {
        const { lastPushAt } = store.records.get(id);
        assert.ok(lastPushAt >= started && lastPushAt <= finished);
      }
    });
  }
});

test('JMAP delivery exceptions leave the subscription unchanged', async () => {
  const id = 'subscription_throw_1';
  const saved = record('fcm');
  const store = memoryStore(new Map([[id, saved]]));
  const handler = createJmapHandler({
    store,
    async deliverStateChange() { throw new Error('injected delivery failure'); },
    async refreshActiveGauge() {},
  });

  await assert.rejects(handler(request(CHANGE), id, response()), /injected delivery failure/);

  assert.equal(store.records.get(id).lastPushAt, null);
});

async function metricCount(result, transport) {
  const { values } = await pushesForwarded.get();
  return values.find((value) => (
    value.labels.result === result && value.labels.transport === transport
  ))?.value ?? 0;
}
