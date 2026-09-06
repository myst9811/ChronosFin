import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/ApiError';
import { AuditAction, AuditResourceType, TransactionCategory, TransactionType } from '../generated/prisma';
import type { PaginationParams } from '../utils/pagination';
import { recordUserAuditEvent } from './audit.service';

const ACCOUNT_SUMMARY_SELECT = {
  name: true,
  type: true,
} as const;

const TRANSACTION_INCLUDE = {
  account: { select: ACCOUNT_SUMMARY_SELECT },
  toAccount: { select: ACCOUNT_SUMMARY_SELECT },
} as const;

interface CreateTransactionInput {
  accountId: string;
  toAccountId?: string;
  amount: number;
  description: string;
  category: TransactionCategory;
  type: TransactionType;
  date: string;
  tags?: string[];
}

interface UpdateTransactionInput {
  amount?: number;
  description?: string;
  category?: TransactionCategory;
  date?: string;
  tags?: string[];
}

interface TransactionFilters {
  accountId?: string;
  type?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
}

interface StatsFilters {
  accountId?: string;
  startDate?: string;
  endDate?: string;
}

// Creates a transaction and applies its balance effect atomically:
// INCOME credits accountId, EXPENSE debits accountId, TRANSFER debits
// accountId and credits toAccountId in the same database transaction.
export async function createTransactionForUser(userId: string, input: CreateTransactionInput) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.account.findFirst({
      where: { id: input.accountId, userId },
    });

    if (!account) {
      throw new ApiError(404, 'Account not found');
    }

    let toAccountId: string | null = null;
    if (input.type === 'TRANSFER') {
      if (!input.toAccountId) {
        throw new ApiError(400, 'toAccountId is required for TRANSFER transactions');
      }
      if (input.toAccountId === input.accountId) {
        throw new ApiError(400, 'toAccountId must be different from accountId');
      }

      const toAccount = await tx.account.findFirst({
        where: { id: input.toAccountId, userId },
      });

      if (!toAccount) {
        throw new ApiError(404, 'Destination account not found');
      }

      toAccountId = toAccount.id;
    }

    const transaction = await tx.transaction.create({
      data: {
        userId,
        accountId: input.accountId,
        toAccountId,
        amount: input.amount,
        description: input.description.trim(),
        category: input.category,
        type: input.type,
        date: new Date(input.date),
        tags: input.tags || [],
      },
      include: TRANSACTION_INCLUDE,
    });

    if (input.type === 'INCOME') {
      await tx.account.update({
        where: { id: input.accountId },
        data: { balance: { increment: input.amount } },
      });
    } else if (input.type === 'EXPENSE') {
      await tx.account.update({
        where: { id: input.accountId },
        data: { balance: { decrement: input.amount } },
      });
    } else if (input.type === 'TRANSFER') {
      await tx.account.update({
        where: { id: input.accountId },
        data: { balance: { decrement: input.amount } },
      });
      await tx.account.update({
        where: { id: toAccountId! },
        data: { balance: { increment: input.amount } },
      });
    }

    await recordUserAuditEvent(tx, {
      userId,
      action: AuditAction.TRANSACTION_CREATED,
      resourceType: AuditResourceType.TRANSACTION,
      resourceId: transaction.id,
      metadata: { type: transaction.type },
    });

    return transaction;
  });
}

export async function getTransactionsForUser(
  userId: string,
  filters: TransactionFilters,
  pagination: PaginationParams
) {
  const where: any = { userId };

  if (filters.accountId) {
    where.accountId = filters.accountId;
  }

  if (filters.type) {
    where.type = filters.type;
  }

  if (filters.category) {
    where.category = filters.category;
  }

  if (filters.startDate || filters.endDate) {
    where.date = {};
    if (filters.startDate) {
      where.date.gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      where.date.lte = new Date(filters.endDate);
    }
  }

  if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
    where.amount = {};
    if (filters.minAmount !== undefined) {
      where.amount.gte = filters.minAmount;
    }
    if (filters.maxAmount !== undefined) {
      where.amount.lte = filters.maxAmount;
    }
  }

  if (filters.search) {
    where.description = {
      contains: filters.search,
      mode: 'insensitive',
    };
  }

  const [transactions, totalCount] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: TRANSACTION_INCLUDE,
      orderBy: { date: 'desc' },
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return { transactions, totalCount };
}

