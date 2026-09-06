import { Response } from 'express';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { parsePagination, buildPaginationMeta } from '../../utils/pagination';
import { AdminRequest } from '../../types/admin.types';
import { AuditAction, AuditResourceType } from '../../generated/prisma';
import { recordAdminAuditEvent } from '../../services/audit.service';

const USER_LIST_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  createdAt: true,
  isActive: true,
  _count: {
    select: { accounts: true, transactions: true, goals: true },
  },
} as const;

export const getUsers = async (req: AdminRequest, res: Response): Promise<void> => {
  const pagination = parsePagination(req.query);

  const [users, totalCount] = await Promise.all([
    prisma.user.findMany({
      select: USER_LIST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.user.count(),
  ]);

  res.status(200).json({
    users,
    count: users.length,
    ...buildPaginationMeta(totalCount, pagination.page, pagination.limit),
  });
};

export const updateUserStatus = async (req: AdminRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    throw new ApiError(400, 'isActive must be a boolean value');
  }

  if (!req.admin) {
    throw new ApiError(401, 'Not authenticated');
  }

  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(404, 'User not found');
    }

    const updatedUser = await tx.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        isActive: true,
      },
    });

    await recordAdminAuditEvent(tx, {
      adminEmail: req.admin!.email,
      targetUserId: updatedUser.id,
      action: AuditAction.ADMIN_USER_STATUS_UPDATED,
      resourceType: AuditResourceType.USER,
      resourceId: updatedUser.id,
      metadata: { previousIsActive: existing.isActive, isActive },
    });

    return updatedUser;
  });

  res.status(200).json({ user });
};

export const getUserDetail = async (req: AdminRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      updatedAt: true,
      isActive: true,
      googleSubject: true,
      password: true,
      accounts: {
        select: { id: true, name: true, type: true, bankName: true, isActive: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
      goals: {
        select: { id: true, title: true, category: true, targetDate: true, isActive: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
      _count: { select: { accounts: true, transactions: true, goals: true } },
    },
  });

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const { googleSubject, password, ...rest } = user;
  res.status(200).json({
    user: { ...rest, googleLinked: Boolean(googleSubject), hasPassword: Boolean(password) },
  });
};
