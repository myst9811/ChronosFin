import { Response } from 'express';
import { prisma } from '../lib/prisma';
import {
  CreateGoalRequest,
  UpdateGoalRequest,
  AuthenticatedRequest,
} from '../types/goal.types';
import { validateGoalInput, validateGoalUpdate } from '../utils/validation';
import { ApiError } from '../utils/ApiError';
import { buildPaginationMeta, parsePagination } from '../utils/pagination';
import { AuditAction, AuditResourceType } from '../generated/prisma';
import { recordUserAuditEvent } from '../services/audit.service';

// Helper function to calculate goal progress metrics
const calculateGoalMetrics = (goal: any) => {
  const progress = goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 0;
  const remainingAmount = Math.max(0, goal.targetAmount - goal.currentAmount);

  // Calculate days remaining
  const today = new Date();
  const targetDate = new Date(goal.targetDate);
  const daysRemaining = Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  return {
    ...goal,
    progress: Math.min(100, Math.round(progress * 100) / 100),
    remainingAmount,
    daysRemaining: Math.max(0, daysRemaining),
  };
};

// Create a new goal
export const createGoal = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user) {
    throw new ApiError(401, 'Not authenticated');
  }

  const { title, description, targetAmount, currentAmount, targetDate, category }: CreateGoalRequest = req.body;

  // Validate input
  const validation = validateGoalInput(title, targetAmount, targetDate, category, currentAmount);
  if (!validation.valid) {
    throw new ApiError(400, validation.error!);
  }

  const goal = await prisma.$transaction(async (tx) => {
    const createdGoal = await tx.goal.create({
      data: {
        userId: req.user!.userId,
        title: title.trim(),
        description: description?.trim(),
        targetAmount,
        currentAmount: currentAmount || 0,
        targetDate: new Date(targetDate),
        category,
      },
    });

    await recordUserAuditEvent(tx, {
      userId: req.user!.userId,
      action: AuditAction.GOAL_CREATED,
      resourceType: AuditResourceType.GOAL,
      resourceId: createdGoal.id,
      metadata: { category: createdGoal.category },
    });

    return createdGoal;
  });

  const goalWithMetrics = calculateGoalMetrics(goal);

  res.status(201).json({ goal: goalWithMetrics });
};

// Get all goals for the authenticated user
export const getGoals = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user) {
    throw new ApiError(401, 'Not authenticated');
  }

  const { active, category } = req.query;

  // Build filter
  const where: any = {
    userId: req.user.userId,
  };

  if (active !== undefined) {
    where.isActive = active === 'true';
  }

  if (category) {
    where.category = category;
  }

  const pagination = parsePagination(req.query);

  const [goals, totalCount] = await Promise.all([
    prisma.goal.findMany({
      where,
      orderBy: {
        targetDate: 'asc',
      },
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.goal.count({ where }),
  ]);

  // Add progress metrics to each goal
  const goalsWithMetrics = goals.map(calculateGoalMetrics);

  res.status(200).json({
    goals: goalsWithMetrics,
    count: goalsWithMetrics.length,
    ...buildPaginationMeta(totalCount, pagination.page, pagination.limit),
  });
};

// Get a single goal by ID
export const getGoalById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user) {
    throw new ApiError(401, 'Not authenticated');
  }

  const { id } = req.params;

  const goal = await prisma.goal.findFirst({
    where: {
      id,
      userId: req.user.userId,
    },
  });

  if (!goal) {
    throw new ApiError(404, 'Goal not found');
  }

  const goalWithMetrics = calculateGoalMetrics(goal);

  res.status(200).json({ goal: goalWithMetrics });
};

