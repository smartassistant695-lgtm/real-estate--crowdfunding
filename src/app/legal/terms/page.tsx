import type { Metadata } from "next";
import { BRAND } from "@/config/brand";
import { LegalPage, LegalText } from "@/components/marketing/legal";

export const metadata: Metadata = { title: "Terms of Service (draft)" };

export default function Terms() {
  return (
    <LegalPage current="/legal/terms" title="Terms of Service" lede="The agreement between you and the platform, in plain English." updated="November 2026">
      <LegalText>
        <p className="text-base text-ink">
          These terms describe how {BRAND.legalName} (“{BRAND.name}”, “we”) runs this website and what you agree to when you open an account. They are a placeholder for a demonstration and have no legal effect.
        </p>

        <h2>1. Who can use {BRAND.name}</h2>
        <p>You must be at least 18, live in the United States, and be able to enter a binding contract. You may hold one account. You must give us accurate information about yourself and keep it up to date.</p>

        <h2>2. What {BRAND.name} does</h2>
        <p>We list rental homes, each owned by its own limited liability company. Through the platform you can buy shares of those companies in an offering, receive your share of their distributions, offer shares to other investors during trading windows, and vote on major decisions.</p>
        <p>We are not your financial adviser. Nothing on the site is a recommendation to buy or sell anything. You decide whether an investment suits you.</p>

        <h2>3. Your account and your money</h2>
        <ul>
          <li>Cash you add to your account is held for you and is used only for the purchases and orders you place.</li>
          <li>You can withdraw cash that is not set aside for an open order at any time.</li>
          <li>Every purchase, sale, dividend and fee is recorded in your account history, and a monthly statement is available.</li>
          <li>Keep your password private. Tell us at once if you think someone else has used your account.</li>
        </ul>

        <h2>4. Buying in an offering</h2>
        <p>You can buy from the minimum investment up to the shares left in the offering and your annual limit. Your purchase is final once confirmed, unless the offering does not sell out by its deadline, in which case it is cancelled and you are refunded in full.</p>

        <h2>5. Trading between investors</h2>
        <p>Trading happens only in scheduled windows, only in shares you have held for the holding period, and only at limit prices within the allowed range. We do not guarantee that any order will be filled. Unfilled orders expire when the window closes.</p>

        <h2>6. Fees</h2>
        <p>The platform charges no fees in this demo. If that changed, fees would be shown before you confirm any transaction and on every statement.</p>

        <h2>7. Things you must not do</h2>
        <ul>
          <li>Trade with yourself, coordinate trades to move a price, or use more than one account.</li>
          <li>Use the site for anyone other than yourself, or for money that is not yours.</li>
          <li>Interfere with the site’s operation or try to reach data that is not yours.</li>
        </ul>

        <h2>8. Ending your account</h2>
        <p>You can close your account once you hold no shares and have no open orders, and withdraw your cash. We may suspend or close an account that breaks these terms or where the law requires it.</p>

        <h2>9. Limits on our responsibility</h2>
        <p>We will run the platform with reasonable care. We are not responsible for losses caused by the value of an investment falling, by the absence of a buyer, or by events outside our reasonable control.</p>

        <h2>10. Changes and contact</h2>
        <p>We will tell you before these terms change. Questions: {BRAND.supportEmail}.</p>
      </LegalText>
    </LegalPage>
  );
}
