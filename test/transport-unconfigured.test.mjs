// The relay reads VAPID config once per module instance, so the absent-key case
// needs its own process with no keys set. The Node test runner isolates files,
// giving this module a fresh configuration state.

import assert from 'node:assert/strict';
import test from 'node:test';
import webpush from 'web-push';

delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;

test('web push reports unconfigured when VAPID keys are absent', async (t) => {
  const { sendAccessApprovalPush } = await import('../dist/webpush.js');
  const send = t.mock.method(webpush, 'sendNotification', async () => ({ statusCode: 201 }));
  const result = await sendAccessApprovalPush({
    kind: 'web',
    webPush: {
      endpoint: 'https://push.example.com/message',
      keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(16) },
    },
    verificationCode: null,
    createdAt: Date.now(),
    lastPushAt: null,
  });

  assert.deepEqual(result, { ok: false, status: 0, unregistered: false });
  assert.equal(send.mock.callCount(), 0, 'unconfigured relay must not call the transport');
});
