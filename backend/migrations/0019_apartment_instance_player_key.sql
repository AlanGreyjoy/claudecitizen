-- Registration keyed the starting apartment instance by user id while
-- `/game/bootstrap` reports (and `authorize_instance` checks) `apartment:<player id>`.
-- Existing rows point at an apartment the player can never transition back to,
-- so re-key them to the player id.
UPDATE "Player"
SET "currentInstanceId" = 'apartment:' || "id",
    "updatedAt" = NOW()
WHERE "currentInstanceId" = 'apartment:' || "userId";
