import type http from 'node:http';
import { sendJson, readJson } from './http.js';
import {
  subscriptionsActive,
  subscriptionsRegistered,
  subscriptionsUnregistered,
} from './metrics.js';
import type { SubscriptionStore } from './store.js';
import type { FcmSubscriptionRecord, WebSubscriptionRecord } from './types.js';
import {
  isValidFcmToken,
  isValidSubscriptionId,
  isValidWebPushSubscription,
} from './validation.js';

// New subscriptions remain active while waiting for their first StateChange.
const ACTIVE_GRACE_MS = 10 * 60 * 1000;

interface SubscriptionLifecycleDependencies {
  store: SubscriptionStore;
  getVapidPublicKey: () => string | null;
  now?: () => number;
}

export interface SubscriptionLifecycle {
  register(req: http.IncomingMessage, res: http.ServerResponse): Promise<void>;
  registerWeb(req: http.IncomingMessage, res: http.ServerResponse): Promise<void>;
  unregister(id: string, res: http.ServerResponse): Promise<void>;
  verificationCode(id: string, res: http.ServerResponse): Promise<void>;
  active(id: string, res: http.ServerResponse): Promise<void>;
  refreshActiveGauge(): Promise<void>;
}

export function createSubscriptionLifecycle({
  store,
  getVapidPublicKey,
  now = Date.now,
}: SubscriptionLifecycleDependencies): SubscriptionLifecycle {
  async function refreshActiveGauge(): Promise<void> {
    const counts = await store.sizeByKind();
    subscriptionsActive.set({ transport: 'fcm' }, counts.fcm);
    subscriptionsActive.set({ transport: 'web' }, counts.web);
  }

  async function register(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = (await readJson(req)) as RegistrationBody | null | undefined;
    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    const { subscriptionId, fcmToken, accountLabel } = body;
    if (!isValidSubscriptionId(subscriptionId)) {
      return sendJson(res, 400, { error: 'Invalid subscriptionId' });
    }
    if (!isValidFcmToken(fcmToken)) {
      return sendJson(res, 400, { error: 'Invalid fcmToken' });
    }

    const existing = await store.get(subscriptionId);
    const record: FcmSubscriptionRecord = {
      kind: 'fcm',
      fcmToken,
      // A new JMAP registration must not reuse an old verification code.
      verificationCode: null,
      createdAt: existing?.createdAt ?? now(),
      lastPushAt: existing?.lastPushAt ?? null,
      accountLabel: accountLabelValue(accountLabel),
    };
    await store.put(subscriptionId, record);
    subscriptionsRegistered.inc({ transport: 'fcm' });
    await refreshActiveGauge();
    return sendJson(res, 200, { ok: true });
  }

  async function registerWeb(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (!getVapidPublicKey()) {
      return sendJson(res, 503, { error: 'Web Push not configured' });
    }
    const body = (await readJson(req)) as WebRegistrationBody | null | undefined;
    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    const { subscriptionId, subscription, accountLabel } = body;
    if (!isValidSubscriptionId(subscriptionId)) {
      return sendJson(res, 400, { error: 'Invalid subscriptionId' });
    }
    if (!isValidWebPushSubscription(subscription)) {
      return sendJson(res, 400, { error: 'Invalid subscription' });
    }

    const existing = await store.get(subscriptionId);
    const record: WebSubscriptionRecord = {
      kind: 'web',
      webPush: subscription,
      // A new JMAP registration must not reuse an old verification code.
      verificationCode: null,
      createdAt: existing?.createdAt ?? now(),
      lastPushAt: existing?.lastPushAt ?? null,
      accountLabel: accountLabelValue(accountLabel),
    };
    await store.put(subscriptionId, record);
    subscriptionsRegistered.inc({ transport: 'web' });
    await refreshActiveGauge();
    return sendJson(res, 200, { ok: true });
  }

  async function unregister(id: string, res: http.ServerResponse): Promise<void> {
    if (!isValidSubscriptionId(id)) {
      return sendJson(res, 400, { error: 'Invalid subscriptionId' });
    }
    const existing = await store.get(id);
    await store.delete(id);
    subscriptionsUnregistered.inc({
      reason: 'client',
      transport: existing?.kind ?? 'unknown',
    });
    await refreshActiveGauge();
    return sendJson(res, 200, { ok: true });
  }

  async function verificationCode(id: string, res: http.ServerResponse): Promise<void> {
    if (!isValidSubscriptionId(id)) {
      return sendJson(res, 400, { error: 'Invalid subscriptionId' });
    }
    const record = await store.get(id);
    if (!record) {
      // Unknown IDs may belong to another relay and must not be reaped.
      return sendJson(res, 404, { error: 'Unknown subscription' });
    }
    return sendJson(res, 200, { verificationCode: record.verificationCode ?? null });
  }

  async function active(id: string, res: http.ServerResponse): Promise<void> {
    if (!isValidSubscriptionId(id)) {
      return sendJson(res, 400, { error: 'Invalid subscriptionId' });
    }
    const record = await store.get(id);
    if (!record) {
      return sendJson(res, 404, { error: 'Unknown subscription' });
    }
    const isActive = record.lastPushAt != null || now() - record.createdAt < ACTIVE_GRACE_MS;
    return sendJson(res, 200, { active: isActive });
  }

  return { register, registerWeb, unregister, verificationCode, active, refreshActiveGauge };
}

interface RegistrationBody {
  subscriptionId?: unknown;
  fcmToken?: unknown;
  accountLabel?: unknown;
}

interface WebRegistrationBody {
  subscriptionId?: unknown;
  subscription?: unknown;
  accountLabel?: unknown;
}

function accountLabelValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, 120) : undefined;
}
