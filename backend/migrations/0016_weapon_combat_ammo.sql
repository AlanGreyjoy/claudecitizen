-- Weapon Combat catalog fields. Ammo remains a normal stackable ItemDefinition.

ALTER TABLE "WeaponDefinition"
  ADD COLUMN IF NOT EXISTS "ammoItemDefinitionId" TEXT,
  ADD COLUMN IF NOT EXISTS "magazineSize" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "fireModes" JSONB NOT NULL DEFAULT '["single"]'::jsonb,
  ADD COLUMN IF NOT EXISTS "roundsPerMinute" DOUBLE PRECISION NOT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS "muzzleVelocityMps" DOUBLE PRECISION NOT NULL DEFAULT 850,
  ADD COLUMN IF NOT EXISTS "bulletGravityMps2" DOUBLE PRECISION NOT NULL DEFAULT 9.81,
  ADD COLUMN IF NOT EXISTS "maxRangeMeters" DOUBLE PRECISION NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS "damage" DOUBLE PRECISION NOT NULL DEFAULT 20;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WeaponDefinition_ammoItemDefinitionId_fkey'
      AND table_name = 'WeaponDefinition'
  ) THEN
    ALTER TABLE "WeaponDefinition"
      ADD CONSTRAINT "WeaponDefinition_ammoItemDefinitionId_fkey"
      FOREIGN KEY ("ammoItemDefinitionId") REFERENCES "ItemDefinition"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WeaponDefinition_magazineSize_check'
      AND table_name = 'WeaponDefinition'
  ) THEN
    ALTER TABLE "WeaponDefinition"
      ADD CONSTRAINT "WeaponDefinition_magazineSize_check"
      CHECK ("magazineSize" >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WeaponDefinition_fireModes_check'
      AND table_name = 'WeaponDefinition'
  ) THEN
    ALTER TABLE "WeaponDefinition"
      ADD CONSTRAINT "WeaponDefinition_fireModes_check"
      CHECK (
        jsonb_typeof("fireModes") = 'array'
        AND jsonb_array_length("fireModes") > 0
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WeaponDefinition_ballistics_check'
      AND table_name = 'WeaponDefinition'
  ) THEN
    ALTER TABLE "WeaponDefinition"
      ADD CONSTRAINT "WeaponDefinition_ballistics_check"
      CHECK (
        "roundsPerMinute" > 0
        AND "muzzleVelocityMps" > 0
        AND "bulletGravityMps2" >= 0
        AND "maxRangeMeters" > 0
        AND "damage" >= 0
      );
  END IF;
END $$;
