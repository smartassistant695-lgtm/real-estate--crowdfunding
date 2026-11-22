import type { Metadata } from "next";
import { BRAND } from "@/config/brand";
import { LegalPage, LegalText } from "@/components/marketing/legal";

export const metadata: Metadata = { title: "Privacy Policy (draft)" };

export default function Privacy() {
  return (
    <LegalPage current="/legal/privacy" title="Privacy Policy" lede="What we collect, why, and who sees it." updated="November 2026">
      <LegalText>
        <p className="text-base text-ink">
          This policy explains how {BRAND.legalName} handles personal information. It is a placeholder for a demonstration. In this demo, identity checks and bank transfers are simulated and no data is sent to outside providers.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li><strong>Account details:</strong> your name, email address and password (stored only as a one-way hash).</li>
          <li><strong>Identity details:</strong> date of birth, state of residence and the information an identity-verification provider needs to confirm who you are, as the law requires of investment platforms.</li>
          <li><strong>Financial activity:</strong> deposits, withdrawals, purchases, orders, dividends and votes.</li>
          <li><strong>Technical data:</strong> the IP address and device information sent with each request, used for security and to limit repeated sign-in attempts.</li>
        </ul>

        <h2>Why we use it</h2>
        <ul>
          <li>To open and run your account and carry out what you ask.</li>
          <li>To meet legal duties, including identity checks, anti-money-laundering screening and tax reporting.</li>
          <li>To keep the platform secure and investigate misuse.</li>
          <li>To send you notices about your account, such as dividends paid and votes opening. We do not send marketing email without your permission.</li>
        </ul>

        <h2>Who we share it with</h2>
        <p>Only the service providers needed to run the platform (identity verification, payments, custody, email, hosting), each under a contract limiting what they may do with it, and regulators or courts when the law requires. We do not sell personal information.</p>

        <h2>How long we keep it</h2>
        <p>Financial records are kept for as long as securities and tax laws require, which is often several years after an account closes. Other information is deleted when it is no longer needed.</p>

        <h2>Your choices</h2>
        <p>You can see and correct your details in your account, download your statements, and ask us to delete information we are not required to keep. Contact {BRAND.supportEmail}.</p>

        <h2>Security</h2>
        <p>Connections are encrypted, passwords are hashed, and financial records cannot be edited after they are written. No system is perfectly secure; we will tell you promptly if a breach affects you.</p>
      </LegalText>
    </LegalPage>
  );
}
