/**
 * Creates the e2e database if missing and applies migrations; with `seed`, wipes and reseeds it.
 * Used by the global setup, and run directly (`tsx tests/e2e/prepare-db.ts`) by the web server
 * command, because Playwright starts the web server before the global setup runs.
 */
import { execFileSync, execSync } from "node:child_process";
import path from "node:path";
import { E2E_DB_NAME, E2E_ENV, PG_ROOT } from "./env";

const ROOT = path.resolve(__dirname, "../..");

function run(cmd: string) {
  execSync(cmd, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...E2E_ENV } });
}

export function ensureDatabase() {
  const exists = execFileSync("psql", [`${PG_ROOT}/postgres`, "-tAc", `SELECT 1 FROM pg_database WHERE datname = '${E2E_DB_NAME}'`], { encoding: "utf8" }).trim();
  if (exists !== "1") execFileSync("psql", [`${PG_ROOT}/postgres`, "-c", `CREATE DATABASE ${E2E_DB_NAME}`], { stdio: "inherit" });
  run("npx prisma migrate deploy");
}

export function seedDatabase() {
  run("pnpm db:seed");
}

if (require.main === module) {
  ensureDatabase();
  if (process.argv.includes("--seed")) seedDatabase();
}
