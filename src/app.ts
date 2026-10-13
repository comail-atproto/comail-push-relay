import http from 'node:http';
import { createAccessApprovalHandler } from './access-approval.js';
import type { DeliveryResult } from './delivery.js';
import { createJmapHandler } from './jmap.js';
import { createRequestHandler } from './router.js';
import type { SubscriptionStore } from './store.js';
import { createSubscriptionLifecycle } from './subscriptions.js';
import type { StateChange, SubscriptionRecord, WebSubscriptionRecord } from './types.js';

export interface RelayDependencies {
  store: SubscriptionStore;
  getVapidPublicKey(): string | null;
  deliverStateChange(record: SubscriptionRecord, change: StateChange): Promise<DeliveryResult>;
  deliverAccessApproval(record: WebSubscriptionRecord): Promise<DeliveryResult>;
  releaseIdentity?: string;
}

export function createRelayServer({
  store,
  getVapidPublicKey,
  deliverStateChange,
  deliverAccessApproval,
  releaseIdentity,
}: RelayDependencies): http.Server {
  const subscriptions = createSubscriptionLifecycle({ store, getVapidPublicKey });
  const handleJmap = createJmapHandler({
    store,
    deliverStateChange,
    refreshActiveGauge: subscriptions.refreshActiveGauge,
  });
  const handleAccessApproval = createAccessApprovalHandler({
    store,
    deliver: deliverAccessApproval,
    refreshActiveGauge: subscriptions.refreshActiveGauge,
  });
  return http.createServer(createRequestHandler({
    store,
    subscriptions,
    handleJmap,
    handleAccessApproval,
    getVapidPublicKey,
    releaseIdentity,
  }));
}
