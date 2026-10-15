import webpush from 'web-push';
import { getVapidPublicKey } from 'bulwark-relay/dist/webpush.js';
import type { WebPushSendResult } from 'bulwark-relay/dist/webpush.js';
import type { WebSubscriptionRecord } from 'bulwark-relay/dist/types.js';

export async function sendAccessApprovalPush(record: WebSubscriptionRecord): Promise<WebPushSendResult> {
  if (!getVapidPublicKey()) {
    return { ok: false, status: 0, unregistered: false };
  }
  try {
    const response = await webpush.sendNotification(record.webPush, JSON.stringify({ kind: 'access-approval' }), {
      TTL: 120,
      urgency: 'high',
      topic: 'comail-access-approval',
    });
    return { ok: true, status: response.statusCode, unregistered: false };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode ?? 0;
    return { ok: false, status, unregistered: status === 404 || status === 410 };
  }
}
