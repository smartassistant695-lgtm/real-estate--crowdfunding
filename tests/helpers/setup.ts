import { config } from "dotenv";

config({ quiet: true });
// Integration tests must never touch the development database.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
}
process.env.KYC_MOCK_DELAY_MS = "0";
