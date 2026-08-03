-- Optional catalog icon for ship definitions (admin Generate Screenshot).
ALTER TABLE "ShipDefinition"
  ADD COLUMN IF NOT EXISTS "iconUrl" TEXT;
