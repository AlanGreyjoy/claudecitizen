-- Consumable restore metadata for hunger/thirst, plus shop-priced provisions.

UPDATE "ItemDefinition"
SET
  "metadata" = jsonb_build_object(
    'hungerRestore01', 0.35,
    'thirstRestore01', 0.0
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'starter-ration-pack'
  AND ("metadata" IS NULL OR NOT ("metadata" ? 'hungerRestore01'));

UPDATE "ItemDefinition"
SET
  "metadata" = jsonb_build_object(
    'hungerRestore01', 0.0,
    'thirstRestore01', 0.5
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'starter-water-flask'
  AND ("metadata" IS NULL OR NOT ("metadata" ? 'thirstRestore01'));

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
    'station-hot-meal',
    'Station Hot Meal',
    'Tray service from the mess. Restores a solid chunk of hunger.',
    'consumable',
    'food',
    NULL,
    NULL,
    10,
    75,
    'common',
    '{"hungerRestore01": 0.55, "thirstRestore01": 0.05}'::jsonb,
    CURRENT_TIMESTAMP
  ),
  (
    'station-bottled-water',
    'Bottled Water',
    'Sealed station water. Reliable thirst recovery on the go.',
    'consumable',
    'drink',
    NULL,
    NULL,
    15,
    40,
    'common',
    '{"hungerRestore01": 0.0, "thirstRestore01": 0.65}'::jsonb,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO NOTHING;
