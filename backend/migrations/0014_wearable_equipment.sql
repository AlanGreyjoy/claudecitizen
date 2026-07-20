CREATE TABLE IF NOT EXISTS "WearableDefinition" (
  "itemDefinitionId" TEXT NOT NULL,
  "wearableSlotType" TEXT NOT NULL,
  "occupiedSlotTypes" TEXT[] NOT NULL,
  "sidekickPartPresetId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WearableDefinition_pkey" PRIMARY KEY ("itemDefinitionId"),
  CONSTRAINT "WearableDefinition_itemDefinitionId_fkey"
    FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WearableDefinition_slot_check"
    CHECK ("wearableSlotType" IN ('head', 'torso', 'arms', 'legs', 'feet')),
  CONSTRAINT "WearableDefinition_occupied_check"
    CHECK (
      "occupiedSlotTypes" <@ ARRAY['head', 'torso', 'arms', 'legs', 'feet']::TEXT[]
      AND "wearableSlotType" = ANY("occupiedSlotTypes")
      AND cardinality(array_positions("occupiedSlotTypes", 'head')) <= 1
      AND cardinality(array_positions("occupiedSlotTypes", 'torso')) <= 1
      AND cardinality(array_positions("occupiedSlotTypes", 'arms')) <= 1
      AND cardinality(array_positions("occupiedSlotTypes", 'legs')) <= 1
      AND cardinality(array_positions("occupiedSlotTypes", 'feet')) <= 1
    ),
  CONSTRAINT "WearableDefinition_preset_check"
    CHECK ("sidekickPartPresetId" > 0)
);

INSERT INTO "WearableDefinition" (
  "itemDefinitionId",
  "wearableSlotType",
  "occupiedSlotTypes",
  "sidekickPartPresetId",
  "updatedAt"
)
SELECT "id", 'torso', ARRAY['torso', 'arms']::TEXT[], 932, CURRENT_TIMESTAMP
FROM "ItemDefinition"
WHERE "id" = 'starter-field-jacket'
ON CONFLICT ("itemDefinitionId") DO UPDATE SET
  "wearableSlotType" = EXCLUDED."wearableSlotType",
  "occupiedSlotTypes" = EXCLUDED."occupiedSlotTypes",
  "sidekickPartPresetId" = EXCLUDED."sidekickPartPresetId",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "WearableDefinition" (
  "itemDefinitionId",
  "wearableSlotType",
  "occupiedSlotTypes",
  "sidekickPartPresetId",
  "updatedAt"
)
SELECT "id", 'torso', ARRAY['torso']::TEXT[], 934, CURRENT_TIMESTAMP
FROM "ItemDefinition"
WHERE "id" = 'starter-light-vest'
ON CONFLICT ("itemDefinitionId") DO UPDATE SET
  "wearableSlotType" = EXCLUDED."wearableSlotType",
  "occupiedSlotTypes" = EXCLUDED."occupiedSlotTypes",
  "sidekickPartPresetId" = EXCLUDED."sidekickPartPresetId",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "ItemDefinition"
SET "description" = 'Light protective vest for station security and surface work.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'starter-light-vest';
