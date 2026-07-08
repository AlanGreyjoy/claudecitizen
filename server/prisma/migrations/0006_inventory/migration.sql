ALTER TABLE "GameSettings"
  ADD COLUMN IF NOT EXISTS "starterItemDefinitionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "ItemDefinition" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "itemType" TEXT NOT NULL,
  "subType" TEXT NOT NULL DEFAULT 'generic',
  "prefabId" TEXT,
  "iconUrl" TEXT,
  "stackMax" INTEGER NOT NULL DEFAULT 99,
  "costArc" INTEGER NOT NULL DEFAULT 0,
  "rarity" TEXT NOT NULL DEFAULT 'common',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ItemDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlayerItem" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "itemDefinitionId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlayerItem_playerId_itemDefinitionId_key"
  ON "PlayerItem"("playerId", "itemDefinitionId");
CREATE INDEX IF NOT EXISTS "PlayerItem_playerId_idx" ON "PlayerItem"("playerId");
CREATE INDEX IF NOT EXISTS "PlayerItem_itemDefinitionId_idx" ON "PlayerItem"("itemDefinitionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'PlayerItem_playerId_fkey' AND table_name = 'PlayerItem'
  ) THEN
    ALTER TABLE "PlayerItem"
      ADD CONSTRAINT "PlayerItem_playerId_fkey"
      FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'PlayerItem_itemDefinitionId_fkey' AND table_name = 'PlayerItem'
  ) THEN
    ALTER TABLE "PlayerItem"
      ADD CONSTRAINT "PlayerItem_itemDefinitionId_fkey"
      FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "ItemDefinition" (
  "id",
  "name",
  "description",
  "itemType",
  "subType",
  "prefabId",
  "iconUrl",
  "stackMax",
  "costArc",
  "rarity",
  "updatedAt"
)
VALUES
  (
    'starter-ration-pack',
    'Field Ration Pack',
    'Standard-issue nutrient ration for long hauls.',
    'consumable',
    'food',
    NULL,
    NULL,
    20,
    50,
    'common',
    CURRENT_TIMESTAMP
  ),
  (
    'starter-water-flask',
    'Water Flask',
    'Reusable hydration flask with a built-in purifier.',
    'consumable',
    'drink',
    NULL,
    NULL,
    10,
    25,
    'common',
    CURRENT_TIMESTAMP
  ),
  (
    'starter-field-jacket',
    'Field Jacket',
    'Lightweight jacket for station and surface wear.',
    'clothing',
    'jacket',
    NULL,
    NULL,
    1,
    120,
    'common',
    CURRENT_TIMESTAMP
  ),
  (
    'starter-sidearm',
    'Asteron Sidearm',
    'Compact sidearm. Equip systems coming in a future update.',
    'weapon',
    'pistol',
    NULL,
    NULL,
    1,
    0,
    'uncommon',
    CURRENT_TIMESTAMP
  ),
  (
    'starter-light-vest',
    'Light Vest',
    'Basic protective vest. Armor systems coming in a future update.',
    'armor',
    'light',
    NULL,
    NULL,
    1,
    0,
    'uncommon',
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO NOTHING;

UPDATE "GameSettings"
SET "starterItemDefinitionIds" = ARRAY[
  'starter-ration-pack',
  'starter-water-flask',
  'starter-field-jacket'
]::TEXT[]
WHERE "id" = 'singleton'
  AND COALESCE(array_length("starterItemDefinitionIds", 1), 0) = 0;