// Update a goal
export const updateGoal = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user) {
    throw new ApiError(401, 'Not authenticated');
  }

  const { id } = req.params;
  const { title, description, targetAmount, currentAmount, targetDate, isActive }: UpdateGoalRequest = req.body;

  // Validate input
  const validation = validateGoalUpdate(title, targetAmount, currentAmount, targetDate, isActive);
  if (!validation.valid) {
    throw new ApiError(400, validation.error!);
  }

  // Check if goal exists and belongs to user
  const existingGoal = await prisma.goal.findFirst({
    where: {
      id,
      userId: req.user.userId,
    },
  });

  if (!existingGoal) {
    throw new ApiError(404, 'Goal not found');
  }

  const changedFields = [
    ...(title !== undefined ? ['title'] : []),
    ...(description !== undefined ? ['description'] : []),
    ...(targetAmount !== undefined ? ['targetAmount'] : []),
    ...(currentAmount !== undefined ? ['currentAmount'] : []),
    ...(targetDate !== undefined ? ['targetDate'] : []),
    ...(isActive !== undefined ? ['isActive'] : []),
  ];

  const goal = await prisma.$transaction(async (tx) => {
    const updatedGoal = await tx.goal.update({
      where: { id },
      data: {
        ...(title && { title: title.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(targetAmount !== undefined && { targetAmount }),
        ...(currentAmount !== undefined && { currentAmount }),
        ...(targetDate && { targetDate: new Date(targetDate) }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    await recordUserAuditEvent(tx, {
      userId: req.user!.userId,
      action: AuditAction.GOAL_UPDATED,
      resourceType: AuditResourceType.GOAL,
      resourceId: updatedGoal.id,
      metadata: { changedFields },
    });

    return updatedGoal;
  });

  const goalWithMetrics = calculateGoalMetrics(goal);

  res.status(200).json({ goal: goalWithMetrics });
};

// Add contribution to a goal
export const addContribution = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user) {
    throw new ApiError(401, 'Not authenticated');
  }

  const { id } = req.params;
  const { amount } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    throw new ApiError(400, 'Amount must be a positive number');
  }

  // The goal update and its audit event share one transaction. Prisma's
  // increment still avoids lost updates when concurrent contributions arrive.
  const goal = await prisma.$transaction(async (tx) => {
    const existingGoal = await tx.goal.findFirst({
      where: { id, userId: req.user!.userId },
    });

    if (!existingGoal) {
      throw new ApiError(404, 'Goal not found');
    }

    const updatedGoal = await tx.goal.update({
      where: { id },
      data: { currentAmount: { increment: amount } },
    });

    await recordUserAuditEvent(tx, {
      userId: req.user!.userId,
      action: AuditAction.GOAL_CONTRIBUTION_ADDED,
      resourceType: AuditResourceType.GOAL,
      resourceId: updatedGoal.id,
    });

    return updatedGoal;
  });

  const goalWithMetrics = calculateGoalMetrics(goal);

  res.status(200).json({
    goal: goalWithMetrics,
    message: `Successfully added $${amount.toFixed(2)} to goal`,
  });
};

// Delete a goal
export const deleteGoal = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user) {
    throw new ApiError(401, 'Not authenticated');
  }

  const { id } = req.params;

  // Check if goal exists and belongs to user
  const existingGoal = await prisma.goal.findFirst({
    where: {
      id,
      userId: req.user.userId,
    },
  });

  if (!existingGoal) {
    throw new ApiError(404, 'Goal not found');
  }

  // Soft delete by setting isActive to false.
  await prisma.$transaction(async (tx) => {
    await tx.goal.update({
      where: { id },
      data: { isActive: false },
    });

    await recordUserAuditEvent(tx, {
      userId: req.user!.userId,
      action: AuditAction.GOAL_DEACTIVATED,
      resourceType: AuditResourceType.GOAL,
      resourceId: id,
    });
  });

  res.status(200).json({ message: 'Goal deactivated successfully' });
};

// Get goals summary
export const getGoalsSummary = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user) {
    throw new ApiError(401, 'Not authenticated');
  }

  const goals = await prisma.goal.findMany({
    where: {
      userId: req.user.userId,
      isActive: true,
    },
  });

  const totalGoals = goals.length;
  const totalTargetAmount = goals.reduce((sum, goal) => sum + goal.targetAmount, 0);
  const totalCurrentAmount = goals.reduce((sum, goal) => sum + goal.currentAmount, 0);
  const totalRemainingAmount = goals.reduce(
    (sum, goal) => sum + Math.max(0, goal.targetAmount - goal.currentAmount),
    0
  );
  const overallProgress = totalTargetAmount > 0 ? Math.min(100, (totalCurrentAmount / totalTargetAmount) * 100) : 0;

  // Count completed goals (100% or more progress)
  const completedGoals = goals.filter(goal => goal.currentAmount >= goal.targetAmount).length;

  // Get goals by category
  const byCategory = goals.reduce((acc: any, goal) => {
    if (!acc[goal.category]) {
      acc[goal.category] = {
        count: 0,
        targetAmount: 0,
        currentAmount: 0,
      };
    }
    acc[goal.category].count++;
    acc[goal.category].targetAmount += goal.targetAmount;
    acc[goal.category].currentAmount += goal.currentAmount;
    return acc;
  }, {});

  // Get urgent goals (less than 30 days remaining)
  const today = new Date();
  const urgentGoals = goals.filter(goal => {
    const daysRemaining = Math.ceil((new Date(goal.targetDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysRemaining > 0 && daysRemaining <= 30 && goal.currentAmount < goal.targetAmount;
  }).map(calculateGoalMetrics);

  const summary = {
    totalGoals,
    activeGoals: totalGoals,
    completedGoals,
    totalTargetAmount,
    totalCurrentAmount,
    totalRemainingAmount,
    overallProgress: Math.round(overallProgress * 100) / 100,
    byCategory,
    urgentGoals,
  };

  res.status(200).json({ summary });
};
