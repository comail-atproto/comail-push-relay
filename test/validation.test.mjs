import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidFcmToken,
  isValidSubscriptionId,
  isValidWebPushSubscription,
} from '../dist/validation.js';

test('subscription IDs and FCM tokens enforce independent bounds', () => {
  const cases = [
    { name: 'ID', validate: isValidSubscriptionId, char: 'a', min: 8, max: 128, invalid: '!' },
    { name: 'FCM token', validate: isValidFcmToken, char: 'f', min: 64, max: 4096, invalid: '!' },
  ];
  for (const { name, validate, char, min, max, invalid } of cases) {
    for (const [length, valid] of [[min, true], [min - 1, false], [max, true], [max + 1, false]]) {
      assert.equal(validate(char.repeat(length)), valid, `${name} length ${length}`);
    }
    assert.equal(validate(char.repeat(min - 1) + invalid), false, `${name} character set`);
  }
});

test('Web Push fields enforce independent length and scheme bounds', () => {
  const fields = [
    ['endpoint', 10, 2048, (subscription, length) => {
      subscription.endpoint = 'https://'.padEnd(length, 'e');
    }],
    ['p256dh', 64, 256, (subscription, length) => {
      subscription.keys.p256dh = 'p'.repeat(length);
    }],
    ['auth', 16, 64, (subscription, length) => {
      subscription.keys.auth = 'a'.repeat(length);
    }],
  ];
  for (const [field, min, max, setLength] of fields) {
    for (const [length, valid] of [[min, true], [min - 1, false], [max, true], [max + 1, false]]) {
      const subscription = {
        endpoint: 'https://push.example.test',
        keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(16) },
      };
      setLength(subscription, length);
      assert.equal(isValidWebPushSubscription(subscription), valid, `${field} length ${length}`);
    }
  }
  assert.equal(isValidWebPushSubscription({
    endpoint: 'http://push.example.test',
    keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(16) },
  }), false, 'endpoint scheme');
});
