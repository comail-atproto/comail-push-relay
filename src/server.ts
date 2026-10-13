import http from 'node:http';
import { createAccessApprovalHandler } from './access-approval.js';
import { deliverAccessApproval, deliverStateChange } from './delivery.js';
import { createJmapHandler } from './jmap.js';
import { logger } from './logger.js';
import { createRequestHandler } from './router.js';
import { subscriptionStore } from './store.js';
import { createSubscriptionLifecycle } from './subscriptions.js';
import { getVapidPublicKey } from './webpush.js';

const port = Number(process.env.PORT ?? 3003);
const host = process.env.HOST ?? '0.0.0.0';
const releaseIdentity = /^[0-9a-f]{40}-[0-9a-f]{16}$/.test(process.env.COMAIL_RELEASE_IDENTITY ?? '')
  ? process.env.COMAIL_RELEASE_IDENTITY
  : undefined;

const subscriptions = createSubscriptionLifecycle({ store: subscriptionStore, getVapidPublicKey });
const handleJmap = createJmapHandler({
  store: subscriptionStore,
  deliverStateChange,
  refreshActiveGauge: subscriptions.refreshActiveGauge,
});
const handleAccessApproval = createAccessApprovalHandler({
  store: subscriptionStore,
  deliver: deliverAccessApproval,
  refreshActiveGauge: subscriptions.refreshActiveGauge,
});
const server = http.createServer(createRequestHandler({
  store: subscriptionStore,
  subscriptions,
  handleJmap,
  handleAccessApproval,
  getVapidPublicKey,
  releaseIdentity,
}));

server.listen(port, host, () => {
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;
  logger.info('relay: listening', { host, port: boundPort });
});

function shutdown(signal: string): void {
  logger.info('relay: shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
