ALTER TABLE "Usage" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'openai';
ALTER TABLE "Usage" ALTER COLUMN "provider" SET DEFAULT 'deepseek';
