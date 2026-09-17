import { defineConfig } from 'vitest/config';

// The filters that test with vitest. `manifest` is excluded deliberately: it tests
// through `node:test` and runs under its own `npm test`.
export default defineConfig({
  test: {
    include: ['{guides,i18n,ui-compiler}/test/**/*.test.ts'],
  },
});
