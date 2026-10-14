import { sendFcmPush } from './fcm.js';
import { fcmDurationSeconds, webPushDurationSeconds } from './metrics.js';
import { sendWebPush, sendWebPushPayload } from './webpush.js';
import type { StateChange, SubscriptionRecord, WebSubscriptionRecord } from './types.js';

export interface DeliveryResult {
  ok: boolean;
  status: number;
  unregistered: boolean;
}

export async function deliverStateChange(
  record: SubscriptionRecord,
  change: StateChange,
): Promise<DeliveryResult> {
  if (record.kind === 'fcm') {
    const timer = fcmDurationSeconds.startTimer();
    const result = await sendFcmPush(record, change);
    timer();
    return result;
  }
  const timer = webPushDurationSeconds.startTimer();
  const result = await sendWebPush(record, change);
  timer();
  return result;
}

export async function deliverAccessApproval(
  record: WebSubscriptionRecord,
): Promise<DeliveryResult> {
  const timer = webPushDurationSeconds.startTimer();
  const result = await sendWebPushPayload(
    record,
    { kind: 'access-approval' },
    { ttl: 120, topic: 'comail-access-approval' },
  );
  timer();
  return result;
}
