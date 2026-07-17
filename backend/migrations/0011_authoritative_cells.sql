CREATE TABLE IF NOT EXISTS "SimulationCellSnapshot" (
  "cellId" TEXT NOT NULL,
  "epoch" BIGINT NOT NULL,
  "tick" BIGINT NOT NULL,
  "protocolVersion" INTEGER NOT NULL,
  "simulationVersion" INTEGER NOT NULL,
  "payload" BYTEA NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SimulationCellSnapshot_pkey" PRIMARY KEY ("cellId")
);

CREATE INDEX IF NOT EXISTS "SimulationCellSnapshot_updatedAt_idx"
  ON "SimulationCellSnapshot" ("updatedAt");

CREATE TABLE IF NOT EXISTS "SimulationCellEpoch" (
  "cellId" TEXT NOT NULL,
  "epoch" BIGINT NOT NULL DEFAULT 0,
  "ownerNodeId" TEXT,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SimulationCellEpoch_pkey" PRIMARY KEY ("cellId")
);
