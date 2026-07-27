---
sidebar_position: 9
title: Payments and the Item Mall
description: Configure Stripe, sell AsteronCredits, and curate the in-game Item Mall.
---

# Payments and the Item Mall

AsteronEngine ships a complete real-money monetization path. Players buy **AsteronCredits (AC)** with Stripe, then spend them in the **Item Mall** — an in-game storefront you curate from the Server console.

Nothing here is hard-coded. Every pack, price, and listing is a database row you own, so a game built on this engine sets its own economy without touching engine source.

## Two currencies, on purpose

| Currency | Column | Earned by | Spent on |
| --- | --- | --- | --- |
| **ARC** (Asteron Reserve Credits) | `Player.arcBalance` | Gameplay, starter grants | Station shops, ships, props, hangar building |
| **AsteronCredits (AC)** | `Player.creditBalance` | Real-money purchase, operator grant, in-game award | Item Mall only |

Keeping them separate means real-money value never becomes farmable, and mall prices stay independent of the ARC economy you tune for gameplay.

Every AC movement is written to `AsteronCreditLedger` in the same transaction that changes the balance. That table is append-only and is the complete history of a player's balance — purchases, spends, operator grants, refunds, and chargebacks alike.

## Setup

You need a Stripe account. Everything below works in Stripe **test mode** first; no real money moves until you switch to live keys.

### 1. Set the encryption key on the server

The Stripe secret key is stored in your database, so it is encrypted at rest with AES-256-GCM. The wrapping key lives in the environment and never in the database, which means a database dump alone is not enough to spend money.

```bash
openssl rand -base64 32
```

Put the result in `backend/.env`:

```bash
PAYMENTS_ENCRYPTION_KEY=<the base64 value>
```

Restart the backend. Until this is set, the console refuses to store Stripe secrets and says so.

:::warning
Losing this key makes stored Stripe secrets unrecoverable — you would re-paste them. Rotating it does **not** re-encrypt existing rows; save the new secrets again from the console afterwards.
:::

### 2. Paste your Stripe secret key

Open the editor, go to the **Server** tab, sign in as operator, and open **Commerce → Payments**.

Paste your secret key (`sk_test_…` while testing) and save. The field is write-only: reload the page and you will see `sk_••••4242`, never the full value. Leave it blank on later saves to keep what is stored.

### 3. Register the webhook

The Payments panel shows the exact URL to register, with a copy button. In the Stripe dashboard go to **Developers → Webhooks → Add endpoint**, paste it, and subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `checkout.session.async_payment_failed`
- `charge.refunded`
- `charge.dispute.created`

Copy the signing secret Stripe gives you (`whsec_…`) into the **Webhook signing secret** field and save.

:::danger
Credits are granted **only** when the webhook fires. Without a webhook secret, players can be charged and never paid. Configure it before taking real money.
:::

For local testing, skip the dashboard and run:

```bash
stripe listen --forward-to localhost:3000/payments/stripe/webhook
```

Paste the `whsec_` value it prints into the same field.

### 4. Set redirect URLs (optional)

Where Stripe sends the player after paying or cancelling. Leave blank to fall back to your configured client origin.

## Environment variables instead of the console

If you manage secrets outside the database — Kubernetes secrets, a vault sidecar, CI-injected env — set these instead:

| Variable | Purpose |
| --- | --- |
| `PAYMENTS_ENCRYPTION_KEY` | Wraps console-stored secrets. Required before the console can store anything. |
| `STRIPE_SECRET_KEY` | Overrides the console-stored secret key. |
| `STRIPE_WEBHOOK_SECRET` | Overrides the console-stored webhook secret. |

**Environment always wins.** When a variable is set, the Payments panel says so and treats any console-entered value as inactive. In production the server refuses to boot if a Stripe secret is configured without an encryption key.

## Credit packs

**Commerce → Credit Packs** manages the bundles players buy. The engine seeds a five-tier ladder at 100 AC per US dollar, with the bonus growing by tier:

| Pack | Price | Credits | Bonus |
| --- | --- | --- | --- |
| Credit Bag | $4.99 | 500 | — |
| Credit Crate | $9.99 | 1,050 | +5% |
| Credit Chest | $24.99 | 2,750 | +10% |
| Credit Vault | $49.99 | 5,750 | +15% |
| Credit Hoard | $99.99 | 12,000 | +20% |

Edit, reprice, deactivate, or replace all of these — they are only a starting point. The list view shows computed AC-per-dollar so you can check the ladder stays monotonic as you edit.

**Stripe price ID** is optional. Leave it blank and the engine creates an inline price per checkout; set it to a `price_…` from your Stripe dashboard if you prefer prices managed there.

Removing a pack that has purchase history deactivates it instead of deleting it, so the purchase log stays auditable.

## Item Mall

**Commerce → Item Mall** curates what players can buy with credits. A listing is a layer over an existing item definition, so:

- Delisting an item never deletes it or changes its ARC price.
- The same item can sell for ARC at a station shop and for AC in the mall.

| Field | Meaning |
| --- | --- |
| Item | The `ItemDefinition` being sold. Fixed once the listing exists. |
| Price (AC) | What the player pays in AsteronCredits. |
| Category | Grouping label for the storefront. |
| Hold limit per player | Maximum quantity a player may hold. `0` means unlimited. |
| Featured | Highlights the card in the mall. |
| Live | Hides the listing without deleting it. |

**The mall currently sells consumables only.** That limit is enforced server-side in `backend/crates/server/src/mall.rs`, and the item picker only offers sellable types, so you cannot create a listing the purchase endpoint would reject.

## Granting credits by hand

Open any player from **Users**. The AsteronCredits card shows their balance, a grant form, and their full ledger.

Amounts may be negative to claw credits back. Classify the movement as:

- **Grant** — support, compensation, a refund you handled manually.
- **Award** — a promotion or in-game prize.

The note you type is stored with the ledger entry.

## What players see

The Item Mall is a **Mall** tab on the HaloBand, so it is reachable anywhere in game. It shows the storefront, the player's AC balance, and the credit packs.

Buying credits opens hosted Stripe Checkout in the system browser — the desktop editor hands off through Electron, the web build opens a tab. Card details never touch engine code. After hand-off the panel polls for a few seconds so the balance updates without a reload, but the webhook remains the only thing that actually grants credits.

If you have not finished Stripe setup, the panel says credit purchases are unavailable rather than showing buttons that would fail.

## Refunds and chargebacks

`charge.refunded` and `charge.dispute.created` deduct the credits that were granted and mark the purchase `refunded` or `disputed`. A balance never goes negative — it clamps at zero, and the ledger records the full requested delta next to the real resulting balance so the gap stays visible.

## Verifying it works

1. Complete a test purchase with card `4242 4242 4242 4242`.
2. Confirm the balance rises and one ledger row appears.
3. Replay the webhook (`stripe events resend <id>`) — the balance must **not** move again. Fulfillment is keyed on the Stripe event id.
4. Send a request with a tampered signature — expect `401` and no database write.

## See also

- [API reference](./api-reference.md) — the `/admin/*` endpoints behind these panels
- [Item definitions](./item-definitions.md) — creating the items you list
- [Game settings](./game-settings.md) — starting ARC balance and starter grants
