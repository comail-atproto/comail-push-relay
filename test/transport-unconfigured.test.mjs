// Node isolates this file in a process with no VAPID keys.

import assert from 'node:assert/strict';
import test from 'node:test';
import webpush from 'web-push';
import { record } from './handler-fixtures.mjs';

delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;

test('web push reports unconfigured when VAPID keys are absent', async (t) => {
  const { sendWebPush } = await import('../dist/webpush.js');
  let invoked = false;
  t.mock.method(webpush, 'sendNotification', async () => {
    invoked = true;
    return { statusCode: 201 };
  });
  const result = await sendWebPush(record('web'), { '@type': 'StateChange', changed: {} });

  assert.deepEqual(result, { ok: false, status: 0, unregistered: false });
  assert.equal(invoked, false, 'unconfigured relay must not call web-push');
});
