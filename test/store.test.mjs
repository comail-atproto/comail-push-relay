import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FileSubscriptionStore } from '../dist/store.js';

test('concurrent initial writes retain every record', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'push-relay-store-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = new FileSubscriptionStore(dataDir);
  const createdAt = Date.now();
  const records = Array.from({ length: 20 }, (_, index) => [
    `subscription_${index}`,
    {
      kind: 'fcm',
      fcmToken: String(index).padStart(64, 'f'),
      verificationCode: null,
      createdAt,
      lastPushAt: null,
    },
  ]);

  await Promise.all(records.map(([id, record]) => store.put(id, record)));
  assert.equal(await store.size(), records.length);

  const reopened = new FileSubscriptionStore(dataDir);
  assert.equal(await reopened.size(), records.length);
  for (const [id, expected] of records) {
    assert.deepEqual(await reopened.get(id), expected);
  }
});
