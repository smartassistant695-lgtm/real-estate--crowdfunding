/**
 * Adapters for every outside service. The demo ships a mock for each. To go live, write a
 * class that implements the interface and return it from `src/lib/providers/index.ts`.
 * Nothing else in the app imports a concrete provider.
 */

export type ProviderResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Moves real money between a user's bank and their wallet. Demo: simulated, settles at once. */
export interface PaymentsProvider {
  readonly name: string;
  linkBankAccount(input: { userId: string }): Promise<ProviderResult<{ bankAccountId: string; label: string }>>;
  initiateDeposit(input: { userId: string; amountCents: bigint; idempotencyKey: string }): Promise<ProviderResult<{ transferId: string; settled: boolean }>>;
  initiateWithdrawal(input: { userId: string; amountCents: bigint; idempotencyKey: string }): Promise<ProviderResult<{ transferId: string; settled: boolean }>>;
}

export type KycDecision = "PENDING" | "APPROVED" | "REJECTED";
/** Identity verification, sanctions/AML screening, accredited-investor status. */
export interface KycProvider {
  readonly name: string;
  startVerification(input: { userId: string; email: string; name: string; dateOfBirth: Date; state: string }): Promise<{ reference: string; status: KycDecision }>;
  /** Poll for a decision. `submittedAt` lets the mock simulate a review delay without storing state. */
  getVerification(input: { reference: string; email: string; submittedAt: Date }): Promise<{ status: KycDecision; reason?: string }>;
  checkAccreditation(input: { userId: string }): Promise<{ accredited: boolean }>;
}

/** The holder of record for shares (a transfer agent or qualified custodian in production). */
export interface CustodyProvider {
  readonly name: string;
  recordIssuance(input: { userId: string; propertyId: string; units: bigint; reference: string }): Promise<void>;
  recordTransfer(input: { fromUserId: string; toUserId: string; propertyId: string; units: bigint; reference: string }): Promise<void>;
  recordRetirement(input: { userId: string; propertyId: string; units: bigint; reference: string }): Promise<void>;
}

/** Where secondary orders are routed. Demo: the internal matching engine. Later: an SEC-registered ATS. */
export interface TradingVenueProvider {
  readonly name: string;
  submitOrder(input: { userId: string; propertyId: string; side: "BUY" | "SELL"; limitPriceCents: bigint; units: bigint; idempotencyKey: string }): Promise<{
    orderId: string;
    filledUnits: bigint;
    status: string;
    replayed: boolean;
  }>;
  cancelOrder(input: { userId: string; orderId: string }): Promise<void>;
}

export interface EmailProvider {
  readonly name: string;
  send(input: { to: string; subject: string; text: string }): Promise<void>;
}

export interface DocumentStorageProvider {
  readonly name: string;
  put(input: { key: string; filename: string; contentType: string; bytes: Uint8Array }): Promise<{ url: string }>;
  getUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}
