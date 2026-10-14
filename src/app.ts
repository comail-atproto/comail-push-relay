import http from 'node:http';
import { createAccessApprovalHandler } from './access-approval.js';
import type { deliverAccessApproval, deliverStateChange } from './delivery.js';
import { createJmapHandler } from './jmap.js';
import { createRequestHandler } from './router.js';
import type { SubscriptionStore } from './store.js';
import { createSubscriptionLifecycle } from './subscriptions.js';

export interface RelayDependencies {
  store: SubscriptionStore;
  getVapidPublicKey(): string | null;
  deliverStateChange: typeof deliverStateChange;
  deliverAccessApproval: typeof deliverAccessApproval;
  releaseIdentity?: string;
}

export function createRelayServer(dependencies: RelayDependencies): http.Server {
  const subscriptions = createSubscriptionLifecycle(dependencies);
  const refreshActiveGauge = subscriptions.refreshActiveGauge;
  return http.createServer(createRequestHandler({
    ...dependencies,
    subscriptions,
    handleJmap: createJmapHandler({ ...dependencies, refreshActiveGauge }),
    handleAccessApproval: createAccessApprovalHandler({
      ...dependencies,
      deliver: dependencies.deliverAccessApproval,
      refreshActiveGauge,
    }),
  }));
}
