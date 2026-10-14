// Older disk records with only fcmToken are loaded as kind: 'fcm'.
export type SubscriptionRecord =
  | FcmSubscriptionRecord
  | WebSubscriptionRecord;

interface BaseSubscriptionRecord {
  verificationCode: string | null;
  createdAt: number;
  lastPushAt: number | null;
  accountLabel?: string;
}

export interface FcmSubscriptionRecord extends BaseSubscriptionRecord {
  kind: 'fcm';
  fcmToken: string;
}

export interface WebSubscriptionRecord extends BaseSubscriptionRecord {
  kind: 'web';
  webPush: WebPushSubscription;
}

// Mirror of the browser's PushSubscriptionJSON: https://w3c.github.io/push-api
export interface WebPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushVerification {
  '@type': 'PushVerification';
  pushSubscriptionId: string;
  verificationCode: string;
}

export interface StateChange {
  '@type': 'StateChange';
  changed: Record<string, Record<string, string>>;
}

export type JmapPushBody = PushVerification | StateChange;

export interface DeliveryResult {
  ok: boolean;
  status: number;
  unregistered: boolean;
}
