import { Response } from 'express';
import { prisma } from '../lib/prisma';
import {
  CreateAccountRequest,
  UpdateAccountRequest,
  AuthenticatedRequest,
} from '../types/account.types';
import { validateAccountInput, validateAccountUpdate } from '../utils/validation';
import { ApiError } from '../utils/ApiError';
import { AuditAction, AuditResourceType, Account } from '../generated/prisma';
import { decryptAccountNumber, encryptAccountNumber } from '../utils/accountNumberEncryption';
import { recordUserAuditEvent } from '../services/audit.service';

function serializeAccount(account: Account) {
  return {
    ...account,
    accountNumber: decryptAccountNumber(account.accountNumber),
  };
}

// Create a new account
export const createAccount = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user) {
    throw new ApiError(401, 'Not authenticated');
  }

  const { name, type, balance, currency, bankName, accountNumber }: CreateAccountRequest = req.body;

  // Validate input
  const validation = validateAccountInput(name, type, balance, currency);
  if (!validation.valid) {
    throw new ApiError(400, validation.error!);
  }

  const normalizedAccountNumber = accountNumber?.trim();
  const account = await prisma.$transaction(async (tx) => {
    const createdAccount = await tx.account.create({
      data: {
        userId: req.user!.userId,
        name: name.trim(),
        type,
        balance: balance || 0,
        currency: currency || 'INR',
        bankName: bankName?.trim(),
        accountNumber: normalizedAccountNumber ? encryptAccountNumber(normalizedAccountNumber) : null,
      },
    });

    await recordUserAuditEvent(tx, {
      userId: req.user!.userId,
      action: AuditAction.ACCOUNT_CREATED,
      resourceType: AuditResourceType.ACCOUNT,
      resourceId: createdAccount.id,
      metadata: { type: createdAccount.type },
    });

    return createdAccount;
  });

  res.status(201).json({ account: serializeAccount(account) });
};

// Get all accounts for the authenticated user
export const getAccounts = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user) {
    throw new ApiError(401, 'Not authenticated');
  }

  const { active } = req.query;

  const accounts = await prisma.account.findMany({
    where: {
      userId: req.user.userId,
      ...(active !== undefined && { isActive: active === 'true' }),
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  res.status(200).json({ accounts: accounts.map(serializeAccount), count: accounts.length });
};

// Get a single account by ID
export const getAccountById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user) {
    throw new ApiError(401, 'Not authenticated');
  }

  const { id } = req.params;

  const account = await prisma.account.findFirst({
    where: {
      id,
      userId: req.user.userId, // Ensure user can only access their own accounts
    },
  });

  if (!account) {
    throw new ApiError(404, 'Account not found');
  }

  res.status(200).json({ account: serializeAccount(account) });
};

// Update an account
export const updateAccount = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user) {
    throw new ApiError(401, 'Not authenticated');
  }

  const { id } = req.params;
  const { name, balance, isActive, bankName, accountNumber }: UpdateAccountRequest = req.body;

  // Validate input
  const validation = validateAccountUpdate(name, balance, isActive);
  if (!validation.valid) {
    throw new ApiError(400, validation.error!);
  }

  // Check if account exists and belongs to user
  const existingAccount = await prisma.account.findFirst({
    where: {
      id,
      userId: req.user.userId,
    },
  });

  if (!existingAccount) {
    throw new ApiError(404, 'Account not found');
  }

  const normalizedAccountNumber = accountNumber?.trim() || null;
  const changedFields = [
    ...(name !== undefined ? ['name'] : []),
    ...(balance !== undefined ? ['balance'] : []),
    ...(isActive !== undefined ? ['isActive'] : []),
    ...(bankName !== undefined ? ['bankName'] : []),
    ...(accountNumber !== undefined ? ['accountNumber'] : []),
  ];

  const account = await prisma.$transaction(async (tx) => {
    const updatedAccount = await tx.account.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(balance !== undefined && { balance }),
        ...(isActive !== undefined && { isActive }),
        ...(bankName !== undefined && { bankName: bankName?.trim() || null }),
        ...(accountNumber !== undefined && {
          accountNumber: normalizedAccountNumber ? encryptAccountNumber(normalizedAccountNumber) : null,
        }),
      },
    });

    await recordUserAuditEvent(tx, {
      userId: req.user!.userId,
      action: AuditAction.ACCOUNT_UPDATED,
      resourceType: AuditResourceType.ACCOUNT,
      resourceId: updatedAccount.id,
      metadata: { changedFields },
    });

    return updatedAccount;
  });

  res.status(200).json({ account: serializeAccount(account) });
};

// Delete an account
export const deleteAccount = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user) {
    throw new ApiError(401, 'Not authenticated');
  }

  const { id } = req.params;

  // Check if account exists and belongs to user
  const existingAccount = await prisma.account.findFirst({
    where: {
      id,
      userId: req.user.userId,
    },
  });

  if (!existingAccount) {
    throw new ApiError(404, 'Account not found');
  }

  // Soft delete by setting isActive to false instead of hard delete.
  // The audit event is committed with the update so the deactivation cannot
  // succeed without its record.
  await prisma.$transaction(async (tx) => {
    await tx.account.update({
      where: { id },
      data: { isActive: false },
    });

    await recordUserAuditEvent(tx, {
      userId: req.user!.userId,
      action: AuditAction.ACCOUNT_DEACTIVATED,
      resourceType: AuditResourceType.ACCOUNT,
      resourceId: id,
    });
  });

  res.status(200).json({ message: 'Account deactivated successfully' });
};

// Get account summary (total balance across all accounts)
export const getAccountSummary = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user) {
    throw new ApiError(401, 'Not authenticated');
  }

  const accounts = await prisma.account.findMany({
    where: {
      userId: req.user.userId,
      isActive: true,
    },
  });

  const summary = {
    totalAccounts: accounts.length,
    totalBalance: accounts.reduce((sum, account) => sum + account.balance, 0),
    byType: {
      CHECKING: accounts.filter(a => a.type === 'CHECKING').reduce((sum, a) => sum + a.balance, 0),
      SAVINGS: accounts.filter(a => a.type === 'SAVINGS').reduce((sum, a) => sum + a.balance, 0),
      CREDIT: accounts.filter(a => a.type === 'CREDIT').reduce((sum, a) => sum + a.balance, 0),
      INVESTMENT: accounts.filter(a => a.type === 'INVESTMENT').reduce((sum, a) => sum + a.balance, 0),
    },
  };

  res.status(200).json({ summary });
};
