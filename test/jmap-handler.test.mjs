import assert from 'node:assert/strict';
import test from 'node:test';

import { createJmapHandler } from '../dist/jmap.js';
import { createRequestHandler } from '../dist/router.js';
import { fakeStore, jsonBody, record, request, response } from './handler-fixtures.mjs';

const STATE_CHANGE = {
  '@type': 'StateChange',
  changed: { 'urn:ietf:params:jmap:mail': { Mailbox: 'state-42' } },
};

test('JMAP records successful and transiently failed push attempts', async (t) => {
  const cases = [
    { name: 'delivered', result: { ok: true, status: 201, unregistered: false }, wantOk: true },
    { name: 'transient failure', result: { ok: false, status: 503, unregistered: false }, wantOk: false },
  ];
  for (const c of cases) {
    await t.test(c.name, async () => {
      const id = 'subscription_state_1';
      const saved = record('web');
      const store = fakeStore(new Map([[id, saved]]));
      let refreshes = 0;
      const handler = createJmapHandler({
        store,
        async deliverStateChange(gotRecord, change) {
          assert.equal(gotRecord, saved);
          assert.deepEqual(change, STATE_CHANGE);
          return c.result;
        },
        async refreshActiveGauge() { refreshes++; },
      });
      const res = response();

      await handler(request(STATE_CHANGE), id, res);

      assert.equal(res.statusCode, 200);
      assert.deepEqual(jsonBody(res), { ok: c.wantOk });
      assert.ok(saved.lastPushAt > 0);
      assert.equal(store.calls.puts.length, 1);
      assert.ok(store.calls.puts[0].record.lastPushAt > 0);
      assert.deepEqual(store.calls.deletes, []);
      assert.equal(refreshes, 0);
    });
  }
});

test('JMAP removes permanently unregistered FCM and Web Push subscriptions', async (t) => {
  for (const kind of ['fcm', 'web']) {
    await t.test(kind, async () => {
      const id = `subscription_${kind}_1`;
      const saved = record(kind);
      const store = fakeStore(new Map([[id, saved]]));
      let refreshes = 0;
      const handler = createJmapHandler({
        store,
        async deliverStateChange() {
          return { ok: false, status: kind === 'fcm' ? 404 : 410, unregistered: true };
        },
        async refreshActiveGauge() { refreshes++; },
      });
      const res = response();

      await handler(request(STATE_CHANGE), id, res);

      assert.equal(res.statusCode, 200);
      assert.deepEqual(jsonBody(res), { ok: false });
      assert.ok(saved.lastPushAt > 0);
      assert.ok(store.calls.puts[0].record.lastPushAt > 0);
      assert.deepEqual(store.calls.deletes, [id]);
      assert.equal(refreshes, 1);
    });
  }
});

test('JMAP delivery exceptions reach the router 500 response', async () => {
  const id = 'subscription_throw_1';
  const store = fakeStore(new Map([[id, record('fcm')]]));
  const handleJmap = createJmapHandler({
    store,
    async deliverStateChange() { throw new Error('injected delivery failure'); },
    async refreshActiveGauge() {},
  });
  const router = createRequestHandler({
    store: { ...store, async size() { return 1; } },
    subscriptions: {
      async register() {},
      async registerWeb() {},
      async unregister() {},
      async verificationCode() {},
      async active() {},
      async refreshActiveGauge() {},
    },
    handleJmap,
    async handleAccessApproval() {},
    getVapidPublicKey() { return null; },
  });
  const res = response();

  await router(request(STATE_CHANGE, {
    method: 'POST',
    url: `/api/push/jmap/${id}`,
  }), res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(jsonBody(res), { error: 'Internal server error' });
});
