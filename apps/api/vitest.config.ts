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
      // Test-only provider credentials. Every test that talks to Paystack or Meta uses a fake HTTP client.
      PAYSTACK_SECRET_KEY: 'sk_test_unit_tests_only',
      WHATSAPP_TOKEN: 'test-whatsapp-token',
      WHATSAPP_PHONE_NUMBER_ID: '1234567890',
      WHATSAPP_APP_SECRET: 'test-app-secret',
      WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
    },
  },
});
