import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal";
import { RiskDisclosureText, TradingDisclosureText } from "@/components/site/risk-text";
import { SectionHeading } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Risk Disclosures (draft)" };

/** The same text investors accept during onboarding and before their first trade: one source. */
export default function Risks() {
  return (
    <LegalPage current="/legal/risks" title="Risk Disclosures" lede="What could go wrong, in the words every investor reads and accepts before investing." updated="November 2026">
      <section aria-labelledby="investing-risks">
        <SectionHeading id="investing-risks">Before you invest</SectionHeading>
        <RiskDisclosureText />
      </section>
      <section aria-labelledby="trading-risks" className="pt-14">
        <SectionHeading id="trading-risks">Before you trade</SectionHeading>
        <TradingDisclosureText />
      </section>
    </LegalPage>
  );
}
