-- Persisted player health reserve + pharmacy medical consumables.

ALTER TABLE "Player"
  ADD COLUMN IF NOT EXISTS "healthReserve" DOUBLE PRECISION NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Player_healthReserve_check'
  ) THEN
    ALTER TABLE "Player" ADD CONSTRAINT "Player_healthReserve_check"
      CHECK ("healthReserve" >= 0 AND "healthReserve" <= 1);
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
  "metadata",
  "updatedAt"
)
VALUES
  (
    'station-heal-pill',
    'Heal Pill',
    'Station pharmacy tablet. Restores a quarter of integrity.',
    'consumable',
    'medical',
    NULL,
    NULL,
    20,
    60,
    'common',
    '{"healthRestore01": 0.25}'::jsonb,
    CURRENT_TIMESTAMP
  ),
  (
    'station-medpen',
    'MedPen',
    'Single-use field injector. Restores half of integrity.',
    'consumable',
    'medical',
    NULL,
    NULL,
    10,
    120,
    'common',
    '{"healthRestore01": 0.5}'::jsonb,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO NOTHING;
