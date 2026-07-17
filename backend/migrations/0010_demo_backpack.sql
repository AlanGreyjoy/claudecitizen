-- Seed a purchasable backpack for Outfitters (Back category).
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
VALUES (
  'demo-backpack',
  'Demo Backpack',
  'Field pack with rifle sockets. Equip from Inventory (I) to unlock secondary rifle capacity.',
  'backpack',
  'field',
  'demo-backpack',
  NULL,
  1,
  200,
  'common',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "BackpackDefinition" (
  "itemDefinitionId",
  "capacityLiters",
  "emptyMassKg",
  "updatedAt"
)
VALUES (
  'demo-backpack',
  48,
  2.5,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("itemDefinitionId") DO NOTHING;
