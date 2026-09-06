import { describe, expect, it } from 'vitest';
import { assertDatabaseUrlUsesTls } from './env';

describe('assertDatabaseUrlUsesTls', () => {
  it('allows local development URLs without TLS', () => {
    expect(() => assertDatabaseUrlUsesTls('DATABASE_URL', 'postgresql://user:pass@localhost:5433/app')).not.toThrow();
  });

  it('requires sslmode=require for remote PostgreSQL URLs', () => {
    expect(() => assertDatabaseUrlUsesTls('DATABASE_URL', 'postgresql://user:pass@db.example.com/app'))
      .toThrow('DATABASE_URL must set sslmode=require');
    expect(() => assertDatabaseUrlUsesTls('DATABASE_URL', 'postgresql://user:pass@db.example.com/app?sslmode=require'))
      .not.toThrow();
  });
});
