/** Vitest configuration; `npm run test:coverage` enforces the coverage floor. */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary"],
      reportsDirectory: "coverage",
      // Floors sit about three points below the measured totals (statements 90.0, branches 82.8,
      // functions 95.4, lines 90.2) so a real regression fails while small refactors do not.
      thresholds: {
        statements: 87,
        branches: 80,
        functions: 92,
        lines: 87,
      },
    },
  },
});
