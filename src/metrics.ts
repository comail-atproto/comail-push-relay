import { Counter } from 'prom-client';
import { registry } from 'bulwark-relay/dist/metrics.js';

export const accessApprovalPushes = new Counter({
  name: 'relay_access_approval_pushes_total',
  help: 'Authenticated access-approval wake-up dispatch outcomes',
  labelNames: ['result'] as const,
  registers: [registry],
});
