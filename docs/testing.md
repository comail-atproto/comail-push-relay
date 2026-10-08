# Testing

The suite uses the native Node test runner. Each behavior lives at one layer,
and every test command builds first so tests run against current `src`.

## Layers

| Layer | Selection | Covers |
| --- | --- | --- |
| Unit | `npm run test:unit` | Web Push transport/error matrix against an injected recording transport; the required `ci` result-check policy. In-process, no credentials. |
| Component | `npm run test:component` | The real relay process against a temporary store: readiness, subscription lifecycle, registration validation, access-approval authorization. |
| All | `npm test` | Both selections, `node --test test/*.test.mjs`. |

## Prerequisites

```sh
npm ci --ignore-scripts   # first checkout
npm run build             # tsc; the selections also build
```

Node >= 20.

## Determinism

- The component helper starts the server with `PORT=0` and waits for the bound
  listen address the server logs, so no port is reserved and released and no
  fixture port reservation race occurs.
- Each case owns a fresh temporary `PUSH_DATA_DIR`; the helper deletes only
  directories it created.
- The helper strips inherited `VAPID_*`, `FCM_SERVICE_ACCOUNT_JSON` and
  `ACCESS_APPROVAL_DISPATCH_TOKEN`; it also clears inherited release identity
  and data directory settings. Cases opt into synthetic configuration explicitly.
- Health probes are bounded with `AbortSignal.timeout`.
- VAPID configuration is read once per module instance. The absent-key case
  therefore lives in `test/transport-unconfigured.test.mjs`, which the runner
  isolates in its own process, rather than mutating a configured module.

## Failure artifacts

Command exit codes are the gate. A process that fails to spawn, exits early, or
never becomes ready fails with the child's exit code/signal and a bounded tail
of its stdout/stderr.

## Live scope

None of these selections require live push credentials, FCM, or APNs access.

## Runtime checks

`bash scripts/test-health-release.sh` exercises the release health contract.
This is separate from the test selections above and needs `bash` and `curl`.
