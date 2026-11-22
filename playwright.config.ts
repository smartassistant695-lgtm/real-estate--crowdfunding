import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, E2E_ENV, E2E_PORT } from "./tests/e2e/env";

/**
 * End-to-end tests. They run against a production build served on :3300 with its own database
 * (hearth_e2e), reseeded by the global setup before every run. A second `next dev` cannot run in
 * this directory while the main dev server holds .next/dev/lock, so the suite uses build + start
 * (which writes to .next/, leaving .next/dev alone).
 *
 * Tests share one database, so they run serially in a single worker.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "./test-results/e2e",
  use: {
    baseURL: E2E_BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm next build && pnpm next start -p ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/login`,
    env: { ...E2E_ENV, NODE_ENV: "production" },
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
