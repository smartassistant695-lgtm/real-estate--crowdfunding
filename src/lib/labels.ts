import type { DocumentCategory, LedgerType, OrderStatus, PropertyStatus, PropertyType, ProposalStatus, ProposalType } from "@prisma/client";

export const PROPERTY_TYPE: Record<PropertyType, string> = {
  SINGLE_FAMILY: "Single-family home",
  DUPLEX: "Duplex",
  TOWNHOME: "Townhome",
  SMALL_MULTIFAMILY: "Small multifamily",
};

type Tone = "neutral" | "accent" | "notice" | "loss" | "solid";
export const PROPERTY_STATUS: Record<PropertyStatus, { label: string; tone: Tone; explain: string }> = {
  COMING_SOON: { label: "Coming soon", tone: "neutral", explain: "Not open yet. The numbers may change before the offering opens." },
  FUNDING: { label: "Open for investment", tone: "solid", explain: "Shares are on sale at the offering price until every share is sold or the deadline passes." },
  FUNDED: { label: "Funded", tone: "accent", explain: "Every share is sold. Trading between investors has not started yet." },
  TRADING: { label: "Trading", tone: "accent", explain: "Fully funded and paying dividends. Shares change hands between investors during monthly trading windows." },
  EXIT_VOTE: { label: "Exit vote", tone: "notice", explain: "Holders are deciding whether to sell this property, or a sale is in progress. Trading is paused." },
  SOLD: { label: "Sold", tone: "neutral", explain: "The property was sold and the proceeds were paid to holders." },
  CANCELLED: { label: "Cancelled", tone: "loss", explain: "The offering did not sell out by its deadline. Every investor was refunded in full." },
};

export const PROPOSAL_TYPE: Record<ProposalType, string> = {
  SELL_PROPERTY: "Sell the property",
  REFINANCE: "Refinance",
  MAJOR_RENOVATION: "Major renovation",
  CHANGE_MANAGER: "Change manager",
  EXTEND_EXIT_DATE: "Extend exit date",
};

export const PROPOSAL_STATUS: Record<ProposalStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  OPEN: { label: "Voting open", tone: "solid" },
  PASSED: { label: "Passed", tone: "accent" },
  FAILED: { label: "Did not pass", tone: "loss" },
  NO_QUORUM: { label: "No quorum", tone: "notice" },
};

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  OPEN: { label: "Open", tone: "solid" },
  PARTIALLY_FILLED: { label: "Partly filled", tone: "accent" },
  FILLED: { label: "Filled", tone: "accent" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "notice" },
};

export const LEDGER_TYPE: Record<LedgerType, string> = {
  DEPOSIT: "Deposit",
  WITHDRAWAL: "Withdrawal",
  PRIMARY_PURCHASE: "Purchase",
  TRADE_BUY: "Bought",
  TRADE_SELL: "Sold",
  DIVIDEND: "Dividend",
  BUYBACK_SALE: "Sold to reserve",
  FEE: "Fee",
  ADJUSTMENT: "Adjustment",
  REFUND: "Refund",
  RESERVE_ALLOCATION: "Reserve",
  EXIT_PROCEEDS: "Sale proceeds",
};

export const DOCUMENT_CATEGORY: Record<DocumentCategory, string> = {
  OFFERING_CIRCULAR: "Offering circular",
  OPERATING_AGREEMENT: "Operating agreement",
  APPRAISAL: "Appraisal",
  INSPECTION: "Inspection",
  FINANCIAL_STATEMENT: "Financial statement",
  TAX_FORM: "Tax form",
};

const UTC = { timeZone: "UTC" } as const;
export const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { ...UTC, month: "short", day: "numeric", year: "numeric" });
export const fmtDateLong = (d: Date) => d.toLocaleDateString("en-US", { ...UTC, month: "long", day: "numeric", year: "numeric" });
export const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { ...UTC, month: "long", day: "numeric" });
export const fmtDateTime = (d: Date) => `${d.toLocaleDateString("en-US", { ...UTC, month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { ...UTC, hour: "numeric", minute: "2-digit" })} UTC`;

/** "in 9 days", "tomorrow", "today" — for deadlines. */
export function daysUntil(d: Date, now = new Date()): string {
  const days = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
