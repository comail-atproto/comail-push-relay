import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'relay_' });

const counter = <Label extends string>(name: string, help: string, labelNames: Label[]) =>
  new Counter<Label>({ name, help, labelNames, registers: [registry] });

export const httpRequestsTotal = counter(
  'relay_http_requests_total',
  'HTTP requests served by route + status',
  ['method', 'route', 'status'],
);

export const httpDurationSeconds = new Histogram({
  name: 'relay_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const subscriptionsRegistered = counter(
  'relay_subscriptions_registered_total',
  'Subscription register calls (new or refreshed token), by transport',
  ['transport'],
);

export const subscriptionsUnregistered = counter(
  'relay_subscriptions_unregistered_total',
  'Subscription deletions, by reason and transport',
  ['reason', 'transport'],
);

export const subscriptionsActive = new Gauge({
  name: 'relay_subscriptions_active',
  help: 'Currently stored subscriptions, by transport',
  labelNames: ['transport'] as const,
  registers: [registry],
});

export const pushesReceived = counter(
  'relay_pushes_received_total',
  'JMAP push bodies received from Stalwart',
  ['type'],
);

export const pushesForwarded = counter(
  'relay_pushes_forwarded_total',
  'Push forwarding outcomes by transport',
  ['result', 'transport'],
);

export const accessApprovalPushes = counter(
  'relay_access_approval_pushes_total',
  'Authenticated access-approval wake-up dispatch outcomes',
  ['result'],
);

export const fcmDurationSeconds = new Histogram({
  name: 'relay_fcm_send_duration_seconds',
  help: 'Latency of POST to fcm.googleapis.com',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const webPushDurationSeconds = new Histogram({
  name: 'relay_webpush_send_duration_seconds',
  help: 'Latency of encrypted Web Push delivery',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});
