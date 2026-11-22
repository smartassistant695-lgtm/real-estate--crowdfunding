import { ensureDatabase, seedDatabase } from "./prepare-db";

/** Fresh, deterministic data for every run: create/migrate hearth_e2e, then wipe and reseed it. */
export default async function globalSetup() {
  ensureDatabase();
  seedDatabase();
}
