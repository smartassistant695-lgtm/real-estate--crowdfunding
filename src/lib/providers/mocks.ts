import "server-only";
import { randomUUID } from "node:crypto";
import type { CustodyProvider, DocumentStorageProvider, EmailProvider, KycProvider, PaymentsProvider } from "./types";

export class MockPaymentsProvider implements PaymentsProvider {
  readonly name = "mock-payments";
  async linkBankAccount() {
    return { ok: true as const, bankAccountId: `bank_${randomUUID().slice(0, 8)}`, label: "Demo Checking ••0000" };
  }
  async initiateDeposit(input: { amountCents: bigint; idempotencyKey: string }) {
    if (input.amountCents <= 0n) return { ok: false as const, error: "Amount must be positive." };
    return { ok: true as const, transferId: `dep_${input.idempotencyKey.slice(0, 12)}`, settled: true };
  }
  async initiateWithdrawal(input: { amountCents: bigint; idempotencyKey: string }) {
    if (input.amountCents <= 0n) return { ok: false as const, error: "Amount must be positive." };
    return { ok: true as const, transferId: `wd_${input.idempotencyKey.slice(0, 12)}`, settled: true };
  }
}

/**
 * Approves everyone after a short simulated review, except emails containing "+reject@",
 * which are rejected so the unhappy path can be demonstrated.
 */
export class MockKycProvider implements KycProvider {
  readonly name = "mock-kyc";
  private delayMs(): number {
    const n = Number(process.env.KYC_MOCK_DELAY_MS ?? "2500");
    return Number.isFinite(n) && n >= 0 ? n : 2500;
  }
  async startVerification() {
    return { reference: `kyc_${randomUUID()}`, status: "PENDING" as const };
  }
  async getVerification(input: { email: string; submittedAt: Date }) {
    if (Date.now() - input.submittedAt.getTime() < this.delayMs()) return { status: "PENDING" as const };
    if (input.email.toLowerCase().includes("+reject@")) {
      return { status: "REJECTED" as const, reason: "We could not verify your identity from the details provided." };
    }
    return { status: "APPROVED" as const };
  }
  async checkAccreditation() {
    return { accredited: false };
  }
}

/** The app's own holdings tables are the record in the demo, so these only log. */
export class MockCustodyProvider implements CustodyProvider {
  readonly name = "mock-custody";
  async recordIssuance() {}
  async recordTransfer() {}
  async recordRetirement() {}
}

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console-email";
  async send(input: { to: string; subject: string; text: string }) {
    if (process.env.NODE_ENV === "test" || process.env.QUIET_EMAIL === "1") return;
    console.log(`[email] to=${input.to} subject="${input.subject}"\n        ${input.text.replace(/\n/g, "\n        ")}`);
  }
}

/** Stores nothing. Returns a stable placeholder URL so document rows can be created and listed. */
export class MockDocumentStorageProvider implements DocumentStorageProvider {
  readonly name = "mock-storage";
  async put(input: { key: string }) {
    return { url: `/documents/placeholder?key=${encodeURIComponent(input.key)}` };
  }
  async getUrl(key: string) {
    return `/documents/placeholder?key=${encodeURIComponent(key)}`;
  }
  async delete() {}
}
