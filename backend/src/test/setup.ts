import dotenv from 'dotenv';
import path from 'path';

// Loaded before any test file, so config/env.ts (which calls dotenv.config()
// without overriding already-set vars) picks up the test database instead of .env.
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

// Kept out of .env.test so a production-style required secret is still tested
// while the checked-in test template remains usable.
process.env.ACCOUNT_NUMBER_ENCRYPTION_KEY ??= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
