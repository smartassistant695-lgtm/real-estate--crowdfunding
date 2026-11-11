import { BRAND } from "@/config/brand";

/** The plain-English risk disclosure. Shown in onboarding and on /legal/risks. One source. */
export function RiskDisclosureText() {
  return (
    <div className="prose-plain max-w-prose text-sm leading-relaxed text-ink-soft">
      <p className="text-base text-ink">
        Buying a share of a rental home is an investment, and investments can lose money. Please read this before you put any in.
      </p>
      <h3>You can lose money</h3>
      <p>
        The value of a home can fall. If it is worth less when it is sold than when it was bought, you will get back less than you put in. You could lose all of it.
      </p>
      <h3>Your shares may be hard or impossible to sell</h3>
      <p>
        These shares do not trade on a stock exchange. You can only sell during a trading window (the first seven days of each month), only after you have held the shares for six months, and only if another investor wants to buy at your price. If nobody does, your order expires and you keep your shares. The liquidity reserve can buy a limited amount each month at a discount, but it can run out. Plan to hold until the property is sold, which may be years away.
      </p>
      <h3>Values can go down</h3>
      <p>
        The “appraised value” shown for each property is an independent estimate, updated from time to time. It is not a price anyone has agreed to pay. The price shares last traded at can be higher or lower than the appraised value.
      </p>
      <h3>Dividends are not guaranteed</h3>
      <p>
        Dividends come from rent, after expenses. If a tenant leaves, stops paying, or the home needs a major repair, the dividend for that month can be small or zero. Some months it will be.
      </p>
      <h3>Past performance does not predict results</h3>
      <p>
        A home that paid well last year may not pay well next year. Projected yields are estimates based on current rent and expected costs. They are not promises.
      </p>
      <h3>You own a share of a company, not the house itself</h3>
      <p>
        Each property is owned by its own limited liability company. You own shares of that company. A property manager, not you, makes day-to-day decisions. Holders vote only on major decisions such as selling, refinancing, or a large renovation, and no single holder’s vote counts for more than 20% of the shares.
      </p>
      <h3>Concentration</h3>
      <p>One home in one neighborhood is not a diversified investment. A local downturn, a natural disaster, or a single bad tenant can affect all of its income.</p>
      <h3>Taxes</h3>
      <p>Rental income and gains on a sale are generally taxable. {BRAND.name} does not give tax advice. Talk to a tax professional about your situation.</p>
      <h3>This is a demo</h3>
      <p>
        Nothing on this site is a real offer to sell securities. The money is simulated, and this text has not been reviewed by a securities attorney.
      </p>
    </div>
  );
}

export function TradingDisclosureText() {
  return (
    <div className="prose-plain max-w-prose text-sm leading-relaxed text-ink-soft">
      <p className="text-base text-ink">Before your first trade, here is how selling and buying between investors works.</p>
      <ul>
        <li><strong>Windows.</strong> Orders can be placed only during a trading window: the first seven days of each month.</li>
        <li><strong>Limit orders only.</strong> You name your price. An order fills only if another investor’s order meets it. Part of an order can fill and the rest stay open.</li>
        <li><strong>Orders expire.</strong> Anything not matched when the window closes expires. Shares stay in your account; cash set aside for a buy order is released.</li>
        <li><strong>Holding period.</strong> Shares can be sold six months after you bought them. Each purchase has its own date.</li>
        <li><strong>Price limits.</strong> Orders must be priced within 25% of the latest appraised value per share.</li>
        <li><strong>There may be no buyer.</strong> Nobody is obliged to buy your shares. The liquidity reserve may buy a limited amount each month at 5% below appraised value, while its budget lasts.</li>
        <li><strong>Prices are set by investors.</strong> The last traded price is what two investors agreed on. It can differ from the appraised value in either direction.</li>
      </ul>
    </div>
  );
}
