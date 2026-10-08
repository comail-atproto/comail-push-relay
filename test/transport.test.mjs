// Unit matrix for the Web Push transport boundary. In-process against the
// compiled webpush module with a recording transport: no relay process, no
// live credentials, no global module mock.

import assert from 'node:assert/strict';
import test from 'node:test';
import webpush from 'web-push';

// VAPID config is read once per module instance, so this file configures it
// here and the absent-key case lives in its own module instance.
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

// recordingTransport records the payload and either resolves a status code or
// throws a web-push style error carrying an HTTP statusCode.
function recordingTransport(outcome) {
  const sent = [];
  return {
    sent,
    async send(subscription, payload, options) {
      sent.push({ subscription, payload: JSON.parse(payload), options });
      if (outcome instanceof Error) throw outcome;
      return { statusCode: outcome };
    },
  };
}

function webRecord(overrides = {}) {
  return {
    kind: 'web',
    webPush: {
      endpoint: 'https://push.example.com/message',
      keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(16) },
    },
    verificationCode: null,
    createdAt: Date.now(),
    lastPushAt: null,
    accountLabel: 'account',
    ...overrides,
  };
}

test('web push transport result matrix', async (t) => {
  const { sendWebPush } = await import('../dist/webpush.js');
  const change = {
    '@type': 'StateChange',
    changed: { 'urn:ietf:params:jmap:mail': { Mailbox: '42' } },
  };

  const gone = (status) => Object.assign(new Error(`push service ${status}`), { statusCode: status });
  const cases = [
    { name: 'delivered', outcome: 201, want: { ok: true, status: 201, unregistered: false } },
    { name: 'expired 404', outcome: gone(404), want: { ok: false, status: 404, unregistered: true } },
    { name: 'gone 410', outcome: gone(410), want: { ok: false, status: 410, unregistered: true } },
    { name: 'transient 500', outcome: gone(500), want: { ok: false, status: 500, unregistered: false } },
    {
      name: 'thrown without status',
      outcome: new Error('socket hang up'),
      want: { ok: false, status: 0, unregistered: false },
    },
    {
      name: 'thrown with 429 status',
      outcome: Object.assign(new Error('too many requests'), { statusCode: 429 }),
      want: { ok: false, status: 429, unregistered: false },
    },
  ];

  for (const c of cases) {
    await t.test(c.name, async () => {
      const transport = recordingTransport(c.outcome);
      const result = await sendWebPush(webRecord(), change, transport);
      assert.deepEqual(result, c.want);
      assert.equal(transport.sent.length, 1, 'transport should be invoked exactly once');
    });
  }
});

test('web push StateChange payload carries opaque state references only', async () => {
  const { sendWebPush } = await import('../dist/webpush.js');
  const transport = recordingTransport(201);
  const result = await sendWebPush(webRecord(), {
    '@type': 'StateChange',
    changed: { 'urn:ietf:params:jmap:mail': { Mailbox: '42' } },
    // Fields the relay must never forward, even if a producer adds them.
    subject: 'private subject',
    body: 'private body',
  }, transport);

  assert.deepEqual(result, { ok: true, status: 201, unregistered: false });
  assert.deepEqual(transport.sent[0].payload, {
    kind: 'jmap-state-change',
    accountLabel: 'account',
    changed: { 'urn:ietf:params:jmap:mail': { Mailbox: '42' } },
  });
  assert.equal('subject' in transport.sent[0].payload, false);
  assert.equal('body' in transport.sent[0].payload, false);
});
