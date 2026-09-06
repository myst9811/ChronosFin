import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../../lib/prisma';
import { login } from '../../auth.controller';
import { getUsers, updateUserStatus, getUserDetail } from '../users.controller';
import type { AdminRequest } from '../../../types/admin.types';

function createMockRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

const testUserIds: string[] = [];

async function createTestUser(overrides: { email?: string; isActive?: boolean } = {}) {
  const email = overrides.email ?? `admin-users-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash('Password1', 10),
      firstName: 'Test',
      lastName: 'User',
      ...(overrides.isActive !== undefined ? { isActive: overrides.isActive } : {}),
    },
  });
  testUserIds.push(user.id);
  return user;
}

afterEach(async () => {
  if (testUserIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { targetUserId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    testUserIds.length = 0;
  }
});

describe('getUsers', () => {
  it('returns newly created users with correct fields and no password', async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    const req = { query: {} } as unknown as AdminRequest;
    const res = createMockRes();

    await getUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as any).mock.calls[0][0];

    // Newest first (orderBy createdAt desc), so both of our just-created
    // users must appear on the default first page.
    const foundA = body.users.find((u: any) => u.id === userA.id);
    const foundB = body.users.find((u: any) => u.id === userB.id);
    expect(foundA).toBeDefined();
    expect(foundB).toBeDefined();
    expect(foundA.email).toBe(userA.email);
    expect(foundA.isActive).toBe(true);
    expect(foundA._count).toEqual({ accounts: 0, transactions: 0, goals: 0 });
    expect(foundA.password).toBeUndefined();
    expect(body.totalCount).toBeGreaterThanOrEqual(2);
  });

  it('respects page and limit query params', async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const userC = await createTestUser();

    // Page 1 of 2: the two most recently created users (desc order), i.e. userC and userB.
    // createdAt has limited precision, so userB and userC may tie; the query
    // breaks ties with a secondary `id desc` sort, but we don't assert which
    // of the two lands first, only that both are on page 1 (not page 2).
    const page1Req = { query: { page: '1', limit: '2' } } as unknown as AdminRequest;
    const page1Res = createMockRes();
    await getUsers(page1Req, page1Res);
    const page1Body = (page1Res.json as any).mock.calls[0][0];

    expect(page1Body.users).toHaveLength(2);
    expect(page1Body.page).toBe(1);
    expect(page1Body.limit).toBe(2);
    const page1Ids = page1Body.users.map((u: any) => u.id);
    expect(page1Ids).toContain(userC.id);
    expect(page1Ids).toContain(userB.id);

    // Page 2 with the same limit must not repeat page 1's users, and must
    // eventually include the oldest of our three test users.
    const page2Req = { query: { page: '2', limit: '2' } } as unknown as AdminRequest;
    const page2Res = createMockRes();
    await getUsers(page2Req, page2Res);
    const page2Body = (page2Res.json as any).mock.calls[0][0];

    const page2Ids = page2Body.users.map((u: any) => u.id);
    expect(page2Ids).not.toContain(userC.id);
    expect(page2Ids).not.toContain(userB.id);
    expect(page2Body.totalCount).toBe(page1Body.totalCount);
    expect(page2Body.totalPages).toBe(Math.ceil(page1Body.totalCount / 2));

    // userA is old enough that it must show up somewhere across pages 1+2
    // only if the table has no more than 4 users total; instead, just prove
    // it's reachable via a page sized to cover everything.
    const allReq = { query: { limit: String(page1Body.totalCount) } } as unknown as AdminRequest;
    const allRes = createMockRes();
    await getUsers(allReq, allRes);
    const allIds = (allRes.json as any).mock.calls[0][0].users.map((u: any) => u.id);
    expect(allIds).toContain(userA.id);
  });
});

describe('updateUserStatus', () => {
  it('flips isActive to false and back to true', async () => {
    const user = await createTestUser();

    const deactivateReq = {
      params: { id: user.id },
      body: { isActive: false },
      admin: { email: 'operator@example.com' },
    } as unknown as AdminRequest;
    const deactivateRes = createMockRes();

    await updateUserStatus(deactivateReq, deactivateRes);

    expect(deactivateRes.status).toHaveBeenCalledWith(200);
    const deactivatedBody = (deactivateRes.json as any).mock.calls[0][0];
    expect(deactivatedBody.user.isActive).toBe(false);

    const dbUserAfterDeactivate = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUserAfterDeactivate?.isActive).toBe(false);

    const reactivateReq = {
      params: { id: user.id },
      body: { isActive: true },
      admin: { email: 'operator@example.com' },
    } as unknown as AdminRequest;
    const reactivateRes = createMockRes();

    await updateUserStatus(reactivateReq, reactivateRes);

    const dbUserAfterReactivate = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUserAfterReactivate?.isActive).toBe(true);
    expect((reactivateRes.json as any).mock.calls[0][0].user.isActive).toBe(true);

    const auditEntries = await prisma.auditLog.findMany({
      where: { targetUserId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditEntries).toHaveLength(2);
    expect(auditEntries[0]).toMatchObject({
      actorEmail: 'operator@example.com',
      action: 'ADMIN_USER_STATUS_UPDATED',
      metadata: { previousIsActive: true, isActive: false },
    });
  });

  it('rejects a non-boolean isActive with 400', async () => {
    const user = await createTestUser();

    const req = {
      params: { id: user.id },
      body: { isActive: 'nope' },
    } as unknown as AdminRequest;
    const res = createMockRes();

    await expect(updateUserStatus(req, res)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns 404 for a nonexistent user id', async () => {
    const req = {
      params: { id: 'not-a-real-id' },
      body: { isActive: false },
      admin: { email: 'operator@example.com' },
    } as unknown as AdminRequest;
    const res = createMockRes();

    await expect(updateUserStatus(req, res)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('causes a subsequent login attempt by the deactivated user to fail with 403', async () => {
    const email = `admin-users-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const user = await createTestUser({ email, isActive: true });

    await updateUserStatus(
      {
        params: { id: user.id },
        body: { isActive: false },
        admin: { email: 'operator@example.com' },
      } as unknown as AdminRequest,
      createMockRes()
    );

    const loginReq = { body: { email, password: 'Password1' } } as unknown as Request;
    const loginRes = createMockRes();

    await expect(login(loginReq, loginRes)).rejects.toMatchObject({
      statusCode: 403,
      message: 'Account deactivated',
    });
  });
});

