import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tam takım paralel çalışırken (özellikle --coverage ile) ağır testler 5 sn'lik varsayılanı aşabiliyordu.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"],
      reporter: ["text-summary", "json-summary", "html"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
