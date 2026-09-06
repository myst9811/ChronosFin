-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('ACCOUNT_CREATED', 'ACCOUNT_UPDATED', 'ACCOUNT_DEACTIVATED', 'TRANSACTION_CREATED', 'TRANSACTION_UPDATED', 'TRANSACTION_DELETED', 'GOAL_CREATED', 'GOAL_UPDATED', 'GOAL_CONTRIBUTION_ADDED', 'GOAL_DEACTIVATED', 'ADMIN_USER_STATUS_UPDATED', 'ACCOUNT_NUMBER_ENCRYPTED');

-- CreateEnum
CREATE TYPE "AuditResourceType" AS ENUM ('ACCOUNT', 'TRANSACTION', 'GOAL', 'USER');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" "AuditAction" NOT NULL,
    "resourceType" "AuditResourceType" NOT NULL,
    "resourceId" TEXT,
    "targetUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_targetUserId_createdAt_idx" ON "audit_logs"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");
