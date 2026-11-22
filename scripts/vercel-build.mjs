// Vercel build: apply migrations, seed demo data once (only into an empty database), then build.
// Runs on Vercel because the database is reachable from there; safe to run on every deploy.
import { execSync } from "node:child_process";

const env = { ...process.env };
// Accept the names the Neon integration uses with its default or a custom prefix.
env.DATABASE_URL ??= env.STORAGE_URL ?? env.POSTGRES_PRISMA_URL ?? env.POSTGRES_URL;
env.DIRECT_URL ??= env.DATABASE_URL_UNPOOLED ?? env.STORAGE_URL_UNPOOLED ?? env.POSTGRES_URL_NON_POOLING ?? env.DATABASE_URL;
if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add a Neon database to the Vercel project (Storage → Neon) or set it by hand.");
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { stdio: "inherit", env });

run("npx prisma generate");
run("npx prisma migrate deploy");
if (env.SKIP_SEED !== "1") run("npx tsx --conditions=react-server prisma/seed-if-empty.ts");
run("npx next build");
