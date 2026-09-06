import { AuditAction, AuditActorType, AuditResourceType, Prisma } from '../generated/prisma';

type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;

interface AuditEvent {
  actorType: AuditActorType;
  actorId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  targetUserId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function recordAuditEvent(client: AuditClient, event: AuditEvent): Promise<void> {
  await client.auditLog.create({
    data: {
      actorType: event.actorType,
      actorId: event.actorId ?? null,
      actorEmail: event.actorEmail ?? null,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId ?? null,
      targetUserId: event.targetUserId ?? null,
      ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
    },
    // Prisma uses INSERT ... RETURNING for create. Limit that return value to
    // the generated ID so the runtime role needs no access to audit contents.
    select: { id: true },
  });
}

interface UserAuditEvent {
  userId: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export function recordUserAuditEvent(client: AuditClient, event: UserAuditEvent): Promise<void> {
  return recordAuditEvent(client, {
    actorType: AuditActorType.USER,
    actorId: event.userId,
    targetUserId: event.userId,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    metadata: event.metadata,
  });
}

interface AdminAuditEvent {
  adminEmail: string;
  targetUserId: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export function recordAdminAuditEvent(client: AuditClient, event: AdminAuditEvent): Promise<void> {
  return recordAuditEvent(client, {
    actorType: AuditActorType.ADMIN,
    actorEmail: event.adminEmail,
    targetUserId: event.targetUserId,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    metadata: event.metadata,
  });
}
