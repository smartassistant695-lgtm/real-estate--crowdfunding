import type { Page } from "@playwright/test";
import { formatBps, ratioBps } from "../../src/lib/domain/money";
import { decide, tallyVotes, type Outcome } from "../../src/lib/domain/voting";
import { DEMO } from "./env";
import { db, expect, test } from "./fixtures";

const TITLE = "Take a $90,000 mortgage and pay it out to holders";
const LABEL: Record<Outcome, string> = { PASSED: "Passed", FAILED: "Did not pass", NO_QUORUM: "No quorum" };
const OPTION = { FOR: /^For\b/, AGAINST: /^Against\b/, ABSTAIN: /^Abstain\b/ } as const;
type Choice = keyof typeof OPTION;

async function vote(page: Page, proposalId: string, choice: Choice, change = false) {
  await page.goto(`/proposals/${proposalId}`);
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  await page.getByRole("radio", { name: OPTION[choice] }).check();
  await page.getByRole("button", { name: change ? "Change vote" : "Cast vote" }).click();
  const word = { FOR: "for", AGAINST: "against", ABSTAIN: "to abstain" }[choice];
  await expect(page.getByText(`Your vote ${word} is recorded.`)).toBeVisible();
}

test("holders vote, one changes their vote, admin closes early and the result follows the rules", async ({ newUserPage }) => {
  const proposal = await db.proposal.findFirstOrThrow({ where: { title: TITLE }, include: { property: true } });
  expect(proposal.status).toBe("OPEN");
  expect(proposal.property.name).toBe("Holmes Street Duplex");
  expect(proposal.recordDate.getTime()).toBeLessThan(Date.now());

  // Holders on the record date who have not voted yet, largest first.
  const voted = new Set((await db.vote.findMany({ where: { proposalId: proposal.id } })).map((v) => v.userId));
  const lots = await db.holdingLot.findMany({ where: { propertyId: proposal.propertyId, acquiredAt: { lt: proposal.recordDate } }, select: { userId: true } });
  const eligible = new Set(lots.map((l) => l.userId));
  const holders = await db.holding.findMany({
    where: { propertyId: proposal.propertyId, shareUnits: { gt: 0n }, user: { role: "INVESTOR" } },
    include: { user: true },
    orderBy: [{ shareUnits: "desc" }, { userId: "asc" }],
  });
  const voters = holders.filter((h) => !voted.has(h.userId) && eligible.has(h.userId)).slice(0, 3);
  expect(voters).toHaveLength(3);
  const password = (email: string) => (email === DEMO.investor.email ? DEMO.investor.password : DEMO.othersPassword);

  const pages: Page[] = [];
  const plan: Choice[] = ["FOR", "FOR", "AGAINST"];
  for (const [i, h] of voters.entries()) {
    const page = await newUserPage(h.user.email, password(h.user.email));
    pages.push(page);
    await vote(page, proposal.id, plan[i]!);
  }
  // The second voter changes their mind.
  await vote(pages[1]!, proposal.id, "AGAINST", true);
  await expect(pages[1]!.getByRole("button", { name: "Change vote" })).toBeDisabled(); // current choice is selected

  const votes = await db.vote.findMany({ where: { proposalId: proposal.id } });
  const mine = votes.filter((v) => voters.some((h) => h.userId === v.userId));
  expect(mine.map((v) => [v.userId, v.choice]).sort()).toEqual(voters.map((h, i) => [h.userId, i === 1 ? "AGAINST" : plan[i]]).sort());

  // Expected outcome straight from the domain rules.
  const tally = tallyVotes(votes);
  const expected = decide(tally, proposal.outstandingUnits, proposal.quorumBps, proposal.passThresholdBps);
  expect(proposal.quorumBps).toBe(3000);
  expect(proposal.passThresholdBps).toBe(5000);
  expect(proposal.votingCapBps).toBe(2000);

  // ---- admin closes voting early ----
  const admin = await newUserPage(DEMO.admin.email, DEMO.admin.password);
  await admin.goto(`/admin/proposals/${proposal.id}`);
  await expect(admin.getByRole("heading", { name: TITLE })).toBeVisible();
  await admin.getByRole("button", { name: "Close voting early" }).click();
  const dialog = admin.getByRole("dialog");
  await expect(dialog).toContainText("Close voting before the deadline?");
  await dialog.getByRole("button", { name: "Close voting" }).click();

  await expect(admin.getByRole("button", { name: "Close voting early" })).toHaveCount(0);
  await expect(admin.getByText(LABEL[expected], { exact: true }).first()).toBeVisible();
  const decisive = tally.forUnits + tally.againstUnits;
  await expect(admin.locator("dt", { hasText: /^For \(of decisive votes\)$/ }).locator("xpath=following-sibling::dd[1]")).toHaveText(formatBps(ratioBps(tally.forUnits, decisive), { decimals: 1 }));
  await expect(admin.locator("dt", { hasText: /^Turnout$/ }).locator("xpath=following-sibling::dd[1]")).toHaveText(formatBps(ratioBps(tally.rawParticipatingUnits, proposal.outstandingUnits), { decimals: 1 }));

  const final = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
  expect(final.status).toBe(expected);
  expect(final.forUnits).toBe(tally.forUnits);
  expect(final.againstUnits).toBe(tally.againstUnits);
  expect(final.abstainUnits).toBe(tally.abstainUnits);

  // The investor-facing page shows the same result.
  await pages[0]!.goto(`/proposals/${proposal.id}`);
  await expect(pages[0]!.getByText(LABEL[expected], { exact: true }).first()).toBeVisible();
});
