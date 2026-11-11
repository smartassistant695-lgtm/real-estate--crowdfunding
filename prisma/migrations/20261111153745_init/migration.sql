-- CreateEnum
CREATE TYPE "Role" AS ENUM ('INVESTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('SINGLE_FAMILY', 'DUPLEX', 'TOWNHOME', 'SMALL_MULTIFAMILY');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('COMING_SOON', 'FUNDING', 'FUNDED', 'TRADING', 'EXIT_VOTE', 'SOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'PRIMARY_PURCHASE', 'TRADE_BUY', 'TRADE_SELL', 'DIVIDEND', 'BUYBACK_SALE', 'FEE', 'ADJUSTMENT', 'REFUND', 'RESERVE_ALLOCATION', 'EXIT_PROCEEDS');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('USER_WALLET', 'EXTERNAL', 'PROPERTY_ESCROW', 'PROPERTY_OPERATING', 'LIQUIDITY_RESERVE', 'PLATFORM');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WindowStatus" AS ENUM ('SCHEDULED', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "DistributionStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "ProposalType" AS ENUM ('SELL_PROPERTY', 'REFINANCE', 'MAJOR_RENOVATION', 'CHANGE_MANAGER', 'EXTEND_EXIT_DATE');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'OPEN', 'PASSED', 'FAILED', 'NO_QUORUM');

-- CreateEnum
CREATE TYPE "VoteChoice" AS ENUM ('FOR', 'AGAINST', 'ABSTAIN');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('OFFERING_CIRCULAR', 'OPERATING_AGREEMENT', 'APPRAISAL', 'INSPECTION', 'FINANCIAL_STATEMENT', 'TAX_FORM');

