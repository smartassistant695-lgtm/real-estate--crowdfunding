import type { Page } from "@playwright/test";
import { db, expect, test } from "./fixtures";

const PASSWORD = "e2e-password-2026";
const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/onboarding");
}

async function fillProfile(page: Page, name: string) {
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await page.getByLabel("Full legal name").fill(name);
  await page.getByLabel("State of residence").selectOption("NC");
  await page.getByLabel("Date of birth").fill("1990-05-14");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Identity check" })).toBeVisible();
}

test.describe("sign up to first investment", () => {
  test("a new investor signs up, onboards, funds $100 and buys $26 of Oakwood Brick Ranch", async ({ page }) => {
    const email = `e2e-${unique()}@example.test`;
    await signUp(page, email);
    await fillProfile(page, "Riley Tester");

    // Identity: the mock provider approves after KYC_MOCK_DELAY_MS; the page polls and refreshes.
    await expect(page.getByText("North Carolina")).toBeVisible();
    await page.getByRole("button", { name: "Verify my identity" }).click();
    await expect(page.getByRole("heading", { name: "Understand the risks" })).toBeVisible({ timeout: 30_000 });

    // Risk disclosure: the checkbox stays disabled until the text is scrolled to the end.
    const accept = page.getByRole("checkbox", { name: /I have read this disclosure/ });
    await expect(accept).toBeDisabled();
    const disclosure = page.getByRole("region", { name: "Risk disclosure" });
    await disclosure.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(page.getByText("You have reached the end of the disclosure.")).toBeVisible();
    await accept.check();
    await page.getByRole("button", { name: "Accept and continue" }).click();

    // Fund the wallet with the $100 preset.
    await expect(page.getByRole("heading", { name: "Add funds" })).toBeVisible();
    await page.getByRole("button", { name: "$100", exact: true }).click();
    await expect(page.getByLabel("Or enter an amount")).toHaveValue("100");
    await page.getByRole("button", { name: "Add funds", exact: true }).click();

    // Tour, then browse properties.
    await expect(page.getByRole("heading", { name: "You are set up" })).toBeVisible();
    await expect(page.getByText("You have $100.00 ready to invest.")).toBeVisible();
    await page.getByRole("button", { name: "Browse properties" }).click();
    await page.waitForURL("**/properties");

    await page.getByRole("link", { name: /Oakwood Brick Ranch/ }).first().click();
    await page.waitForURL("**/properties/oakwood-brick-ranch-raleigh");
    await page.getByRole("link", { name: "Invest in this home" }).click();
    await page.waitForURL("**/properties/oakwood-brick-ranch-raleigh/invest");

    await page.getByLabel("Amount to invest").fill("26");
    await expect(page.getByText(/1\.625 shares/)).toBeVisible();
    await page.getByRole("button", { name: "Review order" }).click();
    await expect(page.getByText("Review your order")).toBeVisible();
    await expect(page.getByText("$74.00")).toBeVisible(); // wallet balance after
    await page.getByRole("button", { name: "Confirm purchase" }).click();

    await page.waitForURL("**/portfolio?bought=1");
    await expect(page.getByText("Purchase confirmed")).toBeVisible();
    const holdings = page.getByRole("table", { name: "Your holdings" });
    const row = holdings.getByRole("row").filter({ hasText: "Oakwood Brick Ranch" });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("cell").nth(1)).toHaveText("1.625");
    await expect(row.getByRole("cell").nth(2)).toHaveText("$26.00");
    const cash = page.locator("div").filter({ has: page.getByText("Cash available", { exact: true }) }).last();
    await expect(cash).toContainText("$74.00");

    // And the books agree.
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { wallet: true, holdings: { include: { property: true } } } });
    expect(user.wallet?.availableCents).toBe(7400n);
    expect(user.holdings).toHaveLength(1);
    expect(user.holdings[0]!.property.name).toBe("Oakwood Brick Ranch");
    expect(user.holdings[0]!.shareUnits).toBe(1_625_000n);
  });

  test("an email containing +reject@ is rejected at the identity step", async ({ page }) => {
    const email = `e2e-${unique()}+reject@example.test`;
    await signUp(page, email);
    await fillProfile(page, "Rejected Tester");
    await page.getByRole("button", { name: "Verify my identity" }).click();
    await expect(page.getByText("We could not verify your identity")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { email } })).kycStatus).toBe("REJECTED");
  });
});
