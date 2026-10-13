import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { URL } from 'node:url';
import { applyCors, readJson, sendJson } from './http.js';
import { logger } from './logger.js';
import { subscriptionStore } from './store.js';
import { createSubscriptionLifecycle } from './subscriptions.js';
import { sendFcmPush } from './fcm.js';
import { getVapidPublicKey, sendWebPush, sendWebPushPayload } from './webpush.js';
import { isValidSubscriptionId } from './validation.js';
import type {
  JmapPushBody,
  SubscriptionRecord,
} from './types.js';
import {
  registry,
  httpRequestsTotal,
  httpDurationSeconds,
  pushesReceived,
  pushesForwarded,
  subscriptionsUnregistered,
  fcmDurationSeconds,
  webPushDurationSeconds,
  accessApprovalPushes,
} from './metrics.js';

const PORT = Number(process.env.PORT ?? 3003);
const HOST = process.env.HOST ?? '0.0.0.0';
const REPO_URL = 'https://github.com/bulwarkmail/relay';

const MAX_ACCESS_APPROVAL_SUBSCRIPTIONS = 16;

const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Bulwark Push Relay</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.55 system-ui, -apple-system, Segoe UI, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.4rem; margin: 0 0 1rem; }
  p { margin: 0 0 1rem; }
  a { color: inherit; }
