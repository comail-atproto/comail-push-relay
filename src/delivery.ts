import { sendFcmPush } from './fcm.js';
import { fcmDurationSeconds, webPushDurationSeconds } from './metrics.js';
import { sendWebPush, sendWebPushPayload } from './webpush.js';
import type { DeliveryResult, StateChange, SubscriptionRecord, WebSubscriptionRecord } from './types.js';

export async function deliverStateChange(
  record: SubscriptionRecord,
  change: StateChange,
): Promise<DeliveryResult> {
  const timer = (record.kind === 'fcm' ? fcmDurationSeconds : webPushDurationSeconds).startTimer();
  const result = record.kind === 'fcm'
    ? await sendFcmPush(record, change)
    : await sendWebPush(record, change);
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
