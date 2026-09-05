import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // `src/data/supabase.ts` throws at module load without these, and several
    // test files import it transitively. Supplying placeholders here rather
    // than in CI keeps `npm test` working on a fresh clone with no .env.local —
    // the tests never reach the network, so the values only have to exist.
    env: {
      VITE_SUPABASE_URL: 'https://test.invalid',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Domain logic is the load-bearing part — enforce a hard floor there only
      // (SPEC §10). Barrel file is just re-exports.
      include: ['src/domain/**/*.ts'],
      exclude: ['src/domain/index.ts'],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
