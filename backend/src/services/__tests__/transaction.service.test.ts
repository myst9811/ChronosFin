import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import {
  createTransactionForUser,
  getTransactionsForUser,
  updateTransactionForUser,
  deleteTransactionForUser,
} from '../transaction.service';

let userId: string;
let accountAId: string;
let accountBId: string;

async function getBalance(accountId: string): Promise<number> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  return account.balance;
}

beforeEach(async () => {
  const user = await prisma.user.create({
    data: {
      email: `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'hashed',
      firstName: 'Test',
      lastName: 'User',
    },
  });
  userId = user.id;

  const accountA = await prisma.account.create({
    data: { userId, name: 'Checking', type: 'CHECKING', balance: 100 },
  });
  const accountB = await prisma.account.create({
    data: { userId, name: 'Savings', type: 'SAVINGS', balance: 0 },
  });
  accountAId = accountA.id;
  accountBId = accountB.id;
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { targetUserId: userId } });
  await prisma.transaction.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
});

const baseInput = {
  description: 'test transaction',
  category: 'OTHER' as const,
  date: '2026-01-01',
};

describe('createTransactionForUser', () => {
  it('credits the account balance for INCOME', async () => {
    await createTransactionForUser(userId, {
      ...baseInput,
      accountId: accountAId,
      amount: 40,
      type: 'INCOME',
    });

    expect(await getBalance(accountAId)).toBe(140);
  });

  it('debits the account balance for EXPENSE', async () => {
    await createTransactionForUser(userId, {
      ...baseInput,
      accountId: accountAId,
      amount: 40,
      type: 'EXPENSE',
    });

    expect(await getBalance(accountAId)).toBe(60);
  });

  it('moves the amount from the source account to the destination account for TRANSFER', async () => {
    await createTransactionForUser(userId, {
      ...baseInput,
      accountId: accountAId,
      toAccountId: accountBId,
      amount: 40,
      type: 'TRANSFER',
    });

    expect(await getBalance(accountAId)).toBe(60);
    expect(await getBalance(accountBId)).toBe(40);
  });

  it('rejects a TRANSFER without a toAccountId and leaves balances untouched', async () => {
    await expect(
      createTransactionForUser(userId, {
        ...baseInput,
        accountId: accountAId,
        amount: 40,
        type: 'TRANSFER',
      })
    ).rejects.toMatchObject(new ApiError(400, 'toAccountId is required for TRANSFER transactions'));

    expect(await getBalance(accountAId)).toBe(100);
  });

  it('rejects a TRANSFER to the same account and leaves balances untouched', async () => {
    await expect(
      createTransactionForUser(userId, {
        ...baseInput,
        accountId: accountAId,
        toAccountId: accountAId,
        amount: 40,
        type: 'TRANSFER',
      })
    ).rejects.toMatchObject(new ApiError(400, 'toAccountId must be different from accountId'));

    expect(await getBalance(accountAId)).toBe(100);
  });

  it('rejects a TRANSFER to a nonexistent account and leaves balances untouched', async () => {
    await expect(
      createTransactionForUser(userId, {
        ...baseInput,
        accountId: accountAId,
        toAccountId: '00000000-0000-0000-0000-000000000000',
        amount: 40,
        type: 'TRANSFER',
      })
    ).rejects.toMatchObject(new ApiError(404, 'Destination account not found'));

    expect(await getBalance(accountAId)).toBe(100);
  });

  it('rejects a transaction against an account owned by another user', async () => {
    await expect(
      createTransactionForUser('00000000-0000-0000-0000-000000000000', {
        ...baseInput,
        accountId: accountAId,
        amount: 40,
        type: 'EXPENSE',
      })
    ).rejects.toMatchObject(new ApiError(404, 'Account not found'));

    expect(await getBalance(accountAId)).toBe(100);
  });
});

describe('updateTransactionForUser', () => {
  it('adjusts the balance by the amount delta for EXPENSE', async () => {
    const transaction = await createTransactionForUser(userId, {
      ...baseInput,
      accountId: accountAId,
      amount: 40,
      type: 'EXPENSE',
    });

    await updateTransactionForUser(userId, transaction.id, { amount: 70 });

    expect(await getBalance(accountAId)).toBe(30);
  });

  it('adjusts both accounts by the amount delta for TRANSFER', async () => {
    const transaction = await createTransactionForUser(userId, {
      ...baseInput,
      accountId: accountAId,
      toAccountId: accountBId,
      amount: 40,
      type: 'TRANSFER',
    });

    await updateTransactionForUser(userId, transaction.id, { amount: 55 });

    expect(await getBalance(accountAId)).toBe(45);
    expect(await getBalance(accountBId)).toBe(55);
  });

  it('does not touch balances when amount is unchanged', async () => {
    const transaction = await createTransactionForUser(userId, {
      ...baseInput,
      accountId: accountAId,
      amount: 40,
      type: 'EXPENSE',
    });

    await updateTransactionForUser(userId, transaction.id, { description: 'renamed' });

    expect(await getBalance(accountAId)).toBe(60);
  });
});

describe('deleteTransactionForUser', () => {
  it('reverses the balance effect for INCOME', async () => {
    const transaction = await createTransactionForUser(userId, {
      ...baseInput,
      accountId: accountAId,
      amount: 40,
      type: 'INCOME',
    });

    await deleteTransactionForUser(userId, transaction.id);

    expect(await getBalance(accountAId)).toBe(100);
  });

  it('reverses the balance effect for EXPENSE', async () => {
    const transaction = await createTransactionForUser(userId, {
      ...baseInput,
      accountId: accountAId,
      amount: 40,
      type: 'EXPENSE',
    });

    await deleteTransactionForUser(userId, transaction.id);

    expect(await getBalance(accountAId)).toBe(100);
  });

  it('reverses the balance effect on both accounts for TRANSFER', async () => {
    const transaction = await createTransactionForUser(userId, {
      ...baseInput,
      accountId: accountAId,
      toAccountId: accountBId,
      amount: 40,
      type: 'TRANSFER',
    });

    await deleteTransactionForUser(userId, transaction.id);

    expect(await getBalance(accountAId)).toBe(100);
    expect(await getBalance(accountBId)).toBe(0);
  });

  it('rejects deleting a transaction that does not belong to the user', async () => {
    const transaction = await createTransactionForUser(userId, {
      ...baseInput,
      accountId: accountAId,
      amount: 40,
      type: 'EXPENSE',
    });

    await expect(
      deleteTransactionForUser('00000000-0000-0000-0000-000000000000', transaction.id)
    ).rejects.toMatchObject(new ApiError(404, 'Transaction not found'));

    expect(await getBalance(accountAId)).toBe(60);
  });
});

describe('getTransactionsForUser pagination', () => {
  beforeEach(async () => {
    for (const amount of [10, 20, 30]) {
      await createTransactionForUser(userId, {
        ...baseInput,
        accountId: accountAId,
        amount,
        type: 'EXPENSE',
      });
    }
  });

  it('returns totalCount and a limited page of results', async () => {
    const { transactions, totalCount } = await getTransactionsForUser(userId, {}, { page: 1, limit: 2, skip: 0 });

    expect(totalCount).toBe(3);
    expect(transactions).toHaveLength(2);
  });

  it('returns the remaining items on the second page', async () => {
    const { transactions, totalCount } = await getTransactionsForUser(userId, {}, { page: 2, limit: 2, skip: 2 });

    expect(totalCount).toBe(3);
    expect(transactions).toHaveLength(1);
  });
});
