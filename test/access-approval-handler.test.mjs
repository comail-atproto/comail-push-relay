import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverAccessApproval } from '../dist/delivery.js';
import { record, startTestRelay } from './handler-fixtures.mjs';
import { mockWebPush, webPushRecord } from './web-push-fixture.mjs';

const TOKEN = 'a'.repeat(40);

test('access-approval reports mixed outcomes once per ID and updates only successful records', async (t) => {
  const sent = mockWebPush(t, { ACCESS_APPROVAL_DISPATCH_TOKEN: TOKEN });

  const ids = {
    delivered: 'subscription_delivered_1',
    fcm: 'subscription_fcm_1',
    removed: 'subscription_removed_1',
    failed: 'subscription_failed_1',
    missing: 'subscription_missing_1',
  };
  const deliveredRecord = webPushRecord('delivered', 201);
  const fcmRecord = record('fcm', { accountLabel: 'fcm' });
  const removedRecord = webPushRecord('removed', 410);
  const failedRecord = webPushRecord('failed', 503);
  const records = new Map([
    [ids.delivered, deliveredRecord],
    [ids.fcm, fcmRecord],
    [ids.removed, removedRecord],
    [ids.failed, failedRecord],
  ]);
  const relay = await startTestRelay(t, {
    records,
    deliverAccessApproval,
  });

  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
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
    deliveredRecord.webPush, removedRecord.webPush, failedRecord.webPush,
  ]);
  for (const { payload, options } of sent) {
    assert.deepEqual(payload, { kind: 'access-approval' });
    assert.deepEqual(options, { TTL: 120, urgency: 'high', topic: 'comail-access-approval' });
  }
  const stored = await relay.readRecords();
  assert.equal(stored[ids.delivered].lastPushAt, now);
  assert.equal(ids.removed in stored, false);
  for (const id of [ids.fcm, ids.failed]) {
    assert.equal(stored[id].lastPushAt, records.get(id).lastPushAt);
  }
});
