import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 180_000,
    env: {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-only-secret-that-is-long-enough-1234567890',
      WEB_URL: 'http://localhost:3000',
      LOG_LEVEL: 'silent',
      RATE_LIMIT_AUTH_PER_15_MIN: '10000',
      RATE_LIMIT_GLOBAL_PER_MINUTE: '100000',
      RATE_LIMIT_SENSITIVE_PER_MINUTE: '100000',
    },
  },
});
