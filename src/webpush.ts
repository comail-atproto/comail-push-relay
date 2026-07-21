import webpush from 'web-push';
import { logger } from './logger.js';
import type { StateChange, WebSubscriptionRecord } from './types.js';

let configured = false;
let publicKey: string | null = null;

function ensureConfigured(): boolean {
  if (configured) return publicKey !== null;
  configured = true;

  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  // RFC 8292 requires a contact - mailto: or https: URL the push service can
  // reach if our pushes start misbehaving. Default to a sensible self-host
  // hint so dev deployments still work without explicit config.
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:postmaster@localhost';

  if (!pub || !priv) {
    logger.warn('webpush: VAPID keys not configured - web push disabled');
    return false;
  }

  webpush.setVapidDetails(subject, pub, priv);
  publicKey = pub;
  return true;
}

export function getVapidPublicKey(): string | null {
  ensureConfigured();
  return publicKey;
}

export interface WebPushSendResult {
  ok: boolean;
  status: number;
  unregistered: boolean;
}

export async function sendWebPush(
  record: WebSubscriptionRecord,
  change: StateChange,
): Promise<WebPushSendResult> {
  return sendWebPushPayload(record, {
    kind: 'jmap-state-change',
    accountLabel: record.accountLabel ?? '',
    changed: change.changed ?? {},
  });
}

export async function sendWebPushPayload(
  record: WebSubscriptionRecord,
  payload: Readonly<Record<string, unknown>>,
  options: { ttl?: number; topic?: string } = {},
): Promise<WebPushSendResult> {
  if (!ensureConfigured()) {
    return { ok: false, status: 0, unregistered: false };
  }

  try {
    const res = await webpush.sendNotification(record.webPush, JSON.stringify(payload), {
      TTL: options.ttl ?? 60 * 60,
      urgency: 'high',
      ...(options.topic ? { topic: options.topic } : {}),
    });
    return { ok: true, status: res.statusCode, unregistered: false };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode ?? 0;
    // 404 / 410 mean the push service has dropped the subscription -
    // mirrors the FCM UNREGISTERED branch so the caller deletes the record.
    const unregistered = status === 404 || status === 410;
    return { ok: false, status, unregistered };
  }
}
