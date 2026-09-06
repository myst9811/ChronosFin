# Database Security Hardening — Design Spec

## Context

GitHub issue #27 identified a concrete application-layer exposure: `Account.accountNumber` is stored as plaintext. It also called out unverified TLS configuration, broad database credentials, an absence of audit records for sensitive mutations, and undocumented backup/point-in-time-recovery (PITR) settings. PostgreSQL on Neon remains the database: its transactional guarantees are already the right fit for balance-changing operations. This work hardens how ChronosFin uses that database instead of introducing a risky database migration.

## Goals

- Ensure all newly written account numbers are encrypted before reaching PostgreSQL, while preserving the existing account API.
- Safely migrate existing plaintext account numbers after deployment, without logging sensitive values.
- Require encrypted PostgreSQL connections for every non-local database URL.
- Create durable audit records for admin account-status changes and financial-affecting user mutations.
- Document the deployment-only controls: separate least-privilege runtime/migration roles and Neon backup/PITR verification.

## Non-goals

- Moving away from Neon/Postgres.
- Encrypting `bankName`; it is displayed in account and admin views and is not an account credential.
- Building an audit-log UI or exposing audit data through a public/admin API.
- Changing the deployed Neon role or backup configuration from source control. Those actions require access to the production Neon project and are instead made explicit in the runbook.

## Account-number encryption

`accounts.accountNumber` remains a `TEXT` column, but now contains a versioned encryption envelope for every new or updated non-empty value:

```
enc:v1:<base64-iv>:<base64-auth-tag>:<base64-ciphertext>
```

The backend uses Node's `crypto` module with AES-256-GCM, a fresh 96-bit IV per encryption, and the GCM authentication tag. The encryption key is a base64-encoded 32-byte value in `ACCOUNT_NUMBER_ENCRYPTION_KEY`; it is never stored in the database or written to logs. An optional comma-separated `ACCOUNT_NUMBER_ENCRYPTION_PREVIOUS_KEYS` key ring allows a staged key rotation: reads try the primary key then the retained previous keys, and writes always use the primary key.

The account controller encrypts before `create`/`update`, and decrypts only while forming an authenticated account response. Transaction services only select account names/types and therefore never receive account numbers. The admin user-detail query intentionally continues to omit account numbers.

For rollout compatibility, unprefixed values are treated as legacy plaintext when read. The dedicated `data:encrypt-account-numbers` command migrates them in small batches without printing their values. It uses a conditional update so a concurrent newer write is never overwritten. The command also accepts `--rotate` to decrypt every encrypted row with the configured key ring and rewrite it with the primary key. Removing the previous key is safe only after a successful rotation run.

The application fails closed if the primary key is missing or malformed. Test setup supplies a deterministic non-production key, while all non-test environments must supply their own secret.

## TLS enforcement

At startup the application validates both `DATABASE_URL` and `DIRECT_URL`. Loopback URLs are permitted without TLS to preserve the documented local Docker workflow. Any non-local PostgreSQL URL must set `sslmode=require`; an invalid or missing setting prevents startup. The environment templates and deployment guide make the expected Neon URL form explicit.

## Audit log

A new append-only-by-application `audit_logs` table records:

- actor type (`USER`, `ADMIN`, or `SYSTEM`) plus a user ID or admin email where available;
- action and resource type/ID;
- affected user ID;
- minimal non-sensitive metadata; and
- the timestamp.

The backend writes audit entries inside the same Prisma transaction as the action they describe. An audit write failure therefore rolls back the accompanying account, transaction, goal, or admin-status change rather than creating an unlogged mutation. Account-number values, balances, transaction amounts, descriptions, and credentials are deliberately excluded from metadata.

Covered actions are account create/update/deactivation, transaction create/update/delete, goal create/update/contribution/deactivation, and admin user activation/deactivation. The database migration creates indexes for affected-user and action-time review. The runtime database role described below receives `INSERT` plus column-level `SELECT` on the generated ID (required for Prisma's `INSERT ... RETURNING`), never broad reads, `UPDATE`, or `DELETE`.

## Production runbook

Source code cannot safely change the hosted Neon's access controls or recovery policy. `docs/DEPLOYMENT.md` will therefore require these release steps before calling the issue closed:

1. Generate and set `ACCOUNT_NUMBER_ENCRYPTION_KEY` in each backend environment; make both Neon URLs include `sslmode=require`.
2. Apply the Prisma migration with a migration-only role, deploy the backend using a separate runtime role, then run the account-number backfill with the encryption key present.
3. Grant the runtime role only schema usage plus table/sequence operations the API requires. It gets `INSERT` but not `UPDATE`/`DELETE` on `audit_logs`; the migration role owns schema changes.
4. In Neon, confirm the current restore/PITR retention period, test a restore/branch procedure, record the chosen retention/date in the deployment checklist, and review it at least annually.

## Verification

- Unit tests prove that encryption is randomized, authenticated, and reversible only with a configured key.
- Controller tests prove plaintext never persists, API responses remain plaintext to the owning authenticated user, and account audit records are written.
- Existing transaction/admin/goal tests cover the transactional audit paths; new assertions lock in the admin actor/status entry.
- A configuration test covers accepted loopback URLs and rejected unencrypted remote URLs.
- `npm test` and `npm run build` run after regenerating Prisma types and applying the local test migration.
