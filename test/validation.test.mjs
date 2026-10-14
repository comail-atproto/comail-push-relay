import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidFcmToken,
  isValidSubscriptionId,
  isValidWebPushSubscription,
} from '../dist/validation.js';

test('subscription IDs enforce independent length and character bounds', () => {
  for (const [value, valid] of [
    ['a'.repeat(8), true],
    ['a'.repeat(7), false],
    ['a'.repeat(128), true],
    ['a'.repeat(129), false],
    ['a'.repeat(127) + '!', false],
  ]) {
    assert.equal(isValidSubscriptionId(value), valid, `ID length ${value.length}`);
  }
});

test('FCM tokens enforce independent length and character bounds', () => {
  for (const [value, valid] of [
    ['f'.repeat(64), true],
    ['f'.repeat(63), false],
    ['f'.repeat(4096), true],
    ['f'.repeat(4097), false],
    ['f'.repeat(63) + '!', false],
  ]) {
    assert.equal(isValidFcmToken(value), valid, `token length ${value.length}`);
  }
});

test('Web Push fields enforce independent length and scheme bounds', () => {
  for (const [field, value, valid] of [
    ['endpoint', 'https://ab', true],
    ['endpoint', 'https://a', false],
    ['endpoint', 'https://'.padEnd(2048, 'e'), true],
    ['endpoint', 'https://'.padEnd(2049, 'e'), false],
    ['p256dh', 'p'.repeat(64), true],
    ['p256dh', 'p'.repeat(63), false],
    ['p256dh', 'p'.repeat(256), true],
    ['p256dh', 'p'.repeat(257), false],
    ['auth', 'a'.repeat(16), true],
    ['auth', 'a'.repeat(15), false],
    ['auth', 'a'.repeat(64), true],
    ['auth', 'a'.repeat(65), false],
    ['endpoint', 'http://push.example.test', false],
  ]) {
    const subscription = {
      endpoint: 'https://push.example.test',
      keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(16) },
    };
    if (field === 'endpoint') subscription.endpoint = value;
    else subscription.keys[field] = value;
    assert.equal(isValidWebPushSubscription(subscription), valid, `${field} length ${value.length}`);
  }
});
