import { timingSafeEqual } from 'node:crypto';
import type http from 'node:http';
import { sendJson, readJson } from './http.js';
import { accessApprovalPushes, subscriptionsUnregistered } from './metrics.js';
import type { SubscriptionStore } from './store.js';
import type { deliverAccessApproval } from './delivery.js';
import { isValidSubscriptionId } from './validation.js';

const MAX_SUBSCRIPTIONS = 16;

export interface AccessApprovalHandlerDependencies {
  store: SubscriptionStore;
  deliver: typeof deliverAccessApproval;
  refreshActiveGauge(): Promise<void>;
}

export function createAccessApprovalHandler({
  store,
  deliver,
  refreshActiveGauge,
}: AccessApprovalHandlerDependencies) {
  return async function handleAccessApprovalDispatch(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const authorized = accessApprovalAuthorized(req);
    if (authorized == null) {
      accessApprovalPushes.inc({ result: 'disabled' });
      return sendJson(res, 503, { error: 'Access approval dispatch not configured' });
    }
    if (!authorized) {
      accessApprovalPushes.inc({ result: 'unauthorized' });
      return sendJson(res, 401, { error: 'Unauthorized' });
    }
    const body = (await readJson(req)) as AccessApprovalBody | null | undefined;
    if (!isValidDispatch(body)) {
      accessApprovalPushes.inc({ result: 'invalid' });
      return sendJson(res, 400, { error: 'Invalid access approval dispatch' });
    }

    const result = { delivered: 0, missing: 0, removed: 0, failed: 0 };
    for (const id of new Set(body.subscriptionIds)) {
      const record = await store.get(id);
      if (!record || record.kind !== 'web') {
        result.missing += 1;
        continue;
      }
      const sent = await deliver(record);
      if (sent.ok) {
        result.delivered += 1;
        record.lastPushAt = Date.now();
        await store.put(id, record);
      } else if (sent.unregistered) {
        result.removed += 1;
        await store.delete(id);
        subscriptionsUnregistered.inc({ reason: 'webpush-gone', transport: 'web' });
      } else {
        result.failed += 1;
      }
    }
    await refreshActiveGauge();
    accessApprovalPushes.inc({ result: result.failed > 0 ? 'partial_failure' : 'success' });
    return sendJson(res, 200, { ok: result.failed === 0, ...result });
  };
}

function accessApprovalAuthorized(req: http.IncomingMessage): boolean | null {
  const expected = process.env.ACCESS_APPROVAL_DISPATCH_TOKEN?.trim();
  if (!expected || expected.length < 32) return null;
  const header = req.headers.authorization ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

interface AccessApprovalBody {
  kind?: unknown;
  subscriptionIds?: unknown;
}

function isValidDispatch(body: AccessApprovalBody | null | undefined): body is { kind: 'access-approval'; subscriptionIds: string[] } {
  return Boolean(
    body &&
    body.kind === 'access-approval' &&
    Array.isArray(body.subscriptionIds) &&
    body.subscriptionIds.length >= 1 &&
    body.subscriptionIds.length <= MAX_SUBSCRIPTIONS &&
    body.subscriptionIds.every(isValidSubscriptionId),
  );
}
