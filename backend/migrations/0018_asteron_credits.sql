-- AsteronCredits hard currency, Stripe-backed credit packs, and the Item Mall storefront.
-- ARC stays the earned soft currency; AsteronCredits are bought, granted, or awarded.

ALTER TABLE "Player"
  ADD COLUMN IF NOT EXISTS "creditBalance" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Player_creditBalance_check' AND table_name = 'Player'
  ) THEN
    ALTER TABLE "Player"
      ADD CONSTRAINT "Player_creditBalance_check" CHECK ("creditBalance" >= 0);
  END IF;
END $$;

-- Append-only audit trail. Every credit mutation writes exactly one row here.
CREATE TABLE IF NOT EXISTS "AsteronCreditLedger" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "delta" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "refType" TEXT,
  "refId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AsteronCreditLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AsteronCreditLedger_reason_check" CHECK (
    "reason" IN ('purchase', 'grant', 'refund', 'chargeback', 'spend', 'award')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "AsteronCreditLedger_idempotencyKey_key"
  ON "AsteronCreditLedger"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "AsteronCreditLedger_playerId_createdAt_idx"
  ON "AsteronCreditLedger"("playerId", "createdAt" DESC);

-- Operator-editable real-money packs. Seeded below; every value is theirs to change.
CREATE TABLE IF NOT EXISTS "CreditPack" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "credits" INTEGER NOT NULL,
  "bonusCredits" INTEGER NOT NULL DEFAULT 0,
  "priceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "stripePriceId" TEXT,
  "iconUrl" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditPack_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditPack_credits_check" CHECK ("credits" > 0),
  CONSTRAINT "CreditPack_bonusCredits_check" CHECK ("bonusCredits" >= 0),
  CONSTRAINT "CreditPack_priceCents_check" CHECK ("priceCents" > 0)
);

CREATE INDEX IF NOT EXISTS "CreditPack_active_sortOrder_idx"
  ON "CreditPack"("active", "sortOrder");

