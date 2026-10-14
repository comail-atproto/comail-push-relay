import webpush from 'web-push';
import { record } from './record-fixture.mjs';

export const WEB_SUBSCRIPTION = {
  endpoint: 'https://push.example.test/subscription/123',
  keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(16) },
};

const keys = webpush.generateVAPIDKeys();
export const WEB_PUSH_ENV = {
  VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: keys.privateKey,
  VAPID_SUBJECT: 'mailto:test@example.test',
};
export const WEB_PUSH_PUBLIC_KEY = keys.publicKey;

export function webPushRecord(accountLabel, status) {
  const seeded = record('web', { accountLabel });
  seeded.webPush.endpoint += `/${status || 'no-status'}`;
  return seeded;
}

export function mockWebPush(t, environment = {}) {
  const configured = { ...WEB_PUSH_ENV, ...environment };
  const previous = Object.fromEntries(Object.keys(configured).map((name) => [name, process.env[name]]));
  Object.assign(process.env, configured);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (subscription, payload, options) => {
    sent.push({ subscription: structuredClone(subscription), payload: JSON.parse(payload), options });
    const status = Number(new URL(subscription.endpoint).pathname.split('/').at(-1));
    if (status === 201) return { statusCode: status };
    throw Object.assign(new Error(`push service ${status || 'unavailable'}`), {
      ...(status ? { statusCode: status } : {}),
    });
  });
  return sent;
}
