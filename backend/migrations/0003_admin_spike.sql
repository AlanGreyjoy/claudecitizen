ALTER TABLE "Player"
  ADD COLUMN IF NOT EXISTS "arcBalance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "starterLoadoutGrantedAt" TIMESTAMP(3);

ALTER TABLE "Ship"
  ADD COLUMN IF NOT EXISTS "shipDefinitionId" TEXT;

CREATE TABLE IF NOT EXISTS "ShipDefinition" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "prefabId" TEXT NOT NULL,
  "costArc" INTEGER NOT NULL,
  "maxHp" DOUBLE PRECISION NOT NULL,
  "maxShields" DOUBLE PRECISION NOT NULL,
  "shieldRegenPerSec" DOUBLE PRECISION NOT NULL,
  "maxSpeedMps" DOUBLE PRECISION NOT NULL,
  "throttleAccelMps2" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShipDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GameSettings" (
  "id" TEXT NOT NULL,
  "startingArcBalance" INTEGER NOT NULL DEFAULT 0,
  "starterShipDefinitionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GameSettings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Ship_shipDefinitionId_idx" ON "Ship"("shipDefinitionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'Ship_shipDefinitionId_fkey'
      AND table_name = 'Ship'
  ) THEN
    ALTER TABLE "Ship"
      ADD CONSTRAINT "Ship_shipDefinitionId_fkey"
      FOREIGN KEY ("shipDefinitionId") REFERENCES "ShipDefinition"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "ShipDefinition" (
  "id",
  "name",
  "description",
  "prefabId",
  "costArc",
  "maxHp",
  "maxShields",
  "shieldRegenPerSec",
  "maxSpeedMps",
  "throttleAccelMps2",
  "createdAt",
  "updatedAt"
)
SELECT
  'starter-phobos-starhopper',
  'Phobos Starhopper',
  'Entry-grade utility shuttle cleared for new citizens and short-haul orbital work.',
  'phobos-starhopper',
  58000,
  1000,
  500,
  25,
  100,
  308,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "ShipDefinition" WHERE "id" = 'starter-phobos-starhopper'
);

INSERT INTO "GameSettings" (
  "id",
  "startingArcBalance",
  "starterShipDefinitionIds",
  "createdAt",
  "updatedAt"
)
SELECT
  'singleton',
  25000,
  ARRAY['starter-phobos-starhopper']::TEXT[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "GameSettings" WHERE "id" = 'singleton'
);
