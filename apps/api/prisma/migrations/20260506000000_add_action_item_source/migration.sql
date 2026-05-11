-- CreateEnum
CREATE TYPE "ActionItemSource" AS ENUM ('AI', 'MANUAL');

-- AlterTable: add source column with default AI (safe for existing rows)
ALTER TABLE "ActionItem" ADD COLUMN "source" "ActionItemSource" NOT NULL DEFAULT 'AI';

-- CreateIndex
CREATE INDEX "ActionItem_source_idx" ON "ActionItem"("source");
