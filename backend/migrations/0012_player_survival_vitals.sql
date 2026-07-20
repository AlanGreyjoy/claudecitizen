ALTER TABLE "Player"
  ADD COLUMN IF NOT EXISTS "hungerReserve" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "thirstReserve" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "vitalsSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "vitalsSessionSequence" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "vitalsHeartbeatAt" TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Player_hungerReserve_check'
  ) THEN
    ALTER TABLE "Player" ADD CONSTRAINT "Player_hungerReserve_check"
      CHECK ("hungerReserve" >= 0 AND "hungerReserve" <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Player_thirstReserve_check'
  ) THEN
    ALTER TABLE "Player" ADD CONSTRAINT "Player_thirstReserve_check"
      CHECK ("thirstReserve" >= 0 AND "thirstReserve" <= 1);
  END IF;
END $$;