describe('getUserDetail', () => {
  it('returns accounts, goals, counts, and auth method flags for a known user', async () => {
    const user = await createTestUser();
    await prisma.account.create({
      data: { userId: user.id, name: 'Checking', type: 'CHECKING', balance: 500, bankName: 'Test Bank' },
    });
    await prisma.goal.create({
      data: {
        userId: user.id,
        title: 'Emergency Fund',
        targetAmount: 1000,
        targetDate: new Date('2027-01-01'),
        category: 'EMERGENCY_FUND',
      },
    });

    const req = { params: { id: user.id } } as unknown as AdminRequest;
    const res = createMockRes();

    await getUserDetail(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as any).mock.calls[0][0];

    expect(body.user.id).toBe(user.id);
    expect(body.user.hasPassword).toBe(true);
    expect(body.user.googleLinked).toBe(false);
    expect(body.user._count).toEqual({ accounts: 1, transactions: 0, goals: 1 });
    expect(body.user.accounts).toHaveLength(1);
    expect(body.user.accounts[0].name).toBe('Checking');
    expect(body.user.accounts[0].bankName).toBe('Test Bank');
    expect(body.user.goals).toHaveLength(1);
    expect(body.user.goals[0].title).toBe('Emergency Fund');

    await prisma.account.deleteMany({ where: { userId: user.id } });
    await prisma.goal.deleteMany({ where: { userId: user.id } });
  });

  it('returns 404 for an unknown user id', async () => {
    const req = { params: { id: 'not-a-real-id' } } as unknown as AdminRequest;
    const res = createMockRes();

    await expect(getUserDetail(req, res)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('never includes balances, amounts, or raw password/googleSubject in the response', async () => {
    const user = await createTestUser();
    await prisma.account.create({
      data: { userId: user.id, name: 'Savings', type: 'SAVINGS', balance: 12345 },
    });
    await prisma.goal.create({
      data: {
        userId: user.id,
        title: 'Vacation',
        targetAmount: 5000,
        currentAmount: 1200,
        targetDate: new Date('2027-06-01'),
        category: 'VACATION',
      },
    });

    const req = { params: { id: user.id } } as unknown as AdminRequest;
    const res = createMockRes();

    await getUserDetail(req, res);

    const raw = JSON.stringify((res.json as any).mock.calls[0][0]);
    expect(raw).not.toMatch(/"balance"/);
    expect(raw).not.toMatch(/"amount"/i);
    expect(raw).not.toMatch(/"targetAmount"/);
    expect(raw).not.toMatch(/"currentAmount"/);
    expect(raw).not.toMatch(/"password"/);
    expect(raw).not.toMatch(/"googleSubject"/);

    await prisma.account.deleteMany({ where: { userId: user.id } });
    await prisma.goal.deleteMany({ where: { userId: user.id } });
  });
});
