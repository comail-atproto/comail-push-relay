import type http from 'node:http';
import { URL } from 'node:url';
import { applyCors, sendJson } from './http.js';
import { logger } from './logger.js';
import { httpDurationSeconds, httpRequestsTotal, registry } from './metrics.js';
import type { SubscriptionStore } from './store.js';
import type { SubscriptionLifecycle } from './subscriptions.js';

const REPO_URL = 'https://github.com/bulwarkmail/relay';
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

type IdHandler = (req: http.IncomingMessage, id: string, res: http.ServerResponse) => Promise<void>;
type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

export interface RouterDependencies {
  store: SubscriptionStore;
  subscriptions: SubscriptionLifecycle;
  handleJmap: IdHandler;
  handleAccessApproval: RequestHandler;
  getVapidPublicKey(): string | null;
  releaseIdentity?: string;
}

export function createRequestHandler(dependencies: RouterDependencies): http.RequestListener {
  return async (req, res) => {
    const started = Date.now();
    const method = req.method ?? 'GET';
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const route = normalizeRoute(method, path);
    const httpTimer = httpDurationSeconds.startTimer({ method, route });
    applyCors(req, res);
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      httpTimer();
      httpRequestsTotal.inc({ method, route, status: '204' });
      return;
    }
    try {
      return await routeRequest(dependencies, req, res, method, path);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message === 'Payload too large') return sendJson(res, 413, { error: message });
      logger.error('relay: handler failed', { method, path, error: message });
      if (!res.headersSent) return sendJson(res, 500, { error: 'Internal server error' });
      res.end();
    } finally {
      httpTimer();
      httpRequestsTotal.inc({ method, route, status: String(res.statusCode) });
      logger.info('relay: request', { method, path, status: res.statusCode, ms: Date.now() - started });
    }
  };
}

async function routeRequest(
  {
    store,
    subscriptions,
    handleJmap,
    handleAccessApproval,
    getVapidPublicKey,
    releaseIdentity,
  }: RouterDependencies,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  method: string,
  path: string,
): Promise<void> {
  if (method === 'GET' && path === '/metrics') {
    await subscriptions.refreshActiveGauge();
    const body = await registry.metrics();
    res.writeHead(200, { 'content-type': registry.contentType, 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  if (method === 'GET' && path === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      subscriptions: await store.size(),
      release_identity: releaseIdentity,
    });
  }
  if (method === 'GET' && (path === '/' || path === '/index.html')) return landing(req, res);
  if (method === 'POST' && path === '/api/push/register') return subscriptions.register(req, res);
  if (method === 'POST' && path === '/api/push/register/web') return subscriptions.registerWeb(req, res);
  if (method === 'GET' && path === '/api/push/vapid-public-key') {
    const key = getVapidPublicKey();
    return key ? sendJson(res, 200, { publicKey: key }) : sendJson(res, 503, { error: 'Web Push not configured' });
  }
  if (method === 'POST' && path === '/api/push/internal/access-approval') {
    return handleAccessApproval(req, res);
  }
  const registerId = path.match(/^\/api\/push\/register\/([^/]+)$/);
  if (method === 'DELETE' && registerId) return subscriptions.unregister(decodeURIComponent(registerId[1]), res);
  const verifyId = path.match(/^\/api\/push\/verify\/([^/]+)$/);
  if (method === 'GET' && verifyId) return subscriptions.verificationCode(decodeURIComponent(verifyId[1]), res);
  const activeId = path.match(/^\/api\/push\/active\/([^/]+)$/);
  if (method === 'GET' && activeId) return subscriptions.active(decodeURIComponent(activeId[1]), res);
  const jmapId = path.match(/^\/api\/push\/jmap\/([^/]+)$/);
  if (method === 'POST' && jmapId) return handleJmap(req, decodeURIComponent(jmapId[1]), res);
  return sendJson(res, 404, { error: 'Not found' });
}

function landing(req: http.IncomingMessage, res: http.ServerResponse): void {
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
}

function normalizeRoute(method: string, path: string): string {
  if (path === '/' || path === '/index.html') return '/';
  if (path === '/api/health' || path === '/metrics' || path === '/api/push/vapid-public-key') return path;
  if (method === 'POST' && (path === '/api/push/register' || path === '/api/push/register/web')) return path;
  if (/^\/api\/push\/register\/[^/]+$/.test(path)) return '/api/push/register/:id';
  if (/^\/api\/push\/verify\/[^/]+$/.test(path)) return '/api/push/verify/:id';
  if (/^\/api\/push\/active\/[^/]+$/.test(path)) return '/api/push/active/:id';
  if (/^\/api\/push\/jmap\/[^/]+$/.test(path)) return '/api/push/jmap/:id';
  if (path === '/api/push/internal/access-approval') return path;
  return 'other';
}
