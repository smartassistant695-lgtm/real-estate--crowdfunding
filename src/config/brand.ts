/**
 * The single place the brand lives. Change `name` and everything —
 * the wordmark, page titles, legal entity names, emails — follows.
 */
export const BRAND = {
  name: "Lintel",
  legalName: "Lintel Homes, Inc.",
  /** Used for per-property entities, e.g. "Lintel Property 004 LLC". */
  entityPrefix: "Lintel Property",
  tagline: "Own a share of a rental home. Rent is paid out monthly.",
  supportEmail: "support@example.com",
  demoBanner: "Demo mode: no real money",
  investingDisclosure:
    "Investing involves risk, including loss of principal. Demo platform – no real securities are offered.",
} as const;

export function entityName(sequence: number): string {
  return `${BRAND.entityPrefix} ${String(sequence).padStart(3, "0")} LLC`;
}
