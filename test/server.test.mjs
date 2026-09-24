import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import webpush from 'web-push';

async function unusedPort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  listener.close();
  await once(listener, 'close');
  return port;
}

async function waitForServer(base, process) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) throw new Error('relay exited before becoming ready');
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // The listener may not have started yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('relay did not become ready');
}

async function request(base, route, options = {}) {
  const response = await fetch(base + route, options);
  return { status: response.status, body: await response.json() };
}

test('subscription lifecycle and access approval dispatch authorization', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'push-relay-test-'));
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const token = 'a'.repeat(40);
  const relay = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      PUSH_DATA_DIR: dataDir,
      ACCESS_APPROVAL_DISPATCH_TOKEN: token,
    },
    stdio: 'ignore',
  });
  const post = (route, body, authorization) =>
    request(base, route, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    });

  try {
    await waitForServer(base, relay);
    const id = 'subscription_12345';
    assert.deepEqual(await post('/api/push/register', {
      subscriptionId: id,
      fcmToken: 'f'.repeat(64),
    }), { status: 200, body: { ok: true } });
    assert.deepEqual(await request(base, `/api/push/verify/${id}`), {
      status: 200,
      body: { verificationCode: null },
    });
    assert.deepEqual(await post(`/api/push/jmap/${id}`, {
      '@type': 'PushVerification',
      pushSubscriptionId: id,
      verificationCode: '123456',
    }), { status: 200, body: { ok: true } });
    assert.deepEqual(await request(base, `/api/push/verify/${id}`), {
      status: 200,
      body: { verificationCode: '123456' },
    });
    assert.deepEqual(await request(base, `/api/push/active/${id}`), {
      status: 200,
      body: { active: true },
    });

    const dispatch = { kind: 'access-approval', subscriptionIds: [id] };
    assert.equal((await post('/api/push/internal/access-approval', dispatch)).status, 401);
    assert.equal((await post('/api/push/internal/access-approval', dispatch, 'Bearer wrong')).status, 401);
    assert.deepEqual(await post('/api/push/internal/access-approval', dispatch, `Bearer ${token}`), {
      status: 200,
      body: { ok: true, delivered: 0, missing: 1, removed: 0, failed: 0 },
    });

    assert.deepEqual(await request(base, `/api/push/register/${id}`, { method: 'DELETE' }), {
      status: 200,
      body: { ok: true },
    });
    assert.equal((await request(base, `/api/push/verify/${id}`)).status, 404);
    assert.equal((await request(base, '/api/health')).body.subscriptions, 0);
    const persisted = JSON.parse(await readFile(path.join(dataDir, 'subscriptions.json'), 'utf8'));
    assert.deepEqual(persisted.records, {});
  } finally {
    relay.kill('SIGTERM');
    if (relay.exitCode === null) await once(relay, 'exit');
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('web push StateChange payload carries opaque state references only', async () => {
  const originalSendNotification = webpush.sendNotification;
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
  let sent;
  webpush.sendNotification = async (_subscription, payload) => {
    sent = JSON.parse(payload);
    return { statusCode: 201 };
  };
  try {
    const { sendWebPush } = await import('../dist/webpush.js');
    const result = await sendWebPush({
      kind: 'web',
      webPush: {
        endpoint: 'https://push.example.com/message',
        keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(16) },
      },
      verificationCode: null,
      createdAt: Date.now(),
      lastPushAt: null,
      accountLabel: 'account',
    }, {
      '@type': 'StateChange',
      changed: { 'urn:ietf:params:jmap:mail': { Mailbox: '42' } },
      subject: 'private subject',
      body: 'private body',
    });
    assert.deepEqual(result, { ok: true, status: 201, unregistered: false });
    assert.deepEqual(sent, {
      kind: 'jmap-state-change',
      accountLabel: 'account',
      changed: { 'urn:ietf:params:jmap:mail': { Mailbox: '42' } },
    });
  } finally {
    webpush.sendNotification = originalSendNotification;
  }
});
