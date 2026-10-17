# comail-push-relay

Comail’s HTTP adapter for [Bulwark Relay](https://github.com/bulwarkmail/relay).
It uses a pinned, unmodified upstream dependency for subscription storage,
validation, FCM and Web Push delivery, metrics, and logging. Comail keeps the
HTTP routes and release health reporting here.

Mail pushes contain state references or message IDs. Clients fetch message
content through their own JMAP sessions.

`npm run build` compiles the upstream TypeScript package and its declarations
before building the adapter. Update the immutable archive URL in `package.json`
and its lockfile together, then run the compatibility tests. Upstream’s source
and license remain in the installed dependency; no build step rewrites them.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/push/register` | Mobile app stores its FCM token against an opaque `subscriptionId` |
| `POST` | `/api/push/register/web` | PWA stores a Web Push subscription (`endpoint` + `keys`) against an opaque `subscriptionId` |
| `DELETE` | `/api/push/register/:id` | Tear down mapping (logout / uninstall) |
| `GET` | `/api/push/verify/:id` | Poll for the JMAP `PushVerification` code |
| `GET` | `/api/push/active/:id` | Liveness probe — `{ active }` if the subscription has forwarded a push (or was just registered); `404` if unknown. Clients use it to reap dead leftover subscriptions without touching live ones |
| `POST` | `/api/push/jmap/:id` | JMAP server posts `PushVerification`, `StateChange`, or `EmailPush` here — relay dispatches FCM or Web Push depending on the stored record |
| `GET` | `/api/push/vapid-public-key` | Returns the relay's VAPID public key so browsers can subscribe |
| `GET` | `/api/health` | Liveness probe |

## What it stores

Per `subscriptionId`: either an FCM token (mobile) or a Web Push subscription
(`endpoint` + `p256dh`/`auth` keys for the PWA), an optional one-shot
verification code, an optional free-form `accountLabel` (max 120 chars), and
timestamps. No user identity, no server URL, no mail content. Subscriptions
older than 90 days without traffic are evicted automatically.

## Run locally

```sh
npm install
echo '{...}' > data/fcm-service-account.json   # Firebase service account JSON
npm run dev
```

## Run in Docker

```sh
mkdir -p data
cp path/to/fcm-service-account.json data/
docker compose up -d
```

## Tests

`npm test` builds and runs upstream’s tests and the adapter’s native Node tests. See
[docs/testing.md](docs/testing.md) for the unit and component selections,
determinism guarantees, and failure artifacts.

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3003` | HTTP listen port |
| `HOST` | `0.0.0.0` | |
| `PUSH_DATA_DIR` | `./data` | Where `subscriptions.json` and the FCM key live |
| `FCM_SERVICE_ACCOUNT_JSON` | unset | Either the full JSON inline or an absolute path — falls back to `$PUSH_DATA_DIR/fcm-service-account.json` |
| `VAPID_PUBLIC_KEY` | unset | Base64url-encoded P-256 public key for Web Push. Generate with `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | unset | Matching private key. Web Push is disabled if either VAPID var is missing |
| `VAPID_SUBJECT` | `mailto:postmaster@localhost` | `mailto:` or `https:` contact the push services can reach if the relay misbehaves (RFC 8292) |

## License

Licensed under the GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE).

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) for local checks, signed commits, review,
native GitHub stacks, and PR attachments. [AI_POLICY.md](AI_POLICY.md) adopts
AI Allowed; disclosure of AI use is optional. Report vulnerabilities through
[SECURITY.md](SECURITY.md). Track work in GitHub and Linear; Chainlink is retired.

## Automatic deployment controls

Automatic production deployments require both the org variable
`COMAIL_ORG_DEPLOY_PRODUCTION_ENABLED` and this repository's
`COMAIL_DEPLOY_PRODUCTION_ENABLED` to be `true`. Missing or other values block
automatic deployment. Manual release and rollback keep their existing protected
`main` workflow. See the [deployment controls and migration guide](https://github.com/comail-atproto/comail-infra/blob/main/docs/app-releases.md#deployment-controls).

This workflow has no staging target; keep `COMAIL_DEPLOY_STAGING_ENABLED=false`.

## Deployment status

The deployment script reports the deployed version, build ID, CI run, health
checks, and final result to the deployment dashboard. Reporting runs after the
normal deployment and rollback commands. Older hosts skip it; a reporting error
warns without changing the deployment result. It sends deployment metadata only,
without credentials, private mail, or raw logs.

CI can report a check in progress by running the existing deployment command with
`observe` and setting `RELEASE_OBSERVATION_STAGE`, `RELEASE_OBSERVATION_RESULT`,
and `RELEASE_OBSERVATION_SECONDS`. Stages are `health`, `mail`, `monitoring`, or
`complete`; results are `running`, `success`, `failure`, or `cancelled`.
The host checks the build ID and deployment sequence before recording the report.
A successful health check does not count as mail acceptance.
