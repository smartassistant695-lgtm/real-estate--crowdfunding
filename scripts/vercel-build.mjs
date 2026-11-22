// Vercel build: apply migrations, seed demo data once (only into an empty database), then build.
// Runs on Vercel because the database is reachable from there; safe to run on every deploy.
import { execSync } from "node:child_process";

const env = { ...process.env };
env.DIRECT_URL ??= env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add a Neon database to the Vercel project (Storage → Neon) or set it by hand.");
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { stdio: "inherit", env });

run("npx prisma generate");
run("npx prisma migrate deploy");
if (env.SKIP_SEED !== "1") run("npx tsx --conditions=react-server prisma/seed-if-empty.ts");
run("npx next build");
