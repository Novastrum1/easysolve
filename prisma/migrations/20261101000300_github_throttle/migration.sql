CREATE TABLE "GithubThrottle" (
  "key" TEXT NOT NULL,
  "nextAllowedAt" TIMESTAMP(3),
  "blockedUntil" TIMESTAMP(3),
  "resetAt" TIMESTAMP(3),
  "remaining" INTEGER,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GithubThrottle_pkey" PRIMARY KEY ("key")
);