export async function getTransactionByIdForUser(userId: string, id: string) {
  const transaction = await prisma.transaction.findFirst({
    where: { id, userId },
    include: TRANSACTION_INCLUDE,
  });

  if (!transaction) {
    throw new ApiError(404, 'Transaction not found');
  }

  return transaction;
}

// Reverses the old balance effect and applies the new amount atomically
// when amount changes. Description/category/date/tags are updated in place.
export async function updateTransactionForUser(userId: string, id: string, input: UpdateTransactionInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findFirst({ where: { id, userId } });

    if (!existing) {
      throw new ApiError(404, 'Transaction not found');
    }

    if (input.amount !== undefined && input.amount !== existing.amount) {
      const amountDiff = input.amount - existing.amount;

      if (existing.type === 'INCOME') {
        await tx.account.update({
          where: { id: existing.accountId },
          data: { balance: { increment: amountDiff } },
        });
      } else if (existing.type === 'EXPENSE') {
        await tx.account.update({
          where: { id: existing.accountId },
          data: { balance: { decrement: amountDiff } },
        });
      } else if (existing.type === 'TRANSFER') {
        await tx.account.update({
          where: { id: existing.accountId },
          data: { balance: { decrement: amountDiff } },
        });
        await tx.account.update({
          where: { id: existing.toAccountId! },
          data: { balance: { increment: amountDiff } },
        });
      }
    }

    const transaction = await tx.transaction.update({
      where: { id },
      data: {
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.description && { description: input.description.trim() }),
        ...(input.category && { category: input.category }),
        ...(input.date && { date: new Date(input.date) }),
        ...(input.tags !== undefined && { tags: input.tags }),
      },
      include: TRANSACTION_INCLUDE,
    });

    await recordUserAuditEvent(tx, {
      userId,
      action: AuditAction.TRANSACTION_UPDATED,
      resourceType: AuditResourceType.TRANSACTION,
      resourceId: transaction.id,
      metadata: { changedFields: Object.keys(input) },
    });

    return transaction;
  });
}

// Reverses the transaction's balance effect and deletes it atomically.
export async function deleteTransactionForUser(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findFirst({ where: { id, userId } });

    if (!existing) {
      throw new ApiError(404, 'Transaction not found');
    }

    if (existing.type === 'INCOME') {
      await tx.account.update({
        where: { id: existing.accountId },
        data: { balance: { decrement: existing.amount } },
      });
    } else if (existing.type === 'EXPENSE') {
      await tx.account.update({
        where: { id: existing.accountId },
        data: { balance: { increment: existing.amount } },
      });
    } else if (existing.type === 'TRANSFER') {
      await tx.account.update({
        where: { id: existing.accountId },
        data: { balance: { increment: existing.amount } },
      });
      await tx.account.update({
        where: { id: existing.toAccountId! },
        data: { balance: { decrement: existing.amount } },
      });
    }

    await recordUserAuditEvent(tx, {
      userId,
      action: AuditAction.TRANSACTION_DELETED,
      resourceType: AuditResourceType.TRANSACTION,
      resourceId: existing.id,
      metadata: { type: existing.type },
    });

    await tx.transaction.delete({ where: { id } });
  });
}

export async function getTransactionStatsForUser(userId: string, filters: StatsFilters) {
  const where: any = { userId };

  if (filters.accountId) {
    where.accountId = filters.accountId;
  }

  if (filters.startDate || filters.endDate) {
    where.date = {};
    if (filters.startDate) {
      where.date.gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      where.date.lte = new Date(filters.endDate);
    }
  }

  const transactions = await prisma.transaction.findMany({ where });

  const totalIncome = transactions
    .filter((t) => t.type === 'INCOME')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpenses = transactions
    .filter((t) => t.type === 'EXPENSE')
    .reduce((sum, t) => sum + t.amount, 0);

  const netIncome = totalIncome - totalExpenses;

  const byCategory: Record<string, number> = {};
  transactions.forEach((t) => {
    if (!byCategory[t.category]) {
      byCategory[t.category] = 0;
    }
    byCategory[t.category] += t.type === 'EXPENSE' ? t.amount : 0;
  });

  const recentTransactions = transactions
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 5);

  return {
    totalTransactions: transactions.length,
    totalIncome,
    totalExpenses,
    netIncome,
    byCategory,
    recentTransactions,
  };
}
