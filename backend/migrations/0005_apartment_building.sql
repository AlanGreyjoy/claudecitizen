ALTER TABLE "HangarPlacement"
  ADD COLUMN IF NOT EXISTS "area" TEXT NOT NULL DEFAULT 'hangar';

CREATE INDEX IF NOT EXISTS "HangarPlacement_playerId_area_idx"
  ON "HangarPlacement"("playerId", "area");
