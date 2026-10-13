import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccessApprovalHandler } from '../dist/access-approval.js';
import { fakeStore, jsonBody, record, request, response } from './handler-fixtures.mjs';

const TOKEN = 'a'.repeat(40);

test('access-approval reports mixed outcomes once per ID and updates only successful records', async (t) => {
  const previousToken = process.env.ACCESS_APPROVAL_DISPATCH_TOKEN;
  process.env.ACCESS_APPROVAL_DISPATCH_TOKEN = TOKEN;
  t.after(() => {
    if (previousToken === undefined) delete process.env.ACCESS_APPROVAL_DISPATCH_TOKEN;
    else process.env.ACCESS_APPROVAL_DISPATCH_TOKEN = previousToken;
  });

  const ids = {
    delivered: 'subscription_delivered_1',
    fcm: 'subscription_fcm_1',
    removed: 'subscription_removed_1',
    failed: 'subscription_failed_1',
    missing: 'subscription_missing_1',
  };
  const records = new Map([
    [ids.delivered, record('web')],
    [ids.fcm, record('fcm')],
    [ids.removed, record('web')],
    [ids.failed, record('web')],
  ]);
  const store = fakeStore(records);
  const delivered = [];
  let refreshes = 0;
  const handler = createAccessApprovalHandler({
    store,
    async deliver(webRecord) {
      delivered.push(webRecord);
      if (webRecord === records.get(ids.removed)) {
        return { ok: false, status: 410, unregistered: true };
      }
      if (webRecord === records.get(ids.failed)) {
        return { ok: false, status: 503, unregistered: false };
      }
      return { ok: true, status: 201, unregistered: false };
    },
    async refreshActiveGauge() { refreshes++; },
  });
  const res = response();
  const originalTimestamps = new Map([...records].map(([id, value]) => [id, value.lastPushAt]));

  await handler(request({
    kind: 'access-approval',
    subscriptionIds: [
      ids.delivered,
      ids.delivered,
      ids.missing,
      ids.fcm,
      ids.removed,
      ids.failed,
      ids.failed,
    ],
  }, { headers: { authorization: `Bearer ${TOKEN}` } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(jsonBody(res), {
    ok: false,
    delivered: 1,
    missing: 2,
    removed: 1,
    failed: 1,
  });
  assert.deepEqual(store.calls.gets, [
    ids.delivered, ids.missing, ids.fcm, ids.removed, ids.failed,
  ]);
  assert.deepEqual(delivered, [
    records.get(ids.delivered), records.get(ids.removed), records.get(ids.failed),
  ]);
  assert.deepEqual(store.calls.puts.map(({ id: putId }) => putId), [ids.delivered]);
  assert.ok(records.get(ids.delivered).lastPushAt > 0);
  for (const id of [ids.fcm, ids.removed, ids.failed]) {
    assert.equal(records.get(id).lastPushAt, originalTimestamps.get(id));
  }
  assert.deepEqual(store.calls.deletes, [ids.removed]);
  assert.equal(refreshes, 1);
});
