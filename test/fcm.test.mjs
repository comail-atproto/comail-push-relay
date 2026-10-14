import assert from 'node:assert/strict';
import { verify } from 'node:crypto';
import test from 'node:test';
import { serviceAccount, signingKey, tokenUri } from './fcm-fixture.mjs';
import { record } from './handler-fixtures.mjs';

const { publicKey } = signingKey;
const fcmRecord = record('fcm', { accountLabel: 'mail account' });
const change = {
  '@type': 'StateChange',
  changed: { 'urn:ietf:params:jmap:mail': { Mailbox: 'state-42' } },
  subject: 'private subject', body: 'private body',
};
let moduleInstance = 0;

test('FCM sends an authenticated opaque payload and reuses its OAuth token', async (t) => {
  const mintedAt = 1_700_000_000_000;
  let now = mintedAt;
  t.mock.method(Date, 'now', () => now);
  const refreshAt = mintedAt + 3_540_000;
  const requests = [];
  const sendFcmPush = await fcm(t, async (url, init) => {
    requests.push({ url, init });
    if (url === tokenUri) {
      const count = requests.filter((request) => request.url === tokenUri).length;
      return json({ access_token: `cached-token-${count}`, expires_in: 3600 });
    }
    return json({ name: 'projects/test-project/messages/1' });
  });

  const first = await sendFcmPush(fcmRecord, change);
  now = refreshAt - 1;
  const reused = await sendFcmPush(fcmRecord, change);
  now = refreshAt;
  const refreshed = await sendFcmPush(fcmRecord, change);

  assert.deepEqual(first, { ok: true, status: 200, unregistered: false, body: { name: 'projects/test-project/messages/1' } });
  assert.deepEqual(reused, first);
  assert.deepEqual(refreshed, first);
  assert.equal(requests.length, 5);
  assertOAuthRequest(requests[0], mintedAt / 1000);
  assertOAuthRequest(requests[3], refreshAt / 1000);
  const pushRequests = requests.filter(({ url }) => url !== tokenUri);
  assert.equal(pushRequests.length, 3);
  for (const [index, { url, init }] of pushRequests.entries()) {
    assert.equal(url, 'https://fcm.googleapis.com/v1/projects/test-project/messages:send');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['content-type'], 'application/json');
    assert.equal(init.headers.authorization, `Bearer cached-token-${index < 2 ? 1 : 2}`);
    assert.deepEqual(JSON.parse(init.body), {
      message: {
        token: fcmRecord.fcmToken,
        android: { priority: 'HIGH' },
        data: {
          kind: 'jmap-state-change',
          accountLabel: 'mail account',
          changed: JSON.stringify(change.changed),
        },
      },
    });
  }
});

test('FCM classifies removal and transient failures', async (t) => {
  const cases = [
    ['plain 404', 404, 'gone', true],
    ['provider UNREGISTERED', 400, { error: { status: 'UNREGISTERED' } }, true],
    ['provider NOT_FOUND', 400, { error: { status: 'NOT_FOUND' } }, true],
    ['raw transient failure', 503, 'upstream unavailable', false],
  ];
  for (const [name, status, body, unregistered] of cases) {
    await t.test(name, async (st) => {
      const sendFcmPush = await fcm(st, async (url) => (
        url === tokenUri
          ? json({ access_token: 'token', expires_in: 3600 })
          : typeof body === 'string' ? new Response(body, { status }) : json(body, status)
      ));
      assert.deepEqual(await sendFcmPush(fcmRecord, change), {
        ok: false, status, unregistered, body,
      });
    });
  }
});

test('FCM stops when OAuth rejects the service account', async (t) => {
  let sentPush = false;
  const sendFcmPush = await fcm(t, async (url) => {
    if (url === tokenUri) return new Response('invalid grant', { status: 401 });
    sentPush = true;
    return json({});
  });

  await assert.rejects(sendFcmPush(fcmRecord, change), /FCM oauth2 token failed: 401 invalid grant/);
  assert.equal(sentPush, false);
});

async function fcm(t, fetch) {
  const previous = process.env.FCM_SERVICE_ACCOUNT_JSON;
  process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(serviceAccount);
  t.after(() => {
    if (previous === undefined) delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    else process.env.FCM_SERVICE_ACCOUNT_JSON = previous;
  });
  t.mock.method(globalThis, 'fetch', fetch);
  const module = await import(`../dist/fcm.js?test=${moduleInstance++}`);
  return module.sendFcmPush;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function assertOAuthRequest({ url, init }, expectedIat) {
  assert.equal(url, tokenUri);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['content-type'], 'application/x-www-form-urlencoded');
  const form = new URLSearchParams(init.body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const assertion = form.get('assertion');
  const [header, payload, signature] = assertion.split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')), true);
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT', kid: 'test-key' });
  const claim = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claim.iss, 'relay@example.test');
  assert.equal(claim.iat, expectedIat);
  assert.equal(claim.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(claim.aud, tokenUri);
  assert.equal(claim.exp, claim.iat + 3600);
}
