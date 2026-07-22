-- Demo Weapon Combat stock. One inventory unit is one round.

INSERT INTO "ItemDefinition" (
  "id", "name", "description", "itemType", "subType", "prefabId", "iconUrl",
  "stackMax", "costArc", "rarity", "updatedAt"
)
VALUES
  (
    'ammo-rifle-556', '5.56 Ballistic Round',
    'Standard rifle ammunition sold by the round.',
    'ammo', 'rifle-556', NULL, NULL, 240, 2, 'common', CURRENT_TIMESTAMP
  ),
  (
    'ammo-handgun-9mm', '9mm Ballistic Round',
    'Compact sidearm ammunition sold by the round.',
    'ammo', 'handgun-9mm', NULL, NULL, 180, 1, 'common', CURRENT_TIMESTAMP
  ),
  (
    'assault-01', 'Assault 01',
    'Select-fire security rifle with a thirty-round magazine.',
    'weapon', 'rifle', 'assault-01', NULL, 1, 4800, 'uncommon', CURRENT_TIMESTAMP
  ),
  (
    'twin-horned-pistol', 'Twin Horned Pistol',
    'Compact semi-automatic handgun for station and shipboard defense.',
    'weapon', 'handgun', 'twin-horned-pistol', NULL, 1, 2200, 'uncommon', CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "itemType" = EXCLUDED."itemType",
  "subType" = EXCLUDED."subType",
  "prefabId" = EXCLUDED."prefabId",
  "stackMax" = EXCLUDED."stackMax",
  "costArc" = EXCLUDED."costArc",
  "rarity" = EXCLUDED."rarity",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "ItemDefinition"
SET "description" = 'Compact semi-automatic sidearm configured for 9mm ammunition.',
    "subType" = 'handgun',
    "prefabId" = 'twin-horned-pistol',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'starter-sidearm';

INSERT INTO "WeaponDefinition" (
  "itemDefinitionId", "weaponSlotType", "ammoItemDefinitionId", "magazineSize",
  "fireModes", "roundsPerMinute", "muzzleVelocityMps", "bulletGravityMps2",
  "maxRangeMeters", "damage", "updatedAt"
)
VALUES
  (
    'assault-01', 'rifle', 'ammo-rifle-556', 30,
    '["single", "burst3", "auto"]'::jsonb, 720, 880, 9.81, 1200, 24,
    CURRENT_TIMESTAMP
  ),
  (
    'twin-horned-pistol', 'handgun', 'ammo-handgun-9mm', 15,
    '["single"]'::jsonb, 420, 380, 9.81, 500, 18,
    CURRENT_TIMESTAMP
  ),
  (
    'starter-sidearm', 'handgun', 'ammo-handgun-9mm', 12,
    '["single"]'::jsonb, 400, 360, 9.81, 450, 16,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("itemDefinitionId") DO UPDATE SET
  "weaponSlotType" = EXCLUDED."weaponSlotType",
  "ammoItemDefinitionId" = EXCLUDED."ammoItemDefinitionId",
  "magazineSize" = EXCLUDED."magazineSize",
  "fireModes" = EXCLUDED."fireModes",
  "roundsPerMinute" = EXCLUDED."roundsPerMinute",
  "muzzleVelocityMps" = EXCLUDED."muzzleVelocityMps",
  "bulletGravityMps2" = EXCLUDED."bulletGravityMps2",
  "maxRangeMeters" = EXCLUDED."maxRangeMeters",
  "damage" = EXCLUDED."damage",
  "updatedAt" = CURRENT_TIMESTAMP;