-- One row per checkout attempt. Fulfillment flips status to 'paid' from the webhook only.
CREATE TABLE IF NOT EXISTS "CreditPurchase" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "packId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'stripe',
  "providerSessionId" TEXT,
  "providerPaymentIntentId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "priceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "creditsGranted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditPurchase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditPurchase_status_check" CHECK (
    "status" IN ('pending', 'paid', 'failed', 'refunded', 'disputed')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "CreditPurchase_providerSessionId_key"
  ON "CreditPurchase"("providerSessionId");
CREATE INDEX IF NOT EXISTS "CreditPurchase_playerId_createdAt_idx"
  ON "CreditPurchase"("playerId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "CreditPurchase_status_idx" ON "CreditPurchase"("status");
CREATE INDEX IF NOT EXISTS "CreditPurchase_providerPaymentIntentId_idx"
  ON "CreditPurchase"("providerPaymentIntentId");

-- Storefront layer over ItemDefinition. Delisting never touches the item itself.
CREATE TABLE IF NOT EXISTS "MallListing" (
  "id" TEXT NOT NULL,
  "itemDefinitionId" TEXT NOT NULL,
  "priceCredits" INTEGER NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'consumable',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "limitPerPlayer" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MallListing_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MallListing_priceCredits_check" CHECK ("priceCredits" >= 0),
  CONSTRAINT "MallListing_limitPerPlayer_check" CHECK (
    "limitPerPlayer" IS NULL OR "limitPerPlayer" > 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "MallListing_itemDefinitionId_key"
  ON "MallListing"("itemDefinitionId");
CREATE INDEX IF NOT EXISTS "MallListing_active_sortOrder_idx"
  ON "MallListing"("active", "sortOrder");

-- Singleton provider config. Secrets are AES-256-GCM ciphertext, never plaintext.
CREATE TABLE IF NOT EXISTS "PaymentProvider" (
  "id" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'test',
  "secretKeyCiphertext" BYTEA,
  "secretKeyLast4" TEXT,
  "webhookSecretCiphertext" BYTEA,
  "successUrl" TEXT NOT NULL DEFAULT '',
  "cancelUrl" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentProvider_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentProvider_mode_check" CHECK ("mode" IN ('test', 'live'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'AsteronCreditLedger_playerId_fkey'
      AND table_name = 'AsteronCreditLedger'
  ) THEN
    ALTER TABLE "AsteronCreditLedger"
      ADD CONSTRAINT "AsteronCreditLedger_playerId_fkey"
      FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CreditPurchase_playerId_fkey' AND table_name = 'CreditPurchase'
  ) THEN
    ALTER TABLE "CreditPurchase"
      ADD CONSTRAINT "CreditPurchase_playerId_fkey"
      FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CreditPurchase_packId_fkey' AND table_name = 'CreditPurchase'
  ) THEN
    ALTER TABLE "CreditPurchase"
      ADD CONSTRAINT "CreditPurchase_packId_fkey"
      FOREIGN KEY ("packId") REFERENCES "CreditPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'MallListing_itemDefinitionId_fkey' AND table_name = 'MallListing'
  ) THEN
    ALTER TABLE "MallListing"
      ADD CONSTRAINT "MallListing_itemDefinitionId_fkey"
      FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "PaymentProvider" ("id", "mode", "successUrl", "cancelUrl", "updatedAt")
VALUES ('stripe', 'test', '', '', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Baseline ladder: 100 AC per USD, bonus grows with tier.
INSERT INTO "CreditPack" (
  "id", "name", "description", "credits", "bonusCredits",
  "priceCents", "currency", "sortOrder", "active", "updatedAt"
)
VALUES
  (
    'asteron-credit-bag',
    'Credit Bag',
    'A pocketful of AsteronCredits to get you started.',
    500, 0, 499, 'usd', 1, true, CURRENT_TIMESTAMP
  ),
  (
    'asteron-credit-crate',
    'Credit Crate',
    'A sealed crate of AsteronCredits. Includes a 5% bonus.',
    1000, 50, 999, 'usd', 2, true, CURRENT_TIMESTAMP
  ),
  (
    'asteron-credit-chest',
    'Credit Chest',
    'A reinforced chest of AsteronCredits. Includes a 10% bonus.',
    2500, 250, 2499, 'usd', 3, true, CURRENT_TIMESTAMP
  ),
  (
    'asteron-credit-vault',
    'Credit Vault',
    'A vault-grade cache of AsteronCredits. Includes a 15% bonus.',
    5000, 750, 4999, 'usd', 4, true, CURRENT_TIMESTAMP
  ),
  (
    'asteron-credit-hoard',
    'Credit Hoard',
    'The largest AsteronCredit consignment we ship. Includes a 20% bonus.',
    10000, 2000, 9999, 'usd', 5, true, CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO NOTHING;

-- Seed the mall over consumables that already exist in the catalog.
INSERT INTO "MallListing" (
  "id", "itemDefinitionId", "priceCredits", "category",
  "sortOrder", "featured", "active", "limitPerPlayer", "updatedAt"
)
SELECT
  seed."id", seed."itemDefinitionId", seed."priceCredits", seed."category",
  seed."sortOrder", seed."featured", seed."active", seed."limitPerPlayer", CURRENT_TIMESTAMP
FROM (
  VALUES
    ('mall-station-hot-meal', 'station-hot-meal', 60, 'consumable', 1, true, true, NULL::INTEGER),
    ('mall-station-bottled-water', 'station-bottled-water', 35, 'consumable', 2, false, true, NULL::INTEGER),
    ('mall-starter-ration-pack', 'starter-ration-pack', 45, 'consumable', 3, false, true, NULL::INTEGER)
) AS seed (
  "id", "itemDefinitionId", "priceCredits", "category",
  "sortOrder", "featured", "active", "limitPerPlayer"
)
WHERE EXISTS (
  SELECT 1 FROM "ItemDefinition" WHERE "ItemDefinition"."id" = seed."itemDefinitionId"
)
ON CONFLICT ("id") DO NOTHING;
