import "server-only";
import { ConsoleEmailProvider, MockCustodyProvider, MockDocumentStorageProvider, MockKycProvider, MockPaymentsProvider } from "./mocks";
import type { CustodyProvider, DocumentStorageProvider, EmailProvider, KycProvider, PaymentsProvider, TradingVenueProvider } from "./types";

/**
 * The one place that decides which implementation backs each adapter.
 * Swap a mock for a real provider here; no other file needs to change.
 * (The trading venue lives in services/trading.ts as `internalVenue` because the mock IS the
 * internal matching engine; see `tradingVenue()` below.)
 */
const payments: PaymentsProvider = new MockPaymentsProvider();
const kyc: KycProvider = new MockKycProvider();
const custody: CustodyProvider = new MockCustodyProvider();
const email: EmailProvider = new ConsoleEmailProvider();
const documents: DocumentStorageProvider = new MockDocumentStorageProvider();

export const providers = { payments, kyc, custody, email, documents };

export async function tradingVenue(): Promise<TradingVenueProvider> {
  const { internalVenue } = await import("@/lib/services/trading");
  return internalVenue;
}

export type * from "./types";
