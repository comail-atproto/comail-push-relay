import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FileSubscriptionStore } from '../dist/store.js';
import { record } from './record-fixture.mjs';

test('concurrent initial writes retain every record', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'push-relay-store-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = new FileSubscriptionStore(dataDir);
  const createdAt = Date.now();
  const ids = [
    ...Array.from({ length: 20 }, (_, index) => `subscription_${index}`),
    '__proto__',
    'constructor',
    'toString',
  ];
  const records = ids.map((id, index) => [
    id,
    record('fcm', { fcmToken: String(index).padStart(64, 'f'), createdAt }),
  ]);

  await Promise.all(records.map(([id, record]) => store.put(id, record)));
  assert.equal(await store.size(), records.length);
  assert.equal(await store.get('hasOwnProperty'), null);

  const reopened = new FileSubscriptionStore(dataDir);
  assert.equal(await reopened.size(), records.length);
  for (const [id, expected] of records) {
    assert.deepEqual(await reopened.get(id), expected);
  }
  assert.equal(await reopened.get('hasOwnProperty'), null);
});

test('last push time controls expiry and cached expiry persists', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'push-relay-store-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const ttl = 90 * 24 * 60 * 60 * 1000;
  let now = 2_000_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const id = 'subscription_recent_push';
  const expiring = record('fcm', {
    createdAt: now - (2 * ttl),
    lastPushAt: now - ttl,
  });

  await new FileSubscriptionStore(dataDir).put(id, expiring);
  const cached = new FileSubscriptionStore(dataDir);
  assert.deepEqual(await cached.get(id), expiring);

  now += 1;
  assert.equal(await cached.get(id), null);
  const persisted = JSON.parse(await readFile(path.join(dataDir, 'subscriptions.json'), 'utf8'));
  assert.equal(id in persisted.records, false);
  assert.equal(await new FileSubscriptionStore(dataDir).get(id), null);
});

test('write failures retain the published file and recover the write queue', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'push-relay-store-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = new FileSubscriptionStore(dataDir);
  const createdAt = Date.now();
  const first = record('fcm', { fcmToken: '1'.repeat(64), createdAt });
  const second = record('fcm', { fcmToken: '2'.repeat(64), createdAt });
  const third = record('fcm', { fcmToken: '3'.repeat(64), createdAt });
  const target = path.join(dataDir, 'subscriptions.json');
  const temporary = `${target}.tmp`;

  await store.put('subscription_first', first);
  const published = await readFile(target);
  await mkdir(temporary);
  await assert.rejects(store.put('subscription_second', second), { code: 'EISDIR' });
  assert.deepEqual(await readFile(target), published);

  await rm(temporary, { recursive: true });
  await store.put('subscription_third', third);
  const recovered = new FileSubscriptionStore(dataDir);
  assert.deepEqual(await recovered.get('subscription_first'), first);
  assert.deepEqual(await recovered.get('subscription_third'), third);
});
