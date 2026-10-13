import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverAccessApproval } from '../dist/delivery.js';
import { record, startTestRelay } from './handler-fixtures.mjs';

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
  const deliveredRecord = record('web', { accountLabel: 'delivered' });
  const fcmRecord = record('fcm', { accountLabel: 'fcm' });
  const removedRecord = record('web', { accountLabel: 'removed' });
  const failedRecord = record('web', { accountLabel: 'failed' });
  const records = new Map([
    [ids.delivered, deliveredRecord],
    [ids.fcm, fcmRecord],
    [ids.removed, removedRecord],
    [ids.failed, failedRecord],
  ]);
  const sent = [];
  const relay = await startTestRelay({
    records,
    async deliverAccessApproval(webRecord) {
      return deliverAccessApproval(webRecord, {
        async send(subscription, payload, options) {
          sent.push({ subscription: structuredClone(subscription), payload, options });
          if (subscription.accountLabel === 'removed') return { ok: false, status: 410, unregistered: true };
          if (subscription.accountLabel === 'failed') return { ok: false, status: 503, unregistered: false };
          return { ok: true, status: 201, unregistered: false };
        },
      });
    },
  });
  t.after(() => relay.close());

  const started = Date.now();
  const response = await relay.post('/api/push/internal/access-approval', {
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
  }, `Bearer ${TOKEN}`);
  const finished = Date.now();

  assert.deepEqual(response, {
    status: 200,
    body: {
      ok: false,
      delivered: 1,
      missing: 2,
      removed: 1,
      failed: 1,
    },
  });
  assert.deepEqual(sent.map(({ subscription }) => subscription), [
    deliveredRecord, removedRecord, failedRecord,
  ]);
  for (const { payload, options } of sent) {
    assert.deepEqual({ payload, options }, {
      payload: { kind: 'access-approval' },
      options: { ttl: 120, topic: 'comail-access-approval' },
    });
  }
  const stored = await relay.readRecords();
  const { lastPushAt } = stored[ids.delivered];
  assert.ok(lastPushAt >= started && lastPushAt <= finished);
  assert.equal(ids.removed in stored, false);
  for (const id of [ids.fcm, ids.failed]) {
    assert.equal(stored[id].lastPushAt, records.get(id).lastPushAt);
  }
});
