import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBootEnv } from './borga/boot-checks';

const GOOD = {
  DATABASE_URL: 'mysql://borga:pw@db:3306/borga',
  SESSION_SECRET: 'a3f1c9d27b8e4a6f90b1d2c3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d',
  BORGA_SECRET_KEY: '9c1e7a4b2d6f80351a7c9e2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1a3c5e7b9d24',
  CRON_SECRET: 'f0e1d2c3b4a5968778695a4b3c2d1e0f',
  SMTP_HOST: 'smtp.example.org',
  APP_URL: 'https://borga.example.org',
};

test('a complete production environment passes with no warnings', () => {
  const r = checkBootEnv(GOOD);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('missing required secrets are all reported at once', () => {
  const r = checkBootEnv({});
  assert.equal(r.errors.length, 3);
  assert.ok(r.errors.some((e) => e.includes('DATABASE_URL')));
  assert.ok(r.errors.some((e) => e.includes('SESSION_SECRET')));
  assert.ok(r.errors.some((e) => e.includes('BORGA_SECRET_KEY')));
});

test('short, placeholder and malformed secrets are rejected', () => {
  assert.ok(checkBootEnv({ ...GOOD, SESSION_SECRET: 'short' }).errors.some((e) => e.includes('32 characters')));
  assert.ok(checkBootEnv({ ...GOOD, SESSION_SECRET: 'change-me-long-random-change-me-long-random' }).errors.some((e) => e.includes('placeholder')));
  assert.ok(checkBootEnv({ ...GOOD, BORGA_SECRET_KEY: 'not-hex' }).errors.some((e) => e.includes('64 hex')));
  assert.ok(checkBootEnv({ ...GOOD, BORGA_SECRET_KEY: '0'.repeat(64) }).errors.some((e) => e.includes('placeholder')));
  assert.ok(checkBootEnv({ ...GOOD, CRON_SECRET: 'tiny' }).errors.some((e) => e.includes('CRON_SECRET')));
});

test('the session secret and encryption key must differ', () => {
  const r = checkBootEnv({ ...GOOD, SESSION_SECRET: GOOD.BORGA_SECRET_KEY });
  assert.ok(r.errors.some((e) => e.includes('different')));
});

test('missing optional settings only warn', () => {
  const rest: Record<string, string | undefined> = { ...GOOD };
  for (const k of ['CRON_SECRET', 'SMTP_HOST', 'APP_URL']) delete rest[k];
  const r = checkBootEnv(rest);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 3);
});
