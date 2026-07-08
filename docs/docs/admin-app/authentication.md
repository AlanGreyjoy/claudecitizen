---
sidebar_position: 3
title: Authentication
description: How admin login, sessions, and environment configuration work.
---

# Authentication

Admin access uses a **single shared operator account** configured through server environment variables — not player Discord or email/password auth.

## Environment variables

Set these in `server/.env` (see `server/.env.example`):

| Variable | Required | Description |
| --- | --- | --- |
| `ADMIN_EMAIL` | Yes | Operator login email. Defaults to `admin@claude-citizen.com` if unset. |
| `ADMIN_PASSWORD` | Yes | Plain-text operator password. Login is rejected if this is empty. |
| `ADMIN_SESSION_SECRET` | Recommended | JWT signing secret for admin sessions. Falls back to `JWT_ACCESS_SECRET` if unset. |

Related server settings that affect cookies:

| Variable | Default | Description |
| --- | --- | --- |
| `CLIENT_ORIGIN` | `http://localhost:4173` | Allowed browser origin for CORS and cookie scope |
| `COOKIE_SAME_SITE` | `lax` | SameSite attribute on `cc_admin` |
| `COOKIE_SECURE` | `false` | Set `true` in production behind HTTPS |

## Login flow

1. The client `POST`s `{ email, password }` to `/admin/session`.
2. The server normalizes the email (trim + lowercase) and compares it to `ADMIN_EMAIL` using a timing-safe string compare for the password.
3. On success, the server issues a JWT (`typ: 'admin'`, 12-hour expiry) and sets it as the **`cc_admin`** HTTP-only cookie.
4. The response body returns `{ email }` for display in the Admin UI header.

Subsequent requests include the cookie automatically. The `AdminGuard` on protected routes verifies the JWT signature, expiry, token type, and that `sub` matches the configured admin email.

## Session lifecycle

| Action | Endpoint | Result |
| --- | --- | --- |
| Check session | `GET /admin/session` | Returns `{ email }` if cookie is valid; `401` otherwise |
| Log out | `DELETE /admin/session` | Clears `cc_admin` cookie (`204`) |

The client treats any `401` from an admin API call as an expired session and returns you to the login screen.

## Security model

- **One operator identity** — there is no multi-admin RBAC yet. Everyone who knows `ADMIN_PASSWORD` has full catalog access.
- **Separate from player auth** — player sessions use different cookies and JWT claims. Admin and player auth do not overlap.
- **Server-side only secrets** — never put `ADMIN_PASSWORD` or `ADMIN_SESSION_SECRET` in client code or Vite env vars.
- **Read-only users tab** — even with admin access, the Users section cannot edit accounts from the UI today. Catalog and settings endpoints are writable.

## Operational guidance

- Use a long random `ADMIN_PASSWORD` in any shared or deployed environment.
- Rotate `ADMIN_SESSION_SECRET` if you suspect a session token leak — this invalidates all existing admin sessions.
- Restrict who can reach `?boot=admin` on public deployments (VPN, IP allowlist, or separate admin hostname).

For endpoint details, see [API reference](./api-reference).
