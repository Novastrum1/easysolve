ALTER TABLE "Run"
  ALTER COLUMN "executionBudgetSeconds" DROP DEFAULT,
  ALTER COLUMN "executionBudgetSeconds" DROP NOT NULL,
  ALTER COLUMN "tokenBudget" DROP DEFAULT,
  ALTER COLUMN "tokenBudget" DROP NOT NULL,
  ALTER COLUMN "maxToolRounds" DROP DEFAULT,
  ALTER COLUMN "maxToolRounds" DROP NOT NULL;

-- AI execution budgets are unlimited at the application layer. Provider,
-- command, lease, retry, and plan limits remain enforced elsewhere.
UPDATE "Run"
SET "executionBudgetSeconds" = NULL,
    "tokenBudget" = NULL,
    "maxToolRounds" = NULL;
