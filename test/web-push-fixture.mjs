import webpush from 'web-push';

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
