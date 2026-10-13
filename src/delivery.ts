import { sendFcmPush } from './fcm.js';
import { fcmDurationSeconds, webPushDurationSeconds } from './metrics.js';
import { sendWebPush, sendWebPushPayload } from './webpush.js';
import type { FcmSubscriptionRecord, StateChange, SubscriptionRecord, WebSubscriptionRecord } from './types.js';

export interface DeliveryResult {
  ok: boolean;
  status: number;
  unregistered: boolean;
}

export interface StateChangeTransports {
  sendFcm(record: FcmSubscriptionRecord, change: StateChange): Promise<DeliveryResult>;
  sendWeb(record: WebSubscriptionRecord, change: StateChange): Promise<DeliveryResult>;
}

export interface AccessApprovalTransport {
  send(
    record: WebSubscriptionRecord,
    payload: Readonly<Record<string, unknown>>,
    options: { ttl: number; topic: string },
  ): Promise<DeliveryResult>;
}

const defaultStateChangeTransports: StateChangeTransports = {
  sendFcm: sendFcmPush,
  sendWeb: sendWebPush,
};

const defaultAccessApprovalTransport: AccessApprovalTransport = {
  send: sendWebPushPayload,
};

export async function deliverStateChange(
  record: SubscriptionRecord,
  change: StateChange,
  transports: StateChangeTransports = defaultStateChangeTransports,
): Promise<DeliveryResult> {
  if (record.kind === 'fcm') {
    const timer = fcmDurationSeconds.startTimer();
    const result = await transports.sendFcm(record, change);
    timer();
    return result;
  }
  const timer = webPushDurationSeconds.startTimer();
  const result = await transports.sendWeb(record, change);
  timer();
  return result;
}

export async function deliverAccessApproval(
  record: WebSubscriptionRecord,
  transport: AccessApprovalTransport = defaultAccessApprovalTransport,
): Promise<DeliveryResult> {
  const timer = webPushDurationSeconds.startTimer();
  const result = await transport.send(
    record,
    { kind: 'access-approval' },
    { ttl: 120, topic: 'comail-access-approval' },
  );
  timer();
  return result;
}
