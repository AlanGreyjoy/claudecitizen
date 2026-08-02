CREATE TABLE IF NOT EXISTS "PlayerChestItem" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "chestId" TEXT NOT NULL,
  "itemDefinitionId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerChestItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlayerChestItem_playerId_chestId_itemDefinitionId_key"
  ON "PlayerChestItem"("playerId", "chestId", "itemDefinitionId");
CREATE INDEX IF NOT EXISTS "PlayerChestItem_playerId_chestId_idx"
  ON "PlayerChestItem"("playerId", "chestId");
CREATE INDEX IF NOT EXISTS "PlayerChestItem_itemDefinitionId_idx"
  ON "PlayerChestItem"("itemDefinitionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'PlayerChestItem_playerId_fkey' AND table_name = 'PlayerChestItem'
  ) THEN
    ALTER TABLE "PlayerChestItem"
      ADD CONSTRAINT "PlayerChestItem_playerId_fkey"
      FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'PlayerChestItem_itemDefinitionId_fkey' AND table_name = 'PlayerChestItem'
  ) THEN
    ALTER TABLE "PlayerChestItem"
      ADD CONSTRAINT "PlayerChestItem_itemDefinitionId_fkey"
      FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
