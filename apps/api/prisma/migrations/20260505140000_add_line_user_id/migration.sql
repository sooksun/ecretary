-- AlterTable
ALTER TABLE "User" ADD COLUMN "lineUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_lineUserId_key" ON "User"("lineUserId");
