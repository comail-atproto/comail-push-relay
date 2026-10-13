import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverAccessApproval, deliverStateChange } from '../dist/delivery.js';
import { record } from './handler-fixtures.mjs';

const CHANGE = {
  '@type': 'StateChange',
  changed: { 'urn:ietf:params:jmap:mail': { Mailbox: 'state-42' } },
};

test('StateChange selects the transport stored on each subscription', async (t) => {
  for (const subscription of [record('fcm'), record('web')]) {
    await t.test(subscription.kind, async () => {
      const sent = [];
      const transports = {
        async sendFcm(gotRecord, change) {
          sent.push({ transport: 'fcm', record: gotRecord, change });
          return { ok: true, status: 200, unregistered: false };
        },
        async sendWeb(gotRecord, change) {
          sent.push({ transport: 'web', record: gotRecord, change });
          return { ok: true, status: 201, unregistered: false };
        },
      };

      const result = await deliverStateChange(subscription, CHANGE, transports);
      assert.equal(result.ok, true);
      assert.deepEqual(sent, [{ transport: subscription.kind, record: subscription, change: CHANGE }]);
    });
  }
});

test('access-approval delivery sends only its opaque wake-up with bounded push options', async () => {
  const subscription = record('web');
  const sent = [];
  const result = await deliverAccessApproval(subscription, {
    async send(...args) {
      sent.push(args);
      return { ok: true, status: 201, unregistered: false };
    },
  });

  assert.deepEqual(result, { ok: true, status: 201, unregistered: false });
  assert.deepEqual(sent, [[
    subscription,
    { kind: 'access-approval' },
    { ttl: 120, topic: 'comail-access-approval' },
  ]]);
});
