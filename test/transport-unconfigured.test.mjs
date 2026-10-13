// Node isolates this file in a process with no VAPID keys.

import assert from 'node:assert/strict';
import test from 'node:test';

delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;

test('web push reports unconfigured when VAPID keys are absent', async () => {
  const { sendWebPush } = await import('../dist/webpush.js');
  let invoked = false;
  const transport = {
    async send() {
      invoked = true;
      return { statusCode: 201 };
    },
  };
  const result = await sendWebPush({
    kind: 'web',
    webPush: {
      endpoint: 'https://push.example.com/message',
      keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(16) },
    },
    verificationCode: null,
    createdAt: Date.now(),
    lastPushAt: null,
  }, { '@type': 'StateChange', changed: {} }, transport);

  assert.deepEqual(result, { ok: false, status: 0, unregistered: false });
  assert.equal(invoked, false, 'unconfigured relay must not call the transport');
});
