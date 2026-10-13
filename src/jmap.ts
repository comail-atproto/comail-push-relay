import type http from 'node:http';
import { sendJson, readJson } from './http.js';
import { pushesForwarded, pushesReceived, subscriptionsUnregistered } from './metrics.js';
import type { SubscriptionStore } from './store.js';
import type { JmapPushBody, StateChange, SubscriptionRecord } from './types.js';
import { isValidSubscriptionId } from './validation.js';
import type { DeliveryResult } from './delivery.js';

export interface JmapHandlerDependencies {
  store: SubscriptionStore;
  deliverStateChange(record: SubscriptionRecord, change: StateChange): Promise<DeliveryResult>;
  refreshActiveGauge(): Promise<void>;
}

export function createJmapHandler({
  store,
  deliverStateChange,
  refreshActiveGauge,
}: JmapHandlerDependencies) {
  return async function handleJmap(
    req: http.IncomingMessage,
    id: string,
    res: http.ServerResponse,
  ): Promise<void> {
    if (!isValidSubscriptionId(id)) {
      return sendJson(res, 400, { error: 'Invalid subscriptionId' });
    }
    const record = await store.get(id);
    if (!record) {
      return sendJson(res, 404, { error: 'Unknown subscription' });
    }
    const body = (await readJson(req)) as JmapPushBody | null | undefined;
    if (!body || typeof body !== 'object' || typeof body['@type'] !== 'string') {
      return sendJson(res, 400, { error: 'Invalid JMAP push body' });
    }
    if (body['@type'] === 'PushVerification') {
      pushesReceived.inc({ type: 'PushVerification' });
      record.verificationCode = body.verificationCode;
      await store.put(id, record);
      return sendJson(res, 200, { ok: true });
    }
    if (body['@type'] !== 'StateChange') {
      return sendJson(res, 400, { error: 'Unsupported JMAP push type' });
    }

    pushesReceived.inc({ type: 'StateChange' });
    const result = await deliverStateChange(record, body);
    pushesForwarded.inc({ result: deliveryOutcome(result), transport: record.kind });
    record.lastPushAt = Date.now();
    await store.put(id, record);
    if (result.unregistered) {
      await store.delete(id);
      subscriptionsUnregistered.inc({
        reason: record.kind === 'fcm' ? 'fcm-unregistered' : 'webpush-gone',
        transport: record.kind,
      });
      await refreshActiveGauge();
    }
    return sendJson(res, 200, { ok: result.ok });
  };
}

function deliveryOutcome(result: DeliveryResult): 'ok' | 'unregistered' | 'http-4xx' | 'http-5xx' | 'fail' {
  if (result.unregistered) return 'unregistered';
  if (result.ok) return 'ok';
  if (result.status >= 500) return 'http-5xx';
  if (result.status >= 400) return 'http-4xx';
  return 'fail';
}
