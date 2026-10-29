CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');
ALTER TABLE "User"
 ADD COLUMN "role" "Role" NOT NULL DEFAULT 'USER',
 ADD COLUMN "suspendedAt" TIMESTAMP(3),
 ADD COLUMN "planName" TEXT,
 ADD COLUMN "planMaxJobs" INTEGER,
 ADD COLUMN "planMaxTokens" INTEGER;
ALTER TABLE "User" ADD CONSTRAINT "User_planMaxJobs_check" CHECK ("planMaxJobs" >= 0);
ALTER TABLE "User" ADD CONSTRAINT "User_planMaxTokens_check" CHECK ("planMaxTokens" >= 0);
CREATE TABLE "AdminAudit" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "actorId" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "targetId" TEXT NOT NULL,
 "details" JSONB NOT NULL DEFAULT '{}',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AdminAudit_createdAt_idx" ON "AdminAudit"("createdAt");
CREATE TABLE "AdminBootstrap" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "userId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
