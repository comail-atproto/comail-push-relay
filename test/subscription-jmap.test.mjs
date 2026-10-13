import assert from 'node:assert/strict';
import test from 'node:test';

import { record, startTestRelay } from './handler-fixtures.mjs';

const SUBSCRIPTION_ID = 'subscription_12345';

test('subscription routes reject invalid IDs before store access', async (t) => {
  const relay = await startTestRelay();
  t.after(() => relay.close());

  const invalidIds = [
    ['unregister', 'DELETE', '/api/push/register/invalid!id'],
    ['verify', 'GET', '/api/push/verify/invalid!id'],
    ['active lookup', 'GET', '/api/push/active/invalid!id'],
    ['JMAP callback', 'POST', '/api/push/jmap/invalid!id'],
  ];
  for (const [name, method, route] of invalidIds) {
    await t.test(name, async () => {
      assert.deepEqual(await relay.json(route, { method }), {
        status: 400,
        body: { error: 'Invalid subscriptionId' },
      });
    });
  }
  assert.deepEqual(await relay.json('/api/push/active/unknown_123'), {
    status: 404,
    body: { error: 'Unknown subscription' },
  });
});

test('JMAP callbacks reject missing records and malformed or unsupported bodies', async (t) => {
  const relay = await startTestRelay({ records: { [SUBSCRIPTION_ID]: record('fcm') } });
  t.after(() => relay.close());

  const failures = [
    ['unknown subscription', 'unknown_subscription', JSON.stringify({ '@type': 'PushVerification', verificationCode: '123456' }), 404, 'Unknown subscription'],
    ['invalid JSON', SUBSCRIPTION_ID, '{not json', 400, 'Invalid JMAP push body'],
    ['missing type', SUBSCRIPTION_ID, JSON.stringify({ verificationCode: '123456' }), 400, 'Invalid JMAP push body'],
    ['unsupported type', SUBSCRIPTION_ID, JSON.stringify({ '@type': 'Other' }), 400, 'Unsupported JMAP push type'],
  ];
  for (const [name, id, body, status, error] of failures) {
    await t.test(name, async () => {
      const response = await relay.request(`/api/push/jmap/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }).then(async (res) => ({ status: res.status, body: await res.json() }));
      assert.deepEqual(response, { status, body: { error } });
    });
  }
});
