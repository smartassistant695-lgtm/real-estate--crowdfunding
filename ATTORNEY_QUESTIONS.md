# Questions for a securities attorney

This demo makes product decisions that, in a real launch, rest on securities, money-transmission,
tax, real-estate and consumer-protection law. None of it has been reviewed by a lawyer. Each item
below states **what the demo assumes** and **what we need to know**. Nothing here is legal advice.

---

## 1. The offering

**Assumed:** Each property is held by its own LLC ("Lintel Property 004 LLC"). Investors buy
membership interests (called "shares" in the UI) at a fixed price per share until the offering
sells out or its deadline passes, in which case every investor is refunded in full.

1. Which exemption should each property's offering use? Regulation A Tier 2 (as Arrived and
   Fundrise do via series LLCs), Regulation Crowdfunding (through a registered funding portal),
   or Regulation D 506(c) (accredited only)? What does each mean for the $26 minimum and for
   non-accredited investors?
2. Should each property be a separate LLC, or a **series** of one master LLC (Delaware series
   LLC)? What are the liability-segregation and state-recognition risks of a series structure?
3. Are these interests "securities" in every state we would operate in, and do any states need
   notice filings or registration (blue-sky) for the chosen exemption?
4. Is an "all-or-nothing" offering with an escrow account required or advisable, and who may
   act as escrow agent?
5. The platform (or an affiliate) acts as manager of each LLC. What conflicts must be disclosed,
   and must the manager's fees be approved by members?
6. Can offering proceeds pay closing costs and fund a repair reserve, as modelled, and how must
   that be disclosed in the offering circular?

## 2. Investor limits and eligibility

**Assumed:** A $10,000 per-calendar-year investment limit per investor (admin-editable), counting
offering purchases and secondary buys (and cash held for open buy orders), minus refunds.

7. What investment limits actually apply under the chosen exemption (e.g. Reg A Tier 2's 10% of
   the greater of income or net worth for non-accredited investors; Reg CF's tiered limits), and
   how must we verify income, net worth or accredited status?
8. Do secondary-market purchases count toward those limits?
9. Minimum age and residency: we require 18+ and a U.S. state. Are there states we must exclude?

## 3. Identity, AML and sanctions

**Assumed:** A mock KYC step approves users; real KYC/AML would be provided by a vendor.

10. Who is responsible for CIP/KYC and AML (the platform, the broker-dealer, the funding portal,
    the transfer agent)? What records must be kept, and for how long?
11. What OFAC screening, ongoing monitoring and suspicious-activity procedures are required?

## 4. The secondary market

**Assumed:** Investors trade with each other in monthly windows (the first 7 days), limit orders
only, price-time priority, orders within ±25% of the latest appraised value, a 6-month holding
period per lot, unmatched orders expire at window close. The demo's matching engine stands in for
an SEC-registered **alternative trading system (ATS)** operated by a broker-dealer.

12. Must secondary trading run on a registered ATS, and do we partner with one (e.g. North Capital
    PPEX, tZERO, Templum) or register our own broker-dealer?
13. Is the 6-month holding period required (e.g. Reg CF's 12-month restriction), or is it only a
    product choice? What resale restrictions attach to Reg A shares?
14. Is a price band around appraised value permissible, and must it be disclosed as a trading rule?
15. May the platform show "last traded price" and "appraised value" side by side as we do, and
    what disclaimers are required about valuation?
16. Does price-time priority with the resting order setting the price need any specific disclosure?

## 5. The liquidity reserve buyback

**Assumed:** 10% of each property's monthly net income goes to a liquidity reserve that buys
shares back at 5% below appraised value, up to $2,000 a month per property. Bought-back shares
are **retired**, so remaining holders own a larger fraction.

17. Is this an **issuer repurchase** program? Does it need to comply with Rule 13e-4 / tender-offer
    rules, Regulation M, or similar, and must offers be made to all holders equally?
18. Is diverting 10% of income from distributions permissible under the operating agreement, and
    must members approve it?
19. Is retiring repurchased shares (versus holding them in treasury) the right structure for an
    LLC, and what are the tax consequences for remaining members?

## 6. Custody and transfer agent

**Assumed:** The demo's own database is the record of who owns what.

20. Must a registered transfer agent maintain the register of members? Who is the custodian of
    investors' cash while it waits in the "wallet"?
21. Is holding customer cash in a platform wallet **money transmission** requiring state licences,
    or must it sit in an FBO account at a bank through a licensed partner?
22. How should cash held for open buy orders be segregated?

## 7. Dividends and distributions

**Assumed:** Each month: net income − 10% reserve = distributable, paid per share to holders on
the last day of the month (the record date), allocated in whole cents by the largest-remainder
method, with leftover cents carried to the next month. Admins must approve before paying.

23. Are "dividends" the right word for LLC distributions in investor-facing copy, or must we say
    "distributions"?
24. Is a monthly record date at month-end acceptable, and what notice must holders get?
25. Are rounding carry-forwards acceptable, or must every cent be paid each period?

## 8. Governance and voting

**Assumed:** Holders vote only on major decisions (sell, refinance, major renovation, change
manager, extend exit date). Voting power = shares at the record date, each holder capped at 20%
of outstanding shares; quorum 30% of outstanding (uncapped, including abstentions); passes with
more than 50% of counted for + against. A planned-exit vote opens automatically in the exit year;
if it fails or lacks quorum, the exit moves out one year.

26. Is a per-holder voting cap enforceable under the operating agreement and state LLC law, and
    must it be in the operating agreement itself?
27. Which decisions must be member-approved by law or by the operating agreement, and which can
    the manager take alone?
28. Is electronic voting through the platform sufficient (E-SIGN, record-keeping)?
29. Do proxy rules apply to how the manager presents "pros and cons" alongside a proposal?
30. If a sale passes, can the manager sell without a further vote on the price?

## 9. Sale of a property and final distribution

**Assumed:** When a sale passes and closes, holders receive pro rata: sale price − selling costs
+ liquidity reserve + undistributed rounding + final part-month income. The LLC is then closed.

31. What dissolution and winding-up steps are required for the LLC?
32. What statements and tax forms must each holder receive at exit?

## 10. Tax

33. Will each LLC be taxed as a partnership (K-1s for every investor, potentially in many states)
    or elect REIT/corporate treatment to issue 1099-DIVs? What does that mean for small investors?
34. What state tax filing obligations do investors in other states incur from rental income?
35. Do we need to withhold for non-U.S. persons (if ever permitted), or backup withholding?

## 11. Marketing, disclosures and records

36. Does the home page's worked "$26" example (computed from a real property's past dividends)
    count as a performance claim, and what disclaimers or testing-the-waters rules apply?
37. Are the risk disclosure, trading disclosure and "Demo platform" footer adequate in form and
    placement, and must acceptance be re-collected when the text changes?
38. What books-and-records retention applies to the ledger, audit log, notifications and emails?
39. What do we need for privacy (GLBA, state privacy laws), e-delivery consent and accessibility?

## 12. Platform fees

**Assumed:** No fees in the demo; every order review shows a $0.00 fee line.

40. If fees are introduced (sourcing, asset management, trading), how must they be disclosed and
    capped, and can they be charged per trade on an ATS?

---

*Open product questions that depend on the answers above are tracked in NEXT_STEPS.md.*
