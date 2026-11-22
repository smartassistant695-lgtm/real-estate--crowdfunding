/**
 * Seeds the demo data only if the database has no users yet, so redeploys never wipe a live demo.
 * To reseed on purpose, run `pnpm db:seed` against the database.
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const users = await prisma.user.count();
  await prisma.$disconnect();
  if (users > 0) {
    console.log(`Database already has ${users} users; skipping the demo seed.`);
    return;
  }
  console.log("Empty database: seeding demo data…");
  execSync("npx tsx --conditions=react-server prisma/seed.ts", { stdio: "inherit", env: process.env });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
