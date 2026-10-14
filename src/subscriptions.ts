import type http from 'node:http';
import { sendJson, readJson } from './http.js';
import {
  subscriptionsActive,
  subscriptionsRegistered,
  subscriptionsUnregistered,
} from './metrics.js';
import type { SubscriptionStore } from './store.js';
import type { FcmSubscriptionRecord, SubscriptionRecord, WebSubscriptionRecord } from './types.js';
import {
  isValidFcmToken,
  isValidSubscriptionId,
  isValidWebPushSubscription,
} from './validation.js';

// Fresh subscriptions get grace while awaiting their first StateChange.
const ACTIVE_GRACE_MS = 10 * 60 * 1000;

interface SubscriptionLifecycleDependencies {
  store: SubscriptionStore;
  getVapidPublicKey: () => string | null;
}

export function createSubscriptionLifecycle({
  store,
  getVapidPublicKey,
}: SubscriptionLifecycleDependencies) {
  async function refreshActiveGauge(): Promise<void> {
    const counts = await store.sizeByKind();
    subscriptionsActive.set({ transport: 'fcm' }, counts.fcm);
    subscriptionsActive.set({ transport: 'web' }, counts.web);
  }

  async function register(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    transport: 'fcm' | 'web' = 'fcm',
  ): Promise<void> {
    if (transport === 'web' && !getVapidPublicKey()) {
      return sendJson(res, 503, { error: 'Web Push not configured' });
    }
    const body = (await readJson(req)) as RegistrationBody | null | undefined;
    if (!body || typeof body !== 'object') {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    const { subscriptionId, accountLabel } = body;
    if (!isValidSubscriptionId(subscriptionId)) {
      return sendJson(res, 400, { error: 'Invalid subscriptionId' });
    }

    let record: FcmSubscriptionRecord | WebSubscriptionRecord;
    if (transport === 'fcm') {
      if (!isValidFcmToken(body.fcmToken)) {
        return sendJson(res, 400, { error: 'Invalid fcmToken' });
      }
      record = {
        kind: 'fcm',
        fcmToken: body.fcmToken,
        ...(await registrationMetadata(store, subscriptionId, accountLabel)),
      };
    } else {
      if (!isValidWebPushSubscription(body.subscription)) {
        return sendJson(res, 400, { error: 'Invalid subscription' });
      }
      record = {
        kind: 'web',
        webPush: body.subscription,
        ...(await registrationMetadata(store, subscriptionId, accountLabel)),
      };
    }
    await store.put(subscriptionId, record);
    subscriptionsRegistered.inc({ transport });
    await refreshActiveGauge();
    return sendJson(res, 200, { ok: true });
  }

  function registerWeb(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    return register(req, res, 'web');
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
    const record = await findSubscription(store, id, res);
    if (!record) return;
    return sendJson(res, 200, { verificationCode: record.verificationCode ?? null });
  }

  async function active(id: string, res: http.ServerResponse): Promise<void> {
    const record = await findSubscription(store, id, res);
    if (!record) {
      // Unknown IDs may belong to another relay and must not be reaped.
      return;
    }
    const isActive = record.lastPushAt != null || Date.now() - record.createdAt < ACTIVE_GRACE_MS;
    return sendJson(res, 200, { active: isActive });
  }

  return { register, registerWeb, unregister, verificationCode, active, refreshActiveGauge };
}

export type SubscriptionLifecycle = ReturnType<typeof createSubscriptionLifecycle>;

export async function findSubscription(
  store: SubscriptionStore,
  id: string,
  res: http.ServerResponse,
): Promise<SubscriptionRecord | null> {
  if (!isValidSubscriptionId(id)) {
    sendJson(res, 400, { error: 'Invalid subscriptionId' });
    return null;
  }
  const record = await store.get(id);
  if (!record) {
    sendJson(res, 404, { error: 'Unknown subscription' });
    return null;
  }
  return record;
}

interface RegistrationBody {
  subscriptionId?: unknown;
  fcmToken?: unknown;
  accountLabel?: unknown;
  subscription?: unknown;
}

async function registrationMetadata(
  store: SubscriptionStore,
  subscriptionId: string,
  accountLabel: unknown,
) {
  const existing = await store.get(subscriptionId);
  // A new JMAP registration must not reuse an old verification code.
  return {
    verificationCode: null,
    createdAt: existing?.createdAt ?? Date.now(),
    lastPushAt: existing?.lastPushAt ?? null,
    accountLabel: typeof accountLabel === 'string' ? accountLabel.slice(0, 120) : undefined,
  };
}
