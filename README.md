# comail-push-relay

Push Relay accepts JMAP push events over HTTP and forwards them to mail clients.
The pinned [Bulwark Relay](https://github.com/bulwarkmail/relay) dependency
handles storage, validation, push delivery, metrics, and logging. This adapter
supplies the HTTP routes and reports release health.

Pushes carry state references or message IDs. Clients fetch the messages
through their own JMAP sessions.

## Run locally

Use Node.js 20 or later. CI uses Node.js 22.23.4. Install the locked dependencies,
build the upstream package and adapter, then start the server on localhost.

```sh
npm ci --ignore-scripts
npm run build
HOST=127.0.0.1 npm start
```

From a second terminal, check that the server and subscription store respond.

```sh
curl -fsS http://127.0.0.1:3003/api/health
```

You can run this check with no push credentials. For FCM delivery, set
`FCM_SERVICE_ACCOUNT_JSON` or put the Firebase service account file at
`$PUSH_DATA_DIR/fcm-service-account.json`. The default path is
`./data/fcm-service-account.json`.

## Run in Docker

Compose mounts `./data` into the container and takes an existing Docker
network named `bulwark`. Create it with `docker network create bulwark` if
your Bulwark setup has yet to create it.

```sh
mkdir -p data
docker compose up -d
```

For FCM delivery, copy the service account file to
`data/fcm-service-account.json` before starting the container. Check health
with the same curl command as the local setup.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/push/register` | Mobile app stores its FCM token against an opaque `subscriptionId` |
| `POST` | `/api/push/register/web` | PWA stores a Web Push subscription (`endpoint` + `keys`) against an opaque `subscriptionId` |
| `DELETE` | `/api/push/register/:id` | Delete a subscription when a client logs out or is uninstalled |
| `GET` | `/api/push/verify/:id` | Poll for the JMAP `PushVerification` code |
| `GET` | `/api/push/active/:id` | `{ active }` indicates whether the subscription has forwarded a push or was registered in the last 10 minutes. An unknown ID returns `404` |
| `POST` | `/api/push/jmap/:id` | JMAP server posts `PushVerification`, `StateChange`, or `EmailPush` here. The relay uses the transport in the stored subscription |
| `GET` | `/api/push/vapid-public-key` | Returns the relay's VAPID public key so browsers can subscribe |
| `GET` | `/api/health` | Check that the server can read the subscription store |

## What it stores

Per `subscriptionId`: either an FCM token (mobile) or a Web Push
subscription (`endpoint` + `p256dh`/`auth` keys for the PWA), an optional
one-shot verification code, an optional free-form `accountLabel` (max 120
chars), and timestamps.

The store holds no user identity, no server URL, and no mail content.
Subscriptions without traffic for more than 90 days are evicted
automatically.

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3003` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP listen address |
| `PUSH_DATA_DIR` | `./data` | Where `subscriptions.json` and the FCM key live |
| `FCM_SERVICE_ACCOUNT_JSON` | unset | Inline JSON or an absolute path. Defaults to `$PUSH_DATA_DIR/fcm-service-account.json` |
| `VAPID_PUBLIC_KEY` | unset | Base64url-encoded P-256 public key for Web Push. Generate with `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | unset | Matching private key. Web Push is disabled if either VAPID var is missing |
| `VAPID_SUBJECT` | `mailto:postmaster@localhost` | `mailto:` or `https:` address where push services can reach the operator (RFC 8292) |

## Tests

`npm test` builds and runs upstream's test suite along with the adapter's
native Node tests. No credentials are required. See
[docs/testing.md](docs/testing.md) for test commands and what they cover.

## Releases

`npm run build` compiles the upstream TypeScript package and its
declarations before building the adapter. Update the immutable archive URL
in `package.json` and the lockfile together, then run the test suite.
Upstream source and license files remain in the installed dependency without
modification.

CI builds and tests the relay on `main`. When the commits call for a version
bump, CI publishes a versioned prerelease with `release.tar.gz` and
`release.sha256`. The archive contains `release.json` and `dist/` with the
compiled server, production dependencies, and package file. `comail-infra`
deploys the prerelease and marks it latest after deployment. To roll back,
use `comail-infra` to deploy an older retained release.

## License

Licensed under the GNU Affero General Public License v3.0 only. See
[LICENSE](LICENSE).

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) for local checks, signed commits,
review, native GitHub stacks, and PR attachments.
[AI_POLICY.md](AI_POLICY.md) adopts AI Allowed; disclosure of AI use is
optional. Report vulnerabilities through [SECURITY.md](SECURITY.md).
