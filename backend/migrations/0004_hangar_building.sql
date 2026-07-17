ALTER TABLE "Player"
  ADD COLUMN IF NOT EXISTS "assignedHangar" INTEGER;

ALTER TABLE "GameSettings"
  ADD COLUMN IF NOT EXISTS "starterPropDefinitionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "PropDefinition" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "prefabId" TEXT NOT NULL,
  "costArc" INTEGER NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'decoration',
  "maxPerHangar" INTEGER,
  "allowRotateY" BOOLEAN NOT NULL DEFAULT true,
  "snapGridM" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PropDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlayerProp" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "propDefinitionId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerProp_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HangarPlacement" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "propDefinitionId" TEXT NOT NULL,
  "right" DOUBLE PRECISION NOT NULL,
  "up" DOUBLE PRECISION NOT NULL,
  "forward" DOUBLE PRECISION NOT NULL,
  "rotationY" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HangarPlacement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlayerProp_playerId_propDefinitionId_key"
  ON "PlayerProp"("playerId", "propDefinitionId");
CREATE INDEX IF NOT EXISTS "PlayerProp_playerId_idx" ON "PlayerProp"("playerId");
CREATE INDEX IF NOT EXISTS "PlayerProp_propDefinitionId_idx" ON "PlayerProp"("propDefinitionId");
CREATE INDEX IF NOT EXISTS "HangarPlacement_playerId_idx" ON "HangarPlacement"("playerId");
CREATE INDEX IF NOT EXISTS "HangarPlacement_propDefinitionId_idx" ON "HangarPlacement"("propDefinitionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'PlayerProp_playerId_fkey' AND table_name = 'PlayerProp'
  ) THEN
    ALTER TABLE "PlayerProp"
      ADD CONSTRAINT "PlayerProp_playerId_fkey"
      FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'PlayerProp_propDefinitionId_fkey' AND table_name = 'PlayerProp'
  ) THEN
    ALTER TABLE "PlayerProp"
      ADD CONSTRAINT "PlayerProp_propDefinitionId_fkey"
      FOREIGN KEY ("propDefinitionId") REFERENCES "PropDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'HangarPlacement_playerId_fkey' AND table_name = 'HangarPlacement'
  ) THEN
    ALTER TABLE "HangarPlacement"
      ADD CONSTRAINT "HangarPlacement_playerId_fkey"
      FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'HangarPlacement_propDefinitionId_fkey' AND table_name = 'HangarPlacement'
  ) THEN
    ALTER TABLE "HangarPlacement"
      ADD CONSTRAINT "HangarPlacement_propDefinitionId_fkey"
      FOREIGN KEY ("propDefinitionId") REFERENCES "PropDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "PropDefinition" (
  "id", "name", "description", "prefabId", "costArc", "category",
  "maxPerHangar", "allowRotateY", "snapGridM", "createdAt", "updatedAt"
)
SELECT
  'starter-hangar-crate',
  'Hangar Crate',
  'Standard cargo crate for hangar storage and workshop staging.',
  'hangar-crate-01',
  250,
  'utility',
  8,
  true,
  0.5,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PropDefinition" WHERE "id" = 'starter-hangar-crate');

INSERT INTO "PropDefinition" (
  "id", "name", "description", "prefabId", "costArc", "category",
  "maxPerHangar", "allowRotateY", "snapGridM", "createdAt", "updatedAt"
)
SELECT
  'starter-hangar-lamp',
  'Hangar Lamp',
  'Overhead-style work lamp for hangar bays.',
  'hangar-lamp-01',
  180,
  'utility',
  6,
  true,
  0.5,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PropDefinition" WHERE "id" = 'starter-hangar-lamp');

INSERT INTO "PropDefinition" (
  "id", "name", "description", "prefabId", "costArc", "category",
  "maxPerHangar", "allowRotateY", "snapGridM", "createdAt", "updatedAt"
)
SELECT
  'starter-hangar-bench',
  'Hangar Bench',
  'Crew seating bench for maintenance breaks.',
  'hangar-bench-01',
  320,
  'furniture',
  4,
  true,
  0.5,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PropDefinition" WHERE "id" = 'starter-hangar-bench');

INSERT INTO "PropDefinition" (
  "id", "name", "description", "prefabId", "costArc", "category",
  "maxPerHangar", "allowRotateY", "snapGridM", "createdAt", "updatedAt"
)
SELECT
  'starter-hangar-panel',
  'Wall Panel',
  'Modular wall panel for bay customization.',
  'hangar-panel-01',
  420,
  'decoration',
  6,
  true,
  0.5,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PropDefinition" WHERE "id" = 'starter-hangar-panel');

INSERT INTO "PropDefinition" (
  "id", "name", "description", "prefabId", "costArc", "category",
  "maxPerHangar", "allowRotateY", "snapGridM", "createdAt", "updatedAt"
)
SELECT
  'starter-hangar-tool-rack',
  'Tool Rack',
  'Vertical tool rack for hangar maintenance gear.',
  'hangar-tool-rack-01',
  540,
  'utility',
  3,
  true,
  0.5,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PropDefinition" WHERE "id" = 'starter-hangar-tool-rack');

UPDATE "GameSettings"
SET "starterPropDefinitionIds" = ARRAY[
  'starter-hangar-crate',
  'starter-hangar-lamp',
  'starter-hangar-bench'
]::TEXT[]
WHERE "id" = 'singleton'
  AND COALESCE(array_length("starterPropDefinitionIds", 1), 0) = 0;