</style>
</head>
<body>
<h1>Bulwark Push Relay</h1>
<p>When your mail server has something new, this pings your phone. That's the whole job.</p>
<p>It doesn't see the mail. Not the subject, not the sender, not a byte of the body. Just a ping and a push token.</p>
<p>Source: <a href="${REPO_URL}">${REPO_URL}</a></p>
</body>
</html>
`;

const subscriptions = createSubscriptionLifecycle({
  store: subscriptionStore,
  getVapidPublicKey,
});

async function handleJmap(
  req: http.IncomingMessage,
  id: string,
  res: http.ServerResponse,
): Promise<void> {
  if (!isValidSubscriptionId(id)) {
    return sendJson(res, 400, { error: 'Invalid subscriptionId' });
  }

  const record = await subscriptionStore.get(id);
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
    await subscriptionStore.put(id, record);
    return sendJson(res, 200, { ok: true });
  }

  if (body['@type'] === 'StateChange') {
    pushesReceived.inc({ type: 'StateChange' });
    const result = await dispatchStateChange(record, body);
    let outcome: 'ok' | 'unregistered' | 'http-4xx' | 'http-5xx' | 'fail';
    if (result.unregistered) outcome = 'unregistered';
    else if (result.ok) outcome = 'ok';
    else if (result.status >= 500) outcome = 'http-5xx';
    else if (result.status >= 400) outcome = 'http-4xx';
    else outcome = 'fail';
    pushesForwarded.inc({ result: outcome, transport: record.kind });
    record.lastPushAt = Date.now();
    await subscriptionStore.put(id, record);
    if (result.unregistered) {
      await subscriptionStore.delete(id);
      subscriptionsUnregistered.inc({
        reason: record.kind === 'fcm' ? 'fcm-unregistered' : 'webpush-gone',
        transport: record.kind,
      });
      await subscriptions.refreshActiveGauge();
    }
    return sendJson(res, 200, { ok: result.ok });
  }

  return sendJson(res, 400, { error: 'Unsupported JMAP push type' });
}

function accessApprovalAuthorized(req: http.IncomingMessage): boolean | null {
  const expected = process.env.ACCESS_APPROVAL_DISPATCH_TOKEN?.trim();
  if (!expected || expected.length < 32) return null;
  const header = req.headers.authorization ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

async function handleAccessApprovalDispatch(
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

  const body = (await readJson(req)) as
    | { kind?: unknown; subscriptionIds?: unknown }
    | null
    | undefined;
  if (
    !body ||
    body.kind !== 'access-approval' ||
    !Array.isArray(body.subscriptionIds) ||
    body.subscriptionIds.length < 1 ||
    body.subscriptionIds.length > MAX_ACCESS_APPROVAL_SUBSCRIPTIONS ||
    body.subscriptionIds.some((id) => !isValidSubscriptionId(id))
  ) {
    accessApprovalPushes.inc({ result: 'invalid' });
    return sendJson(res, 400, { error: 'Invalid access approval dispatch' });
  }

  const ids = [...new Set(body.subscriptionIds as string[])];
  const result = { delivered: 0, missing: 0, removed: 0, failed: 0 };
  for (const id of ids) {
    const record = await subscriptionStore.get(id);
    if (!record || record.kind !== 'web') {
      result.missing += 1;
      continue;
    }
    const timer = webPushDurationSeconds.startTimer();
    const sent = await sendWebPushPayload(
      record,
      { kind: 'access-approval' },
      { ttl: 120, topic: 'comail-access-approval' },
    );
    timer();
    if (sent.ok) {
      result.delivered += 1;
      record.lastPushAt = Date.now();
      await subscriptionStore.put(id, record);
    } else if (sent.unregistered) {
      result.removed += 1;
      await subscriptionStore.delete(id);
      subscriptionsUnregistered.inc({
        reason: 'webpush-gone',
        transport: 'web',
      });
    } else {
      result.failed += 1;
    }
  }
  await subscriptions.refreshActiveGauge();
  accessApprovalPushes.inc({
    result: result.failed > 0 ? 'partial_failure' : 'success',
  });
  return sendJson(res, 200, { ok: result.failed === 0, ...result });
}

async function dispatchStateChange(
  record: SubscriptionRecord,
  body: Extract<JmapPushBody, { '@type': 'StateChange' }>,
): Promise<{ ok: boolean; status: number; unregistered: boolean }> {
  if (record.kind === 'fcm') {
    const timer = fcmDurationSeconds.startTimer();
    const result = await sendFcmPush(record, body);
    timer();
    return result;
  }
  const timer = webPushDurationSeconds.startTimer();
  const result = await sendWebPush(record, body);
  timer();
  return result;
}

function normalizeRoute(method: string, path: string): string {
  if (path === '/' || path === '/index.html') return '/';
  if (path === '/api/health') return '/api/health';
  if (path === '/metrics') return '/metrics';
  if (path === '/api/push/vapid-public-key') return '/api/push/vapid-public-key';
  if (method === 'POST' && path === '/api/push/register') return '/api/push/register';
  if (method === 'POST' && path === '/api/push/register/web') return '/api/push/register/web';
  if (/^\/api\/push\/register\/[^/]+$/.test(path)) return '/api/push/register/:id';
  if (/^\/api\/push\/verify\/[^/]+$/.test(path)) return '/api/push/verify/:id';
  if (/^\/api\/push\/active\/[^/]+$/.test(path)) return '/api/push/active/:id';
  if (/^\/api\/push\/jmap\/[^/]+$/.test(path)) return '/api/push/jmap/:id';
  if (path === '/api/push/internal/access-approval') {
    return '/api/push/internal/access-approval';
  }
  return 'other';
}

const releaseIdentity = /^[0-9a-f]{40}-[0-9a-f]{16}$/.test(process.env.COMAIL_RELEASE_IDENTITY ?? "")
  ? process.env.COMAIL_RELEASE_IDENTITY
  : undefined;

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const route = normalizeRoute(method, path);
  const httpTimer = httpDurationSeconds.startTimer({ method, route });

  applyCors(req, res);
  if (method === 'OPTIONS') {
    // Preflight: 204 with the CORS headers already set above.
    res.writeHead(204);
    res.end();
    httpTimer();
    httpRequestsTotal.inc({ method, route, status: '204' });
    return;
  }

  try {
    if (method === 'GET' && path === '/metrics') {
      await subscriptions.refreshActiveGauge();
      const body = await registry.metrics();
      res.writeHead(200, {
        'content-type': registry.contentType,
        'cache-control': 'no-store',
      });
      res.end(body);
      return;
    }

    if (method === 'GET' && path === '/api/health') {
      const count = await subscriptionStore.size();
      return sendJson(res, 200, { ok: true, subscriptions: count, release_identity: releaseIdentity });
    }

    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      const accept = req.headers.accept ?? '';
      if (accept.includes('application/json') && !accept.includes('text/html')) {
        return sendJson(res, 200, {
          service: 'bulwark-push-relay',
          repo: REPO_URL,
          health: '/api/health',
        });
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(LANDING_HTML),
        'cache-control': 'public, max-age=300',
      });
      res.end(LANDING_HTML);
      return;
    }

    if (method === 'POST' && path === '/api/push/register') {
      return await subscriptions.register(req, res);
    }

    if (method === 'POST' && path === '/api/push/register/web') {
      return await subscriptions.registerWeb(req, res);
    }

    if (method === 'GET' && path === '/api/push/vapid-public-key') {
      const key = getVapidPublicKey();
      if (!key) {
        return sendJson(res, 503, { error: 'Web Push not configured' });
      }
      return sendJson(res, 200, { publicKey: key });
    }

    if (
      method === 'POST' &&
      path === '/api/push/internal/access-approval'
    ) {
      return await handleAccessApprovalDispatch(req, res);
    }

    const registerIdMatch = path.match(/^\/api\/push\/register\/([^/]+)$/);
    if (method === 'DELETE' && registerIdMatch) {
      return await subscriptions.unregister(decodeURIComponent(registerIdMatch[1]), res);
    }

    const verifyMatch = path.match(/^\/api\/push\/verify\/([^/]+)$/);
    if (method === 'GET' && verifyMatch) {
      return await subscriptions.verificationCode(decodeURIComponent(verifyMatch[1]), res);
    }

    const activeMatch = path.match(/^\/api\/push\/active\/([^/]+)$/);
    if (method === 'GET' && activeMatch) {
      return await subscriptions.active(decodeURIComponent(activeMatch[1]), res);
    }

    const jmapMatch = path.match(/^\/api\/push\/jmap\/([^/]+)$/);
    if (method === 'POST' && jmapMatch) {
      return await handleJmap(req, decodeURIComponent(jmapMatch[1]), res);
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    if (msg === 'Payload too large') {
      return sendJson(res, 413, { error: msg });
    }
    logger.error('relay: handler failed', { method, path, error: msg });
    if (!res.headersSent) {
      return sendJson(res, 500, { error: 'Internal server error' });
    }
    res.end();
  } finally {
    httpTimer();
    httpRequestsTotal.inc({ method, route, status: String(res.statusCode) });
    logger.info('relay: request', {
      method,
      path,
      status: res.statusCode,
      ms: Date.now() - started,
    });
  }
});

server.listen(PORT, HOST, () => {
  // Report the bound address so a PORT=0 start exposes the assigned port.
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : PORT;
  logger.info('relay: listening', { host: HOST, port: boundPort });
});

const shutdown = (signal: string) => {
  logger.info('relay: shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
