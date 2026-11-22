# From demo to launch

What the demo already does well: the money model (integer cents, balanced append-only ledger,
reconciliation), the concurrency model (row locks, idempotency keys, non-negative constraints),
role checks on the server, and a full product surface. What follows is what a real launch needs,
roughly in order.

## 1. Legal structure first (blocks everything else)

- Work through **ATTORNEY_QUESTIONS.md** with securities counsel. Choose the offering exemption
  (likely Reg A Tier 2 with a series LLC), the investor-limit rules, and the trading venue.
- Draft the real offering circular, operating agreement (including the voting cap, quorum,
  reserve allocation and buyback terms), subscription agreement, Terms, Privacy Policy and risk
  disclosures. Replace every "DRAFT" page.
- State notice filings / blue-sky compliance; decide which states to launch in.

## 2. Licensed partners (replace the mocks)

Each mock sits behind an interface in `src/lib/providers/`; swap it in `index.ts`.

| Need | Partner type | Work in the app |
|---|---|---|
| Payments | ACH processor + FBO bank account (e.g. Plaid + Dwolla, Modern Treasury) | Bank linking UI; PENDING transfers credited from webhooks; returns/NSF handling; withdrawal holds |
| Identity / AML | KYC vendor (Persona, Alloy, Socure) + OFAC screening | Document capture UI; webhooks instead of polling; ongoing screening; accredited-investor verification if required |
| Trading | SEC-registered ATS via a broker-dealer | Route orders through the ATS adapter; trade reporting; best-execution and surveillance obligations |
| Register of members | Transfer agent | Issuance/transfer/retirement calls already exist in `CustodyProvider`; reconcile the register daily |
| Escrow | Escrow agent / bank | Hold offering proceeds outside the platform until funding |
| Email | Postmark / SES | Templates, unsubscribe for non-transactional mail, delivery monitoring |
| Documents | S3 / Vercel Blob with signed URLs | Virus scanning on upload; e-delivery consent; statements as PDFs |
| Tax | K-1 or 1099 provider | Year-end tax documents per investor |

## 3. Product gaps to close

- **Email verification** at sign-up (also removes the "email already registered" enumeration).
- **Two-factor authentication**, session management (sign out other devices), login alerts.
- **Bank-account linking and withdrawal limits**; pending-transfer states in the wallet.
- **Real statements as PDFs** and annual tax documents.
- **Accredited / income verification** if the exemption requires it.
- **Admin roles**: separate "operations" from "approver" so the person who enters financials
  cannot also approve and pay them (four-eyes). Today any admin can do both.
- **Distribution of the final part-month at sale** is entered by hand from the closing statement;
  connect it to the property manager's accounting export.
- **Property-manager integration** (AppFolio, Buildium) to import monthly financials instead of
  typing them.
- **Appraisal workflow**: upload the report, schedule re-appraisals, show methodology.
- Real **neighbourhood data** (schools, transit) instead of placeholders.
- **Photo credits**: confirm each Unsplash photographer (README) — or use real photos of the
  actual homes, which a live listing must.

## 4. Engineering hardening

- **Infrastructure:** separate Neon branches for preview deployments; point-in-time restore
  tested; the production database role should not have `TRUNCATE`, `UPDATE` or `DELETE` on
  `LedgerEntry` and `AuditLog` (triggers already block UPDATE/DELETE; TRUNCATE is only blocked by
  privileges, because the seed and tests use it).
- **Jobs:** move cron work that touches many rows (dividend payment, window close, sale payout)
  to a queue with per-holder batches; the 120-second transaction timeout is enough for hundreds
  of holders, not tens of thousands.
- **Rate limiting:** move from Postgres counters to Redis/Upstash at scale; add CAPTCHA after
  repeated failed logins (the per-account lockout can be triggered by anyone who knows an email).
- **Observability:** structured logs, error tracking (Sentry), a nightly reconciliation job that
  alerts when `reconcile()` reports any issue, and dashboards on ledger totals.
- **Security review:** an external penetration test and code audit; dependency scanning; secret
  rotation; CSP reporting endpoint; review of every server action's authorization.
- **Financial audit:** reconcile the ledger against bank and transfer-agent records monthly;
  annual audited financial statements per LLC (required under Reg A Tier 2).
- **Accessibility audit** by a specialist (WCAG 2.2 AA), including screen-reader testing of the
  order ticket, vote form and charts.
- **Load testing** of matching and dividend payment with realistic holder counts.

## 5. Operations

- Customer support tooling and runbooks (failed deposits, disputed trades, deceased-holder
  transfers, divorce/estate transfers of shares).
- Complaint handling and record-keeping procedures required by the broker-dealer / portal.
- Incident response plan, business-continuity plan, and a status page.
- Insurance: E&O, cyber, and property insurance on every home (already modelled as an expense).
