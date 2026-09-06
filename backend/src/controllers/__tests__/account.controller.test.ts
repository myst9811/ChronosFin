import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { prisma } from '../../lib/prisma';
import { createAccount, getAccountById, updateAccount } from '../account.controller';
import type { AuthenticatedRequest } from '../../types/account.types';
import { AuditAction } from '../../generated/prisma';

function createMockRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

let userId: string | undefined;

afterEach(async () => {
  if (!userId) {
    return;
  }
  await prisma.auditLog.deleteMany({ where: { targetUserId: userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  userId = undefined;
});

describe('account controller account-number protection', () => {
  it('encrypts stored account numbers, decrypts only in the owner response, and audits the mutation', async () => {
    const user = await prisma.user.create({
      data: {
        email: `account-encryption-${Date.now()}@example.com`,
        password: 'hashed',
        firstName: 'Account',
        lastName: 'Owner',
      },
    });
    userId = user.id;
    const request = {
      user: { userId: user.id, email: user.email },
      body: {
        name: 'Checking',
        type: 'CHECKING',
        balance: 100,
        accountNumber: '123456789012',
      },
    } as unknown as AuthenticatedRequest;
    const createRes = createMockRes();

    await createAccount(request, createRes);

    const created = (createRes.json as any).mock.calls[0][0].account;
    const stored = await prisma.account.findUniqueOrThrow({ where: { id: created.id } });
    expect(created.accountNumber).toBe('123456789012');
    expect(stored.accountNumber).toMatch(/^enc:v1:/);
    expect(stored.accountNumber).not.toContain('123456789012');

    const readRes = createMockRes();
    await getAccountById({ user: request.user, params: { id: created.id } } as unknown as AuthenticatedRequest, readRes);
    expect((readRes.json as any).mock.calls[0][0].account.accountNumber).toBe('123456789012');

    const updateRes = createMockRes();
    await updateAccount({
      user: request.user,
      params: { id: created.id },
      body: { accountNumber: '987654321098' },
    } as unknown as AuthenticatedRequest, updateRes);

    const afterUpdate = await prisma.account.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterUpdate.accountNumber).toMatch(/^enc:v1:/);
    expect(afterUpdate.accountNumber).not.toContain('987654321098');
    expect((updateRes.json as any).mock.calls[0][0].account.accountNumber).toBe('987654321098');

    const auditEntries = await prisma.auditLog.findMany({
      where: { targetUserId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditEntries.map((entry) => entry.action)).toEqual([
      AuditAction.ACCOUNT_CREATED,
      AuditAction.ACCOUNT_UPDATED,
    ]);
    expect(JSON.stringify(auditEntries)).not.toContain('123456789012');
    expect(JSON.stringify(auditEntries)).not.toContain('987654321098');
  });
});
