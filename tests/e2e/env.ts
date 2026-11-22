/**
 * Environment shared by the Playwright config, the global setup and the specs.
 * The e2e suite runs against its own database (hearth_e2e) and its own server on :3300,
 * never the development database or the dev server on :3000.
 */
export const E2E_PORT = 3300;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
export const PG_ROOT = process.env.E2E_PG_ROOT ?? "postgresql://app:app@localhost:5432";
export const E2E_DB_NAME = "hearth_e2e";
export const E2E_DATABASE_URL = `${PG_ROOT}/${E2E_DB_NAME}?schema=public`;

export const E2E_ENV: Record<string, string> = {
  DATABASE_URL: E2E_DATABASE_URL,
  DIRECT_URL: E2E_DATABASE_URL,
  AUTH_SECRET: "e2e-auth-secret-not-for-production-0123456789abcdef",
  AUTH_TRUST_HOST: "true",
  AUTH_URL: E2E_BASE_URL,
  APP_URL: E2E_BASE_URL,
  KYC_MOCK_DELAY_MS: "500",
  QUIET_EMAIL: "1",
  CRON_SECRET: "e2e-cron-secret-0123456789",
  NEXT_TELEMETRY_DISABLED: "1",
};

export const DEMO = {
  admin: { email: "admin@demo.test", password: "demo-admin-2026" },
  investor: { email: "investor@demo.test", password: "demo-investor-2026" },
  othersPassword: "demo-investor-2026",
};
