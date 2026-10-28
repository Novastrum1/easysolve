ALTER TABLE "Repository" ADD COLUMN "stats" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Run" ADD COLUMN "feedback" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Usage" ADD COLUMN "runId" TEXT;
CREATE INDEX "Usage_userId_runId_idx" ON "Usage"("userId", "runId");
