# Database Security Hardening Implementation Plan

> **Goal:** Close GitHub issue #27's application and documentation gaps without replacing Postgres/Neon.

## 1. Specify and enforce encryption/TLS configuration

**Files:** `backend/src/config/env.ts`, `backend/src/config/env.test.ts`, `backend/src/test/setup.ts`, `backend/.env.example`, `backend/.env.test.example`

- [x] Add the required primary account-number encryption key and optional previous-key ring to application configuration.
- [x] Reject malformed primary keys in the encryption module and set a deterministic test-only key before test imports.
- [x] Validate that each non-loopback PostgreSQL URL uses `sslmode=require`; preserve local Docker URLs as the documented exception.
- [x] Document both values in environment templates and add configuration tests.

## 2. Encrypt account numbers without changing the API

**Files:** `backend/src/utils/accountNumberEncryption.ts`, `backend/src/controllers/account.controller.ts`, `backend/src/controllers/__tests__/account.controller.test.ts`

- [x] Implement a versioned AES-256-GCM envelope with random IVs and authenticated decryption.
- [x] Encrypt on account create/update and decrypt only in authenticated account responses.
- [x] Keep unprefixed legacy data readable during rollout, but never write it again.
- [x] Add controller tests proving the raw database value is ciphertext, the owner still receives the original value, and updates remain encrypted.

## 3. Add transactional audit records

**Files:** `backend/prisma/schema.prisma`, new Prisma migration, `backend/src/services/audit.service.ts`, account/transaction/goal/admin controllers and services, focused tests

- [x] Create typed `audit_logs` schema/enums and indexes.
- [x] Add small audit helpers that accept either Prisma's main client or a transaction client.
- [x] Place each covered mutation and its audit write in one transaction; metadata contains only action context, never financial values or account numbers.
- [x] Verify account and admin audit records, and retain transaction/goal service behavior.

## 4. Safely backfill and rotate stored values

**Files:** `backend/src/scripts/encrypt-existing-account-numbers.ts`, `backend/package.json`, tests for the encryption helper

- [x] Add a batched script that conditionally encrypts only legacy plaintext rows and prints counts only.
- [x] Support `--rotate` to re-encrypt all account numbers using the primary key after a staged key change.
- [x] Record `SYSTEM` audit entries for rows actually migrated.

## 5. Complete the operational runbook and verify

**Files:** `docs/DEPLOYMENT.md`, new design/plan documents

- [x] Add pre-deploy encryption-key, TLS, backfill, least-privilege role, and Neon PITR verification instructions.
- [x] Run Prisma generation/migration against the local test database, the backend test suite, and the TypeScript build.
- [x] Report the required production follow-up separately: setting real secrets, provisioning roles, and verifying Neon retention cannot be completed from this repository alone.
