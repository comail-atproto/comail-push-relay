# Testing

The suite uses the native Node test runner. Each behavior lives at one layer,
and every test command builds first so tests run against current `src`.

## Layers

| Layer | Selection | Covers |
| --- | --- | --- |
| Unit | `npm run test:unit` | Release gates, `ci` result reporting, and FCM/Web Push transport contracts. |
| Component | `npm run test:component` | Relay startup, registration, JMAP dispatch, authorization and HTTP contracts with isolated file stores. |
| All | `npm test` | Both selections, `node --test test/*.test.mjs`. |

## Prerequisites

```sh
npm ci --ignore-scripts   # first checkout
npm run build             # tsc; the selections also build
```

Node >= 20.

## Determinism

- Most component cases use the assembled server on a loopback port with the real
  file store. They inspect persisted JSON and replace outbound delivery only.
- CLI startup and legacy-record cases spawn `dist/server.js` with `PORT=0` and
  wait for its logged listen address before checking health.
- Each relay gets a private temporary store; fixtures delete only directories
  they created.
- The child fixture strips inherited `VAPID_*`, `FCM_SERVICE_ACCOUNT_JSON` and
  `ACCESS_APPROVAL_DISPATCH_TOKEN`; it also clears inherited release identity
  and data directory settings. Cases opt into synthetic configuration explicitly.
- Startup waits, shutdown waits, and oversized-body requests have bounded timeouts.
- VAPID configuration is read once per module instance. The absent-key case
  therefore lives in `test/transport-unconfigured.test.mjs`, which the runner
  isolates in its own process, rather than mutating a configured module.

## Failure artifacts

Command exit codes are the gate. A process that fails to spawn, exits early, or
never becomes ready fails with its cause and bounded stdout/stderr.

## Live scope

None of these selections require live push credentials, FCM, or APNs access.

## Runtime checks

`bash scripts/test-health-release.sh` exercises the release health contract.
This is separate from the test selections above and needs `bash` and `curl`.
