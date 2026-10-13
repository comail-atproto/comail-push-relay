import assert from 'node:assert/strict';
import test from 'node:test';
import webpush from 'web-push';

import { deliverAccessApproval } from '../dist/delivery.js';
import { record, startTestRelay } from './handler-fixtures.mjs';
import { WEB_PUSH_ENV } from './web-push-fixture.mjs';

const TOKEN = 'a'.repeat(40);

function webPushRecord(accountLabel, status) {
  const subscription = record('web', { accountLabel });
  subscription.webPush.endpoint += `/${status}`;
  return subscription;
}

test('access-approval reports mixed outcomes once per ID and updates only successful records', async (t) => {
  const env = { ACCESS_APPROVAL_DISPATCH_TOKEN: TOKEN, ...WEB_PUSH_ENV };
  const previousEnv = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

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
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (subscription, payload, options) => {
    sent.push({ subscription: structuredClone(subscription), payload, options });
    if (subscription.endpoint.endsWith('/410')) {
      throw Object.assign(new Error('gone'), { statusCode: 410 });
    }
    if (subscription.endpoint.endsWith('/503')) {
      throw Object.assign(new Error('unavailable'), { statusCode: 503 });
    }
    return { statusCode: 201 };
  });
  const relay = await startTestRelay({
    records,
    deliverAccessApproval,
  });
  t.after(() => relay.close());

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
    assert.deepEqual(JSON.parse(payload), { kind: 'access-approval' });
    assert.deepEqual(options, { TTL: 120, urgency: 'high', topic: 'comail-access-approval' });
  }
  const stored = await relay.readRecords();
  assert.equal(stored[ids.delivered].lastPushAt, now);
  assert.equal(ids.removed in stored, false);
  for (const id of [ids.fcm, ids.failed]) {
    assert.equal(stored[id].lastPushAt, records.get(id).lastPushAt);
  }
});
