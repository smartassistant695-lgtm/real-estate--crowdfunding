import { formatCents } from "../../src/lib/domain/money";
import { monthLabel } from "../../src/lib/domain/trading-rules";
import { DEMO } from "./env";
import { db, expect, test } from "./fixtures";

const PROPERTY = "Kenwood Bungalow"; // TRADING, and held by investor@demo.test

test("admin approves and pays last month's draft dividend; the investor sees it", async ({ newUserPage }) => {
  // The seed leaves last month's dividends as DRAFT. Pick the latest DRAFT month for the property.
  const property = await db.property.findFirstOrThrow({ where: { name: PROPERTY } });
  expect(property.status).toBe("TRADING");
  const draft = await db.dividendDistribution.findFirstOrThrow({ where: { propertyId: property.id, status: "DRAFT" }, orderBy: { month: "desc" } });
  const investor = await db.user.findUniqueOrThrow({ where: { email: DEMO.investor.email } });
  const label = monthLabel(draft.month);

  // ---- admin: find it on Financials, approve, pay ----
  const admin = await newUserPage(DEMO.admin.email, DEMO.admin.password);
  await admin.goto("/admin/financials");
  await admin.getByLabel("Property", { exact: true }).selectOption({ label: PROPERTY });
  await admin.getByLabel("Month", { exact: true }).fill(draft.month);
  await admin.getByRole("button", { name: "Show" }).click();
  await admin.waitForURL(/\/admin\/financials\?property=/);
  await expect(admin.getByRole("heading", { name: `${PROPERTY}: recent months` })).toBeVisible();
  const row = admin.getByRole("table", { name: "Monthly financials and dividends" }).getByRole("row").filter({ hasText: label });
  await row.getByRole("link", { name: "draft" }).click();
  await admin.waitForURL(`**/admin/dividends/${draft.id}`);
  await expect(admin.getByRole("heading", { name: `${PROPERTY}, ${label} dividend` })).toBeVisible();

  await admin.getByRole("button", { name: "Approve" }).click();
  const approveDialog = admin.getByRole("dialog");
  await expect(approveDialog).toContainText("Approve paying");
  await approveDialog.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByRole("button", { name: "Pay now" })).toBeVisible();
  await expect.poll(async () => (await db.dividendDistribution.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("APPROVED");

  await admin.getByRole("button", { name: "Pay now" }).click();
  const payDialog = admin.getByRole("dialog");
  await expect(payDialog).toContainText("This cannot be undone.");
  await payDialog.getByRole("button", { name: /^Pay \$/ }).click();
  await expect(admin.getByText(/^Paid /)).toBeVisible();
  await expect(admin.getByText("paid", { exact: true })).toBeVisible(); // status badge
  const paid = await db.dividendDistribution.findUniqueOrThrow({ where: { id: draft.id }, include: { payments: true } });
  expect(paid.status).toBe("PAID");

  const payment = paid.payments.find((p) => p.userId === investor.id);
  expect(payment, "investor@demo.test should be paid from this dividend").toBeTruthy();
  expect(payment!.amountCents).toBeGreaterThan(0n);
  const amount = formatCents(payment!.amountCents);

  // ---- investor: notification and activity entry ----
  const me = await newUserPage(DEMO.investor.email, DEMO.investor.password);
  await me.goto("/notifications");
  await expect(me.getByRole("link", { name: `${amount} dividend from ${PROPERTY}` })).toBeVisible();
  await expect(me.getByText(`Your share of ${label} rent from ${PROPERTY} has been added to your wallet.`)).toBeVisible();

  await me.goto("/portfolio/activity?show=dividends");
  const entry = me.getByRole("table", { name: "Account activity" }).getByRole("row").filter({ hasText: `${label} rent dividend from ${PROPERTY}` });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText(`+${amount}`);
});
