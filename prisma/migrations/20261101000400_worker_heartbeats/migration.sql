CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL,
    "activeJobs" INTEGER NOT NULL DEFAULT 0,
    "version" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);
