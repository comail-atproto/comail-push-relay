export function record(kind, overrides = {}) {
  const {
    fcmToken = 'f'.repeat(64),
    webPush = {
      endpoint: 'https://push.example.test/subscription/123',
      keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(16) },
    },
    ...metadata
  } = overrides;
  return {
    verificationCode: null,
    createdAt: Date.now(),
    lastPushAt: null,
    ...metadata,
    kind,
    ...(kind === 'fcm' ? { fcmToken } : { webPush }),
  };
}
