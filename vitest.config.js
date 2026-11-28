import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    // Measured, not enforced: `npm run test:coverage` reports how much of the browser code and the Edge Function helpers the unit tests run.
    coverage: { provider: 'v8', include: ['js/**/*.js', 'supabase/functions/**/*.ts'], exclude: ['**/node_modules/**'] },
  },
});
