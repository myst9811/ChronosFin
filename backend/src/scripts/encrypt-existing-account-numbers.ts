import { prisma } from '../lib/prisma';
import { AuditAction, AuditActorType, AuditResourceType } from '../generated/prisma';
import {
  decryptAccountNumber,
  ENCRYPTED_ACCOUNT_NUMBER_PREFIX,
  encryptAccountNumber,
  isEncryptedWithPrimaryKey,
} from '../utils/accountNumberEncryption';
import { recordAuditEvent } from '../services/audit.service';

const BATCH_SIZE = 100;
const rotate = process.argv.slice(2).includes('--rotate');

async function encryptExistingAccountNumbers(): Promise<void> {
  let cursor: string | undefined;
  let migrated = 0;

  do {
    const accounts = await prisma.account.findMany({
      where: rotate
        ? { accountNumber: { not: null } }
        : {
            accountNumber: { not: null },
            NOT: { accountNumber: { startsWith: ENCRYPTED_ACCOUNT_NUMBER_PREFIX } },
          },
      select: { id: true, userId: true, accountNumber: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (accounts.length === 0) {
      break;
    }
    cursor = accounts[accounts.length - 1].id;

    for (const account of accounts) {
      const storedValue = account.accountNumber!;
      if (rotate && isEncryptedWithPrimaryKey(storedValue)) {
        continue;
      }

      const plaintext = decryptAccountNumber(storedValue);
      if (!plaintext) {
        continue;
      }
      const encryptedValue = encryptAccountNumber(plaintext);

      const updated = await prisma.$transaction(async (tx) => {
        // This condition prevents a legacy backfill from overwriting a newer
        // account update that happened after this batch was read.
        const result = await tx.account.updateMany({
          where: { id: account.id, accountNumber: storedValue },
          data: { accountNumber: encryptedValue },
        });

        if (result.count === 1) {
          await recordAuditEvent(tx, {
            actorType: AuditActorType.SYSTEM,
            action: AuditAction.ACCOUNT_NUMBER_ENCRYPTED,
            resourceType: AuditResourceType.ACCOUNT,
            resourceId: account.id,
            targetUserId: account.userId,
            metadata: { mode: rotate ? 'rotation' : 'backfill' },
          });
        }

        return result.count === 1;
      });

      if (updated) {
        migrated += 1;
      }
    }
  } while (cursor);

  process.stdout.write(`Encrypted account-number rows: ${migrated}\n`);
}

encryptExistingAccountNumbers()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    process.stderr.write(`Account-number encryption migration failed: ${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
