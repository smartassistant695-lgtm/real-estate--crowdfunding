import Link from "next/link";
import { BRAND } from "@/config/brand";
import { Wordmark } from "./wordmark";

export function SiteFooter() {
  return (
    <footer className="no-print mt-24 border-t border-ink">
      <div className="mx-auto grid max-w-page gap-10 px-4 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-8">
        <div>
          <Wordmark href={null} />
          <p className="mt-4 max-w-xs text-sm text-ink-soft">{BRAND.tagline}</p>
        </div>
        <nav aria-label="Product">
          <p className="label mb-3">Product</p>
          <ul className="space-y-2 text-sm">
            <li><Link className="link" href="/properties">Properties</Link></li>
            <li><Link className="link" href="/how-it-works">How it works</Link></li>
            <li><Link className="link" href="/how-it-works#questions">Common questions</Link></li>
          </ul>
        </nav>
        <nav aria-label="Legal">
          <p className="label mb-3">Legal</p>
          <ul className="space-y-2 text-sm">
            <li><Link className="link" href="/legal/terms">Terms of Service</Link></li>
            <li><Link className="link" href="/legal/privacy">Privacy Policy</Link></li>
            <li><Link className="link" href="/legal/risks">Risk Disclosures</Link></li>
            <li><Link className="link" href="/legal/offering-documents">Offering documents</Link></li>
          </ul>
        </nav>
        <div>
          <p className="label mb-3">Contact</p>
          <p className="text-sm text-ink-soft">{BRAND.supportEmail}</p>
        </div>
      </div>
      <div className="border-t border-rule">
        <p className="mx-auto max-w-page px-4 py-5 text-xs text-stone md:px-8">
          {BRAND.investingDisclosure} {BRAND.legalName} is a placeholder name for a demonstration. It is not a registered broker-dealer, investment adviser or funding portal.
        </p>
      </div>
    </footer>
  );
}

/** Required on every investing page. */
export function InvestingDisclosure() {
  return <p className="mt-16 border-t border-rule pt-4 text-xs text-stone">{BRAND.investingDisclosure}</p>;
}
