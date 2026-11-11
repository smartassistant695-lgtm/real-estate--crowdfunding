import { mulDivFloor } from "./money";

/** Calendar-month addition in UTC. Jan 31 + 1 month = Feb 28/29 (clamped), never Mar 3. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** The moment a lot may first be sold. */
export function sellableAt(acquiredAt: Date, holdingPeriodMonths: number): Date {
  return addMonths(acquiredAt, holdingPeriodMonths);
}

export type Lot = { id: string; remainingUnits: bigint; costBasisCents: bigint; acquiredAt: Date };

export function isLotSellable(lot: Pick<Lot, "acquiredAt">, now: Date, holdingPeriodMonths: number): boolean {
  return sellableAt(lot.acquiredAt, holdingPeriodMonths).getTime() <= now.getTime();
}

/** Units in lots that have passed the holding period. */
export function sellableUnits(lots: readonly Lot[], now: Date, holdingPeriodMonths: number): bigint {
  return lots.reduce((a, l) => (isLotSellable(l, now, holdingPeriodMonths) ? a + l.remainingUnits : a), 0n);
}

export type LotConsumption = { lotId: string; units: bigint; costBasisCents: bigint };

/**
 * Take `units` from lots, oldest first (FIFO), returning how much comes from each lot and the
 * cost basis that leaves with it. Basis leaves pro rata, rounded down, except that emptying a
 * lot takes all of its remaining basis (so no basis cents are stranded).
 * Throws if the lots do not hold enough.
 */
export function consumeLotsFifo(lots: readonly Lot[], units: bigint): LotConsumption[] {
  if (units <= 0n) throw new RangeError("Units must be positive");
  const ordered = [...lots]
    .filter((l) => l.remainingUnits > 0n)
    .sort((a, b) => a.acquiredAt.getTime() - b.acquiredAt.getTime() || (a.id < b.id ? -1 : 1));
  const out: LotConsumption[] = [];
  let need = units;
  for (const lot of ordered) {
    if (need === 0n) break;
    const take = need < lot.remainingUnits ? need : lot.remainingUnits;
    const basis =
      take === lot.remainingUnits ? lot.costBasisCents : mulDivFloor(lot.costBasisCents, take, lot.remainingUnits);
    out.push({ lotId: lot.id, units: take, costBasisCents: basis });
    need -= take;
  }
  if (need > 0n) throw new RangeError("Not enough units in lots");
  return out;
}
