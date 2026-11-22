import { PrismaClient } from "@prisma/client";
import { test as base, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_DATABASE_URL } from "./env";

/** Direct access to the e2e database, for picking test subjects and checking outcomes. */
export const db = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } });

/** Remote photos are irrelevant to these tests and may be blocked; answer them locally. */
async function stubImages(context: BrowserContext) {
  await context.route(/images\.unsplash\.com/, (route) => route.fulfill({ status: 200, contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") }));
}

export const test = base.extend<{ newUserPage: (email: string, password: string) => Promise<Page> }>({
  context: async ({ context }, use) => {
    await stubImages(context);
    await use(context);
  },
  /** A logged-in page in its own browser context, so several users can act within one test. */
  newUserPage: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (email, password) => {
      const ctx = await newContext(browser);
      contexts.push(ctx);
      const page = await ctx.newPage();
      await logIn(page, email, password);
      return page;
    });
    for (const c of contexts) await c.close();
  },
});

export { expect };

export async function newContext(browser: Browser) {
  const ctx = await browser.newContext();
  await stubImages(ctx);
  return ctx;
}

export async function logIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
}

export const UNITS_PER_SHARE = 1_000_000n;