-- CreateEnum
CREATE TYPE "LotSource" AS ENUM ('PRIMARY', 'TRADE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "state" TEXT,
    "dateOfBirth" DATE,
    "role" "Role" NOT NULL DEFAULT 'INVESTOR',
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "kycReference" TEXT,
    "kycSubmittedAt" TIMESTAMP(3),
    "annualInvestmentLimitCents" BIGINT NOT NULL,
    "riskDisclosureAcceptedAt" TIMESTAMP(3),
    "tradingDisclosureAcceptedAt" TIMESTAMP(3),
    "fundedAt" TIMESTAMP(3),
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "availableCents" BIGINT NOT NULL DEFAULT 0,
    "heldCents" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "userId" TEXT,
    "propertyId" TEXT,
    "type" "LedgerType" NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "shareUnits" BIGINT,
    "referenceId" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "propertyType" "PropertyType" NOT NULL,
    "bedrooms" INTEGER NOT NULL,
    "bathrooms" DOUBLE PRECISION NOT NULL,
    "squareFeet" INTEGER NOT NULL,
    "yearBuilt" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "neighborhood" TEXT NOT NULL DEFAULT '',
    "schoolsNote" TEXT NOT NULL DEFAULT '',
    "transitNote" TEXT NOT NULL DEFAULT '',
    "risks" TEXT[],
    "purchasePriceCents" BIGINT NOT NULL,
    "closingCostsCents" BIGINT NOT NULL,
    "reserveFundCents" BIGINT NOT NULL,
    "totalUnits" BIGINT NOT NULL,
    "soldUnits" BIGINT NOT NULL DEFAULT 0,
    "retiredUnits" BIGINT NOT NULL DEFAULT 0,
    "offeringPricePerShareCents" BIGINT NOT NULL,
    "projectedMonthlyRentCents" BIGINT NOT NULL,
    "projectedAnnualYieldBps" INTEGER NOT NULL,
    "lastTradePriceCents" BIGINT,
    "lastTradeAt" TIMESTAMP(3),
    "dividendCarryCents" BIGINT NOT NULL DEFAULT 0,
    "status" "PropertyStatus" NOT NULL DEFAULT 'COMING_SOON',
    "fundingDeadline" TIMESTAMP(3),
    "fundedAt" TIMESTAMP(3),
    "plannedExitYear" INTEGER NOT NULL,
    "propertyManagerName" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "salePriceCents" BIGINT,
    "saleCostsCents" BIGINT,
    "soldAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyPhoto" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "credit" TEXT NOT NULL DEFAULT '',
    "creditUrl" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,

    CONSTRAINT "PropertyPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appraisal" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "valueCents" BIGINT NOT NULL,
    "navPerShareCents" BIGINT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appraisal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "shareUnits" BIGINT NOT NULL DEFAULT 0,
    "reservedUnits" BIGINT NOT NULL DEFAULT 0,
    "costBasisCents" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoldingLot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "source" "LotSource" NOT NULL,
    "originalUnits" BIGINT NOT NULL,
    "remainingUnits" BIGINT NOT NULL,
    "costBasisCents" BIGINT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HoldingLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimaryPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "shareUnits" BIGINT NOT NULL,
    "priceCents" BIGINT NOT NULL,
    "totalCents" BIGINT NOT NULL,
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimaryPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "limitPriceCents" BIGINT NOT NULL,
    "shareUnits" BIGINT NOT NULL,
    "filledUnits" BIGINT NOT NULL DEFAULT 0,
    "heldCents" BIGINT NOT NULL DEFAULT 0,
    "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
    "windowId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buyOrderId" TEXT,
    "sellOrderId" TEXT,
    "buyerId" TEXT,
    "sellerId" TEXT NOT NULL,
    "isBuyback" BOOLEAN NOT NULL DEFAULT false,
    "priceCents" BIGINT NOT NULL,
    "shareUnits" BIGINT NOT NULL,
    "notionalCents" BIGINT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingWindow" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "status" "WindowStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyFinancials" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "grossRentCents" BIGINT NOT NULL,
    "vacancyLossCents" BIGINT NOT NULL DEFAULT 0,
    "managementFeeCents" BIGINT NOT NULL DEFAULT 0,
    "maintenanceCents" BIGINT NOT NULL DEFAULT 0,
    "taxesCents" BIGINT NOT NULL DEFAULT 0,
    "insuranceCents" BIGINT NOT NULL DEFAULT 0,
    "hoaCents" BIGINT NOT NULL DEFAULT 0,
    "otherExpensesCents" BIGINT NOT NULL DEFAULT 0,
    "netIncomeCents" BIGINT NOT NULL,
    "occupancyRateBps" INTEGER NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyFinancials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DividendDistribution" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "recordDate" TIMESTAMP(3) NOT NULL,
    "netIncomeCents" BIGINT NOT NULL,
    "carryInCents" BIGINT NOT NULL DEFAULT 0,
    "reserveAllocationCents" BIGINT NOT NULL,
    "distributedCents" BIGINT NOT NULL,
    "perShareMicroCents" BIGINT NOT NULL,
    "roundingRemainderCents" BIGINT NOT NULL DEFAULT 0,
    "outstandingUnits" BIGINT NOT NULL,
    "status" "DistributionStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DividendDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DividendPayment" (
    "id" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shareUnits" BIGINT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DividendPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidityReserve" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "balanceCents" BIGINT NOT NULL DEFAULT 0,
    "monthlyCapCents" BIGINT NOT NULL,
    "discountBps" INTEGER NOT NULL,
    "usedThisMonthCents" BIGINT NOT NULL DEFAULT 0,
    "usagePeriod" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiquidityReserve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "type" "ProposalType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "pros" TEXT NOT NULL DEFAULT '',
    "cons" TEXT NOT NULL DEFAULT '',
    "financialImpact" JSONB NOT NULL DEFAULT '[]',
    "isPlannedExit" BOOLEAN NOT NULL DEFAULT false,
    "extendYears" INTEGER,
    "createdById" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "recordDate" TIMESTAMP(3) NOT NULL,
    "quorumBps" INTEGER NOT NULL,
    "passThresholdBps" INTEGER NOT NULL,
    "votingCapBps" INTEGER NOT NULL,
    "outstandingUnits" BIGINT NOT NULL DEFAULT 0,
    "forUnits" BIGINT NOT NULL DEFAULT 0,
    "againstUnits" BIGINT NOT NULL DEFAULT 0,
    "abstainUnits" BIGINT NOT NULL DEFAULT 0,
    "closingSoonSentAt" TIMESTAMP(3),
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "choice" "VoteChoice" NOT NULL,
    "rawShareUnits" BIGINT NOT NULL,
    "countedShareUnits" BIGINT NOT NULL,
    "castAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitPayout" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shareUnits" BIGINT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "costBasisCents" BIGINT NOT NULL,
    "dividendsCents" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExitPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT,
    "title" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "cashCents" BIGINT NOT NULL,
    "holdingsCents" BIGINT NOT NULL,
    "totalCents" BIGINT NOT NULL,

    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "minInvestmentCents" BIGINT NOT NULL DEFAULT 2600,
    "annualInvestmentLimitCents" BIGINT NOT NULL DEFAULT 1000000,
    "holdingPeriodMonths" INTEGER NOT NULL DEFAULT 6,
    "tradingWindowDays" INTEGER NOT NULL DEFAULT 7,
    "reserveAllocationBps" INTEGER NOT NULL DEFAULT 1000,
    "buybackDiscountBps" INTEGER NOT NULL DEFAULT 500,
    "buybackMonthlyCapCents" BIGINT NOT NULL DEFAULT 200000,
    "proposalQuorumBps" INTEGER NOT NULL DEFAULT 3000,
    "proposalPassThresholdBps" INTEGER NOT NULL DEFAULT 5000,
    "votingCapBps" INTEGER NOT NULL DEFAULT 2000,
    "circuitBreakerBps" INTEGER NOT NULL DEFAULT 2500,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_kycStatus_idx" ON "User"("kycStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_seq_key" ON "LedgerEntry"("seq");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_propertyId_createdAt_idx" ON "LedgerEntry"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_referenceId_idx" ON "LedgerEntry"("referenceId");

-- CreateIndex
CREATE INDEX "LedgerEntry_account_propertyId_idx" ON "LedgerEntry"("account", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Property_sequence_key" ON "Property"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Property_slug_key" ON "Property"("slug");

-- CreateIndex
CREATE INDEX "Property_status_idx" ON "Property"("status");

-- CreateIndex
CREATE INDEX "Property_state_city_idx" ON "Property"("state", "city");

-- CreateIndex
CREATE INDEX "PropertyPhoto_propertyId_position_idx" ON "PropertyPhoto"("propertyId", "position");

-- CreateIndex
CREATE INDEX "Appraisal_propertyId_effectiveDate_idx" ON "Appraisal"("propertyId", "effectiveDate");

-- CreateIndex
CREATE INDEX "Holding_propertyId_idx" ON "Holding"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_userId_propertyId_key" ON "Holding"("userId", "propertyId");

-- CreateIndex
CREATE INDEX "HoldingLot_userId_propertyId_acquiredAt_idx" ON "HoldingLot"("userId", "propertyId", "acquiredAt");

-- CreateIndex
CREATE INDEX "PrimaryPurchase_userId_createdAt_idx" ON "PrimaryPurchase"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PrimaryPurchase_propertyId_idx" ON "PrimaryPurchase"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_seq_key" ON "Order"("seq");

-- CreateIndex
CREATE INDEX "Order_propertyId_side_status_limitPriceCents_seq_idx" ON "Order"("propertyId", "side", "status", "limitPriceCents", "seq");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_windowId_status_idx" ON "Order"("windowId", "status");

-- CreateIndex
CREATE INDEX "Trade_propertyId_executedAt_idx" ON "Trade"("propertyId", "executedAt");

-- CreateIndex
CREATE INDEX "Trade_buyerId_idx" ON "Trade"("buyerId");

-- CreateIndex
CREATE INDEX "Trade_sellerId_idx" ON "Trade"("sellerId");

-- CreateIndex
CREATE INDEX "TradingWindow_status_opensAt_idx" ON "TradingWindow"("status", "opensAt");

-- CreateIndex
CREATE INDEX "TradingWindow_propertyId_idx" ON "TradingWindow"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyFinancials_propertyId_month_key" ON "MonthlyFinancials"("propertyId", "month");

-- CreateIndex
CREATE INDEX "DividendDistribution_status_idx" ON "DividendDistribution"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DividendDistribution_propertyId_month_key" ON "DividendDistribution"("propertyId", "month");

-- CreateIndex
CREATE INDEX "DividendPayment_userId_idx" ON "DividendPayment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DividendPayment_distributionId_userId_key" ON "DividendPayment"("distributionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LiquidityReserve_propertyId_key" ON "LiquidityReserve"("propertyId");

-- CreateIndex
CREATE INDEX "Proposal_propertyId_status_idx" ON "Proposal"("propertyId", "status");

-- CreateIndex
CREATE INDEX "Proposal_status_closesAt_idx" ON "Proposal"("status", "closesAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_proposalId_userId_key" ON "Vote"("proposalId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExitPayout_propertyId_userId_key" ON "ExitPayout"("propertyId", "userId");

-- CreateIndex
CREATE INDEX "Document_propertyId_idx" ON "Document"("propertyId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioSnapshot_userId_date_key" ON "PortfolioSnapshot"("userId", "date");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appraisal" ADD CONSTRAINT "Appraisal_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldingLot" ADD CONSTRAINT "HoldingLot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldingLot" ADD CONSTRAINT "HoldingLot_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryPurchase" ADD CONSTRAINT "PrimaryPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimaryPurchase" ADD CONSTRAINT "PrimaryPurchase_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "TradingWindow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_buyOrderId_fkey" FOREIGN KEY ("buyOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_sellOrderId_fkey" FOREIGN KEY ("sellOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingWindow" ADD CONSTRAINT "TradingWindow_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyFinancials" ADD CONSTRAINT "MonthlyFinancials_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DividendDistribution" ADD CONSTRAINT "DividendDistribution_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DividendPayment" ADD CONSTRAINT "DividendPayment_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "DividendDistribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DividendPayment" ADD CONSTRAINT "DividendPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidityReserve" ADD CONSTRAINT "LiquidityReserve_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitPayout" ADD CONSTRAINT "ExitPayout_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitPayout" ADD CONSTRAINT "ExitPayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioSnapshot" ADD CONSTRAINT "PortfolioSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
