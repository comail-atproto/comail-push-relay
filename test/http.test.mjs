import assert from 'node:assert/strict';
import test from 'node:test';

import { startRelay } from './lifecycle.mjs';

test('public routes and CORS preflight keep their HTTP contracts', async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());

  const html = await relay.request('/', { headers: { accept: 'text/html' } });
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /^text\/html/);
  assert.match(await html.text(), /Bulwark Push Relay/);

  assert.deepEqual(await relay.json('/', {
    headers: { accept: 'application/json' },
  }), {
    status: 200,
    body: {
      service: 'bulwark-push-relay',
      repo: 'https://github.com/bulwarkmail/relay',
      health: '/api/health',
    },
  });
  assert.equal((await relay.request('/index.html')).status, 200);
  assert.deepEqual(await relay.json('/missing'), {
    status: 404,
    body: { error: 'Not found' },
  });

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

  const withoutOrigin = await relay.request('/api/health');
  assert.equal(withoutOrigin.headers.get('access-control-allow-origin'), null);
});

test('malformed encoded subscription IDs reach the internal-error response', async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());

  const cases = [
    { method: 'DELETE', path: '/api/push/register/%ZZ' },
    { method: 'GET', path: '/api/push/verify/%E0%A4%A' },
    { method: 'GET', path: '/api/push/active/%ZZ' },
    { method: 'POST', path: '/api/push/jmap/%E0%A4%A', body: '{}' },
  ];
  for (const c of cases) {
    await t.test(`${c.method} ${c.path}`, async () => {
      const response = await relay.json(c.path, {
        method: c.method,
        ...(c.body ? {
          headers: { 'content-type': 'application/json' },
          body: c.body,
        } : {}),
      });
      assert.deepEqual(response, {
        status: 500,
        body: { error: 'Internal server error' },
      });
    });
  }
});

test('oversized request bodies close the connection', { timeout: 3000 }, async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());

  await assert.rejects(relay.request('/api/push/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'x'.repeat(64 * 1024 + 1),
    signal: AbortSignal.timeout(2000),
  }), (error) => {
    assert.equal(error.cause?.code, 'UND_ERR_SOCKET');
    return true;
  });
});
