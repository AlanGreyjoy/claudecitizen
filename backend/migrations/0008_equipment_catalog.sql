CREATE TABLE IF NOT EXISTS "WeaponDefinition" (
  "itemDefinitionId" TEXT NOT NULL,
  "weaponSlotType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WeaponDefinition_pkey" PRIMARY KEY ("itemDefinitionId")
);

CREATE TABLE IF NOT EXISTS "BackpackDefinition" (
  "itemDefinitionId" TEXT NOT NULL,
  "capacityLiters" DOUBLE PRECISION NOT NULL,
  "emptyMassKg" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BackpackDefinition_pkey" PRIMARY KEY ("itemDefinitionId")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WeaponDefinition_itemDefinitionId_fkey'
      AND table_name = 'WeaponDefinition'
  ) THEN
    ALTER TABLE "WeaponDefinition"
      ADD CONSTRAINT "WeaponDefinition_itemDefinitionId_fkey"
      FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'BackpackDefinition_itemDefinitionId_fkey'
      AND table_name = 'BackpackDefinition'
  ) THEN
    ALTER TABLE "BackpackDefinition"
      ADD CONSTRAINT "BackpackDefinition_itemDefinitionId_fkey"
      FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "WeaponDefinition" (
  "itemDefinitionId",
  "weaponSlotType",
  "updatedAt"
)
SELECT "id", 'handgun', CURRENT_TIMESTAMP
FROM "ItemDefinition"
WHERE "id" = 'starter-sidearm'
ON CONFLICT ("itemDefinitionId") DO NOTHING;
