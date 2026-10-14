# Testing

The suite uses the native Node test runner on Node >= 20. Every selection builds
first so tests run against current `src`.

| Command | Covers |
| --- | --- |
| `npm run test:unit` | Release gates, `ci` result reporting, validation, FCM contracts, and unconfigured Web Push. |
| `npm run test:component` | Startup, registration, JMAP and approval delivery, authorization, HTTP, and storage. |
| `npm test` | Both selections, `node --test test/*.test.mjs`. |

Install dependencies with `npm ci --ignore-scripts`. `npm run build` runs `tsc`.

Most cases use the assembled server on a loopback port with a real file store
and inspect persisted JSON. Delivery cases replace the outbound push provider;
FCM cases replace `fetch`. No live push credentials, FCM, or APNs access is needed.

CLI cases spawn `dist/server.js` with `PORT=0` and wait for its logged listen
address before checking health. Each fixture owns and removes its private
store. Child processes clear inherited VAPID keys and subject, inline FCM
credentials, approval token, release identity, and data directory settings;
cases supply synthetic configuration explicitly.

Startup, shutdown, and oversized-body requests have bounded timeouts. Failed
startup includes the cause and bounded stdout/stderr. Command exit codes decide
whether checks pass.

VAPID configuration is read once per module instance. The absent-key case lives
in `test/transport-unconfigured.test.mjs`, isolated in its own process.

`bash scripts/test-health-release.sh` checks the release health contract
separately and needs `bash` and `curl`.
