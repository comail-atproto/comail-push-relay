# comail-push-relay

comail's fork of [Bulwark Relay](https://github.com/bulwarkmail/relay), the
privacy-preserving push notification relay for
[Bulwark Webmail](https://github.com/bulwarkmail/webmail). It terminates JMAP
`PushSubscription` pushes from the mail server and forwards an opaque wake-up
to the client — FCM for mobile, Web Push for the PWA — so clients fetch new
mail over their own JMAP connection. The relay never sees mail content: only
opaque tokens, state-id hashes, and timing.

This fork backs [comail](https://comail.at) Inbox and adds, beyond upstream:

- **Web Push (VAPID) delivery** for browser/PWA clients alongside FCM
- **Opaque access-approval wake-ups** — a bearer-authenticated, server-only
  dispatch endpoint so one browser `PushSubscription`/VAPID key pair can carry
  both mail and access-approval notifications safely
- A **subscription liveness probe** so clients can reap dead subscriptions

Upstream: https://github.com/bulwarkmail/relay — licensed AGPL-3.0-only, as is
this fork. Bulwark's name and branding belong to the Bulwark project.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/push/register` | Mobile app stores its FCM token against an opaque `subscriptionId` |
| `POST` | `/api/push/register/web` | PWA stores a Web Push subscription (`endpoint` + `keys`) against an opaque `subscriptionId` |
| `DELETE` | `/api/push/register/:id` | Tear down mapping (logout / uninstall) |
| `GET` | `/api/push/verify/:id` | Poll for the JMAP `PushVerification` code |
| `GET` | `/api/push/active/:id` | Liveness probe — `{ active }` if the subscription has forwarded a push (or was just registered); `404` if unknown. Clients use it to reap dead leftover subscriptions without touching live ones |
| `POST` | `/api/push/jmap/:id` | JMAP server posts `PushVerification` or `StateChange` here — relay dispatches FCM or Web Push depending on the stored record |
| `POST` | `/api/push/internal/access-approval` | Bearer-authenticated, server-only opaque access-approval wake-up dispatch |
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
| `ACCESS_APPROVAL_DISPATCH_TOKEN` | unset | Minimum 32-character bearer for the server-only access-approval dispatch endpoint; unset disables that endpoint |

## License

Licensed under the GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE).
