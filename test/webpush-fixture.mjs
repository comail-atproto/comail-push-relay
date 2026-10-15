import assert from 'node:assert/strict';
import webpush from 'web-push';

// Keep the HTTP dispatch and persistence real while replacing the push service.
webpush.sendNotification = async (subscription, payload, options) => {
  assert.deepEqual(JSON.parse(payload), { kind: 'access-approval' });
  assert.equal(options.TTL, 120);
  assert.equal(options.topic, 'comail-access-approval');
  if (subscription.endpoint.endsWith('/gone')) {
    throw Object.assign(new Error('expired subscription'), { statusCode: 410 });
  }
  if (subscription.endpoint.endsWith('/retry')) {
    throw Object.assign(new Error('temporary failure'), { statusCode: 503 });
  }
  assert.ok(subscription.endpoint.endsWith('/delivered'));
  return { statusCode: 201 };
};
