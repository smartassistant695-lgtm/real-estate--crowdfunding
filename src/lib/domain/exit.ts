import { allocateLargestRemainder } from "./money";

export type ExitHolder = { userId: string; units: bigint; costBasisCents: bigint; dividendsCents: bigint };

export type ExitPayoutPlan = {
  userId: string;
  units: bigint;
  amountCents: bigint;
  costBasisCents: bigint;
  dividendsCents: bigint;
  /** Sale proceeds + dividends − cost basis. */
  totalReturnCents: bigint;
  /** Total return as bps of cost basis (0 when basis is 0). */
  totalReturnBps: number;
};

/** Cash available to holders when a property is sold. Never negative. */
export function netSaleProceeds(input: {
  salePriceCents: bigint;
  saleCostsCents: bigint;
  /** Cash still in the property's liquidity reserve and rounding carry; returned to holders. */
  otherCashCents: bigint;
}): bigint {
  const net = input.salePriceCents - input.saleCostsCents + input.otherCashCents;
  return net > 0n ? net : 0n;
}

/**
 * Split net sale proceeds pro rata by shares using the largest-remainder method.
 * Every cent is paid out: the payouts sum exactly to `netProceedsCents`.
 * Holders are sorted by userId first so ties resolve the same way every time.
 */
export function distributeExitProceeds(netProceedsCents: bigint, holders: readonly ExitHolder[]): ExitPayoutPlan[] {
  const live = holders.filter((h) => h.units > 0n).sort((a, b) => (a.userId < b.userId ? -1 : 1));
  const amounts = allocateLargestRemainder(netProceedsCents, live.map((h) => h.units));
  return live.map((h, i) => {
    const amountCents = amounts[i] ?? 0n;
    const totalReturnCents = amountCents + h.dividendsCents - h.costBasisCents;
    return {
      userId: h.userId,
      units: h.units,
      amountCents,
      costBasisCents: h.costBasisCents,
      dividendsCents: h.dividendsCents,
      totalReturnCents,
      totalReturnBps: h.costBasisCents > 0n ? Number((totalReturnCents * 10_000n) / h.costBasisCents) : 0,
    };
  });
}
