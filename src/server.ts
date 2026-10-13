import { createRelayServer } from './app.js';
import { deliverAccessApproval, deliverStateChange } from './delivery.js';
import { logger } from './logger.js';
import { subscriptionStore } from './store.js';
import { getVapidPublicKey } from './webpush.js';

const port = Number(process.env.PORT ?? 3003);
const host = process.env.HOST ?? '0.0.0.0';
const releaseIdentity = /^[0-9a-f]{40}-[0-9a-f]{16}$/.test(process.env.COMAIL_RELEASE_IDENTITY ?? '')
  ? process.env.COMAIL_RELEASE_IDENTITY
  : undefined;

const server = createRelayServer({
  store: subscriptionStore,
  deliverStateChange,
  getVapidPublicKey,
  releaseIdentity,
  deliverAccessApproval,
});

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
