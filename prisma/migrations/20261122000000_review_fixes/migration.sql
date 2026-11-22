-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "preExitStatus" "PropertyStatus";

-- AlterTable
ALTER TABLE "TradingWindow" ADD COLUMN     "period" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "TradingWindow_period_key" ON "TradingWindow"("period");

