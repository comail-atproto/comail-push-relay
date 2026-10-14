import assert from 'node:assert/strict';
import test from 'node:test';

import { startTestRelay } from './handler-fixtures.mjs';

test('HTTP contracts for public routes, CORS, malformed IDs, and body limits', async (t) => {
  const relay = await startTestRelay(t);

  await t.test('public routes and CORS preflight', async () => {
    const html = await relay.request('/', { headers: { accept: 'text/html' } });
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /^text\/html/);
    assert.match(await html.text(), /Bulwark Push Relay/);
    assert.deepEqual(await relay.json('/', { headers: { accept: 'application/json' } }), {
      status: 200,
      body: {
        service: 'bulwark-push-relay',
        repo: 'https://github.com/bulwarkmail/relay',
        health: '/api/health',
      },
    });
    assert.equal((await relay.request('/index.html')).status, 200);
    assert.deepEqual(await relay.json('/missing'), { status: 404, body: { error: 'Not found' } });

    const preflight = await relay.request('/api/push/register', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://mail.example.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, POST, DELETE, OPTIONS');
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'content-type');
    assert.equal(preflight.headers.get('access-control-max-age'), '86400');
    assert.equal((await relay.request('/api/health')).headers.get('access-control-allow-origin'), null);
  });

  await t.test('malformed encoded IDs return internal errors', async (st) => {
    const cases = [
      ['DELETE', '/api/push/register/%ZZ'],
      ['GET', '/api/push/verify/%E0%A4%A'],
      ['GET', '/api/push/active/%ZZ'],
      ['POST', '/api/push/jmap/%E0%A4%A', '{}'],
    ];
    for (const [method, path, body] of cases) {
      await st.test(`${method} ${path}`, async () => {
        const response = await relay.json(path, {
          method,
          ...(body ? { headers: { 'content-type': 'application/json' }, body } : {}),
        });
        assert.deepEqual(response, { status: 500, body: { error: 'Internal server error' } });
      });
    }
  });

  await t.test('request bodies accept the limit and close over-limit connections', { timeout: 3000 }, async () => {
    const limit = 64 * 1024;
    const json = JSON.stringify({
      subscriptionId: 'subscription_body_limit',
      fcmToken: 'f'.repeat(64),
      accountLabel: 'é'.repeat(32_000),
    });
    const body = json + ' '.repeat(limit - Buffer.byteLength(json));
    const init = { method: 'POST', headers: { 'content-type': 'application/json' } };
    assert.equal(Buffer.byteLength(body), limit);
    assert.ok(body.length < limit);
    assert.deepEqual(await relay.json('/api/push/register', { ...init, body }), {
      status: 200,
      body: { ok: true },
    });

    await assert.rejects(relay.request('/api/push/register', {
      ...init,
      body: `${body} `,
      signal: AbortSignal.timeout(2000),
    }), (error) => {
      assert.equal(error.cause?.code, 'UND_ERR_SOCKET');
      return true;
    });
  });
});
