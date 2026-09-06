import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  databaseUrl: string;
  directDatabaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  corsOrigins: string[];
  sentryDsn?: string;
  googleClientId: string;
  adminJwtSecret: string;
  adminEmail: string;
  accountNumberEncryptionKey: string;
  accountNumberEncryptionPreviousKeys: string[];
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Neon URLs must be encrypted in transit. Local Docker Postgres is the one
// intentional exception, so the documented local workflow remains frictionless.
export function assertDatabaseUrlUsesTls(name: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL`);
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`${name} must use the postgres or postgresql protocol`);
  }

  if (LOOPBACK_HOSTS.has(url.hostname)) {
    return;
  }

  if (url.searchParams.get('sslmode') !== 'require') {
    throw new Error(`${name} must set sslmode=require for non-local databases`);
  }
}

function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? 3001);
  if (Number.isNaN(port)) {
    throw new Error('PORT must be a number');
  }

  const databaseUrl = required('DATABASE_URL');
  const directDatabaseUrl = required('DIRECT_URL');
  assertDatabaseUrlUsesTls('DATABASE_URL', databaseUrl);
  assertDatabaseUrlUsesTls('DIRECT_URL', directDatabaseUrl);

  return {
    port,
    databaseUrl,
    directDatabaseUrl,
    jwtSecret: required('JWT_SECRET'),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    sentryDsn: process.env.SENTRY_DSN,
    googleClientId: required('GOOGLE_CLIENT_ID'),
    adminJwtSecret: required('ADMIN_JWT_SECRET'),
    adminEmail: required('ADMIN_EMAIL'),
    accountNumberEncryptionKey: required('ACCOUNT_NUMBER_ENCRYPTION_KEY'),
    accountNumberEncryptionPreviousKeys: (process.env.ACCOUNT_NUMBER_ENCRYPTION_PREVIOUS_KEYS || '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean),
  };
}

export const config = loadConfig();
