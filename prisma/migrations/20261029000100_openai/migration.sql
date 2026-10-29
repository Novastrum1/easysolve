-- Preserve all historical provider/model/token values.
ALTER TABLE "Usage" ALTER COLUMN "provider" SET DEFAULT 'openai';
ALTER TABLE "Usage" ADD COLUMN "reasoning" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "ProviderConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "fingerprint" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL
);
