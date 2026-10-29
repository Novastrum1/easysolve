BEGIN;
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "allowanceResetAt" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01'::timestamp,
ADD COLUMN     "githubLimitOverride" INTEGER,
ADD COLUMN     "githubOverrideExpiresAt" TIMESTAMP(3),
ADD COLUMN     "issueLimitOverride" INTEGER,
ADD COLUMN     "issueOverrideExpiresAt" TIMESTAMP(3),
ADD COLUMN     "membershipPlan" TEXT NOT NULL DEFAULT 'basic',
ADD COLUMN     "proExpiresAt" TIMESTAMP(3),
ADD COLUMN     "proLifetime" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Identity" ADD COLUMN     "githubAccountId" TEXT,
ADD COLUMN     "usable" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "AdminAudit" ADD COLUMN     "newValues" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "oldValues" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "reason" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "PlanVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolveClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "succeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolveClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "entitlementState" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "refundRequestedAt" TIMESTAMP(3),
    "refundStatus" TEXT NOT NULL DEFAULT 'none',

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReceipt" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "invoiceId" TEXT,
    "recipient" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "memo" TEXT,
    "ledger" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSubmission" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT NOT NULL,
    "invoiceId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitlementGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentCursor" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "cursor" TEXT NOT NULL DEFAULT '0',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanVersion_version_key" ON "PlanVersion"("version");

-- CreateIndex
CREATE INDEX "SolveClaim_userId_status_idx" ON "SolveClaim"("userId", "status");

-- CreateIndex
CREATE INDEX "SolveClaim_runId_idx" ON "SolveClaim"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "SolveClaim_userId_issueId_key" ON "SolveClaim"("userId", "issueId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_memo_key" ON "Invoice"("memo");

-- CreateIndex
CREATE INDEX "Invoice_userId_createdAt_idx" ON "Invoice"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "PaymentReceipt_status_idx" ON "PaymentReceipt"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReceipt_network_operationId_key" ON "PaymentReceipt"("network", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSubmission_invoiceId_transactionHash_key" ON "PaymentSubmission"("invoiceId", "transactionHash");

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementGrant_invoiceId_key" ON "EntitlementGrant"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Identity_userId_githubAccountId_key" ON "Identity"("userId", "githubAccountId");

-- AddForeignKey
ALTER TABLE "SolveClaim" ADD CONSTRAINT "SolveClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSubmission" ADD CONSTRAINT "PaymentSubmission_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "EntitlementGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "EntitlementGrant_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Safe, disabled initial configuration. No user data is reset or reseeded.
INSERT INTO "PlanVersion" ("id","version","settings","actorId") VALUES
('initial-billing-plan',1,'{"basicIssueLimit":1,"basicReset":"none","basicResetConfirmed":true,"basicGithubLimit":1,"proGithubLimit":4,"proUnlimited":true,"proIssueLimit":null,"downgrade":"basic_keep_data","billingType":"fixed_days","durationDays":14,"renewal":"manual_extend","termsConfirmed":true,"receivingAddress":"GBT7S5S4TZ7GZEAM5NP7A5M2EZYL2IHWTWNU6T7V5AYGCGIPEUPWKUOY","testnetReceivingAddress":"GBT7S5S4TZ7GZEAM5NP7A5M2EZYL2IHWTWNU6T7V5AYGCGIPEUPWKUOY","mainnetReceivingAddress":"GBT7S5S4TZ7GZEAM5NP7A5M2EZYL2IHWTWNU6T7V5AYGCGIPEUPWKUOY","checkoutEnabled":false,"mainnetEnabled":false}'::jsonb,'migration');
-- Existing completed runs represent GitHub-confirmed merged PRs in the original application.
INSERT INTO "SolveClaim" ("id","userId","issueId","runId","status","succeededAt","updatedAt")
SELECT md5(r."userId" || ':' || e.value),r."userId",e.value,min(r."id"),'successful',min(coalesce(r."finishedAt",r."updatedAt")),CURRENT_TIMESTAMP
FROM "Run" r CROSS JOIN LATERAL jsonb_array_elements_text(r."issueIds") e
WHERE r."status"='completed' GROUP BY r."userId",e.value
ON CONFLICT ("userId","issueId") DO NOTHING;
ALTER TABLE "User" ADD CONSTRAINT "User_billing_limits_nonnegative" CHECK (("issueLimitOverride" IS NULL OR "issueLimitOverride">=0) AND ("githubLimitOverride" IS NULL OR "githubLimitOverride">=0));

COMMIT;
