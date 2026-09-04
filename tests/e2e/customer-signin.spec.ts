/**
 * Playwright smoke: hosted customer sign-in (/c/<handle>/signin → /home).
 *
 * The broker routes (/api/customer/…) are stubbed at the network layer, so
 * this exercises the shell, the two-step flow, the code input, the resend
 * gate and the three home states — never Supabase Auth.
 *
 * Server prerequisite: the dev server must resolve the handle through
 * `companies.public_handle` (P1 migration, live 2026-09-02). The default is
 * the Maverick test company's real handle; override with E2E_CUSTOMER_HANDLE.
 * Against a database without the migration, point the dev-only fixture pair
 * (`OPS_CUSTOMER_HOSTED_FIXTURE_HANDLE` / `..._COMPANY_ID` in `.env.local`) at
 * the handle under test instead.
 */

import { test, expect, type Page, type Route } from "@playwright/test";

const HANDLE = process.env.E2E_CUSTOMER_HANDLE ?? "maverick-projects-ltd";
const SIGNIN = `/c/${HANDLE}/signin`;
const HOME = `/c/${HANDLE}/home`;
const GOOD_CODE = "123456";

type MembershipState = "active_full" | "active_forward_only" | "none";

interface BrokerStub {
  retryAfterSeconds?: number;
  startStatus?: number;
  membership?: MembershipState;
  me?: "ok" | "unauthenticated" | "gone";
  /** "count": five attempts per challenge, then exhausted. "closed": the challenge is already dead. */
  verify?: "count" | "closed";
}

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** Stub every broker route with the documented P1 contracts. */
async function stubBroker(page: Page, stub: BrokerStub = {}) {
  const retryAfterSeconds = stub.retryAfterSeconds ?? 60;
  const startStatus = stub.startStatus ?? 200;
  const membership = stub.membership ?? "active_forward_only";
  const meMode = stub.me ?? "ok";
  const verifyMode = stub.verify ?? "count";
  const calls = { start: [] as unknown[], verify: [] as unknown[], signout: 0 };
  let attemptsRemaining = 5;

  await page.route("**/api/customer/auth/start", async (route) => {
    calls.start.push(route.request().postDataJSON());
    if (startStatus === 429) {
      await json(route, 429, { error: "rate_limited", retryAfterSeconds });
      return;
    }
    if (startStatus === 503) {
      await json(route, 503, { error: "customer_identity_unavailable" });
      return;
    }
    // Same shape for every email (I5).
    await json(route, 200, { challengeId: "ch_e2e", retryAfterSeconds });
  });

  await page.route("**/api/customer/auth/verify", async (route) => {
    const body = route.request().postDataJSON() as { code?: string; email?: string };
    calls.verify.push(body);
    // Contract: the code is bound to the email at the provider — no email, no verify.
    if (typeof body.email !== "string" || body.email.length === 0) {
      await json(route, 400, { error: "invalid_request" });
      return;
    }
    if (verifyMode === "closed") {
      await json(route, 400, { error: "challenge_closed" });
      return;
    }
    if (attemptsRemaining <= 0) {
      await json(route, 400, { error: "challenge_exhausted" });
      return;
    }
    if (body.code === GOOD_CODE) {
      await json(route, 200, { ok: true, next: HOME });
      return;
    }
    attemptsRemaining -= 1;
    await json(route, 400, { error: "invalid_code", attemptsRemaining });
  });

  await page.route("**/api/customer/me**", async (route) => {
    if (meMode === "unauthenticated") {
      await json(route, 401, { error: "unauthenticated" });
      return;
    }
    if (meMode === "gone") {
      await json(route, 404, { error: "not_found" });
      return;
    }
    await json(route, 200, {
      displayName: "Jordan Lee",
      maskedEmail: "j•••@example.com",
      membership: { state: membership },
    });
  });

  await page.route("**/api/customer/auth/signout", async (route) => {
    calls.signout += 1;
    await json(route, 204, {});
  });

  return calls;
}

async function typeCode(page: Page, code: string) {
  for (let i = 0; i < code.length; i += 1) {
    await page.getByLabel(`Digit ${i + 1} of 6`).fill(code[i]);
  }
}

test.describe("hosted customer sign-in", () => {
  // The smoke runs against a dev server that compiles routes on first hit;
  // the repo-wide 15s navigation budget is for a warm production-like build.
  test.describe.configure({ timeout: 120_000 });
  test.use({ navigationTimeout: 90_000, actionTimeout: 20_000 });

  test("email → code → home, with the company letterhead and powered-by OPS", async ({ page }) => {
    const calls = await stubBroker(page);
    await page.goto(SIGNIN);

    // Letterhead + footer belong to the shell.
    const shell = page.locator(".customer-shell");
    await expect(shell).toBeVisible();
    await expect(shell.locator("header")).toContainText(/\S/);
    await expect(shell.locator("footer")).toContainText(/powered by/i);
    await expect(shell.locator("footer").getByRole("img", { name: "OPS" })).toBeVisible();

    // Step 1
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/sign in/i);
    await expect(page.getByText("STEP 01 / 02")).toBeVisible();
    await page.getByLabel(/^email$/i).fill("jordan@example.com");
    await page.getByRole("button", { name: /send code/i }).click();

    // Step 2
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/enter code/i);
    await expect(page.getByText("STEP 02 / 02")).toBeVisible();
    await expect(page.getByText(/sent to jordan@example.com/i)).toBeVisible();
    expect(calls.start).toEqual([{ handle: HANDLE, email: "jordan@example.com" }]);

    // Resend is gated by the broker's window.
    const resend = page.getByRole("button", { name: /resend in/i });
    await expect(resend).toBeDisabled();
    await expect(resend).toHaveText(/RESEND IN (1:00|0:5\d)/);

    // Wrong code → error copy that never mentions account existence; cells cleared.
    await typeCode(page, "111111");
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toHaveText(/that code didn't work/i);
    await expect(alert).not.toHaveText(/account|exist|registered/i);
    await expect(page.getByLabel("Digit 1 of 6")).toHaveValue("");
    await expect(page.getByLabel("Digit 1 of 6")).toBeFocused();

    // Right code auto-submits and lands on home.
    await typeCode(page, GOOD_CODE);
    await page.waitForURL(`**${HOME}`);
    expect(calls.verify).toEqual([
      { handle: HANDLE, challengeId: "ch_e2e", code: "111111", email: "jordan@example.com" },
      { handle: HANDLE, challengeId: "ch_e2e", code: GOOD_CODE, email: "jordan@example.com" },
    ]);

    // Forward-only membership copy.
    await expect(page.locator("[data-membership-view='forward_only']")).toBeVisible();
    await expect(page.getByText(/past history appears once/i)).toBeVisible();
    await expect(page.getByText("j•••@example.com")).toBeVisible();
    await expect(page.getByText("Jordan Lee")).toBeVisible();

    // Sign out returns to the door.
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(`**${SIGNIN}`);
    expect(calls.signout).toBe(1);
  });

  test("pasting a code fills all six cells and submits", async ({ page }) => {
    await stubBroker(page);
    await page.goto(SIGNIN);
    await page.getByLabel(/^email$/i).fill("jordan@example.com");
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page.getByLabel("Digit 1 of 6")).toBeFocused();

    await page.evaluate(async (code) => {
      const target = document.activeElement as HTMLInputElement;
      const dt = new DataTransfer();
      dt.setData("text", `Your code is ${code}`);
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, GOOD_CODE);

    await page.waitForURL(`**${HOME}`);
  });

  test("unknown and known emails produce an identical code step (I5)", async ({ page }) => {
    await stubBroker(page);
    await page.goto(SIGNIN);
    await page.getByLabel(/^email$/i).fill("nobody-here@example.com");
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/enter code/i);
    await expect(page.locator("main")).not.toContainText(/no account|not found|doesn't exist|not registered/i);
  });

  test("resend unlocks after the window and re-arms it", async ({ page }) => {
    await stubBroker(page, { retryAfterSeconds: 2 });
    await page.goto(SIGNIN);
    await page.getByLabel(/^email$/i).fill("jordan@example.com");
    await page.getByRole("button", { name: /send code/i }).click();

    const resend = page.getByRole("button", { name: /resend/i });
    await expect(resend).toBeDisabled();
    await expect(resend).toBeEnabled({ timeout: 5000 });
    await expect(resend).toHaveText(/resend code/i);
    await resend.click();
    await expect(page.getByText(/new code sent/i)).toBeVisible();
    await expect(resend).toBeDisabled();
  });

  test("rate limit and outage show honest, non-revealing errors on the email step", async ({ page }) => {
    await stubBroker(page, { startStatus: 429, retryAfterSeconds: 90 });
    await page.goto(SIGNIN);
    await page.getByLabel(/^email$/i).fill("jordan@example.com");
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText(/too many requests\. try again in 1:30\./i);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/sign in/i);

    await page.unrouteAll();
    await stubBroker(page, { startStatus: 503 });
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText(/unavailable right now/i);
  });

  test("a bad email never leaves the page", async ({ page }) => {
    const calls = await stubBroker(page);
    await page.goto(SIGNIN);
    await page.getByLabel(/^email$/i).fill("jordan");
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText(/enter a valid email/i);
    expect(calls.start).toHaveLength(0);
  });

  test("home renders full and none states from membership.state", async ({ page }) => {
    await stubBroker(page, { membership: "active_full" });
    await page.goto(HOME);
    await expect(page.locator("[data-membership-view='full']")).toBeVisible();
    await expect(page.getByText(/estimates and invoices from/i)).toBeVisible();

    await page.unrouteAll();
    await stubBroker(page, { membership: "none" });
    await page.goto(HOME);
    await expect(page.locator("[data-membership-view='none']")).toBeVisible();
    await expect(page.getByText(/nothing here yet/i)).toBeVisible();
  });

  test("home without a session goes back to sign-in", async ({ page }) => {
    await stubBroker(page, { me: "unauthenticated" });
    await page.goto(HOME);
    await page.waitForURL(`**${SIGNIN}`);
  });

  test("remaining attempts surface only when scarce, and a dead challenge offers a new code", async ({ page }) => {
    await stubBroker(page);
    await page.goto(SIGNIN);
    await page.getByLabel(/^email$/i).fill("jordan@example.com");
    await page.getByRole("button", { name: /send code/i }).click();
    const alert = page.locator("main").getByRole("alert");

    // 5 → 4 → 3 attempts left: neutral copy, no number.
    await typeCode(page, "111111");
    await expect(alert).toHaveText("That code didn't work. Check it and try again.");
    await typeCode(page, "222222");
    await expect(alert).toHaveText("That code didn't work. Check it and try again.");

    // 2 left, then 1 left: the number appears.
    await typeCode(page, "333333");
    await expect(alert).toHaveText("That code didn't work. 2 attempts left.");
    await typeCode(page, "444444");
    await expect(alert).toHaveText("That code didn't work. 1 attempt left.");

    // 0 left: the challenge is dead — cells lock, VERIFY is replaced by SEND A NEW CODE.
    await typeCode(page, "555555");
    await expect(alert).toHaveText(/too many attempts/i);
    await expect(page.locator("form[data-challenge-dead='true']")).toBeVisible();
    await expect(page.getByLabel("Digit 1 of 6")).toBeDisabled();
    await expect(page.getByRole("button", { name: /^verify$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /resend/i })).toHaveCount(0);

    // Back to step one with the email kept.
    await page.getByRole("button", { name: /send a new code/i }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/sign in/i);
    await expect(page.getByLabel(/^email$/i)).toHaveValue("jordan@example.com");
    await expect(page.getByText("STEP 01 / 02")).toBeVisible();
  });

  test("a closed challenge (expired or consumed) reads as expired and offers a new code", async ({ page }) => {
    await stubBroker(page, { verify: "closed" });
    await page.goto(SIGNIN);
    await page.getByLabel(/^email$/i).fill("jordan@example.com");
    await page.getByRole("button", { name: /send code/i }).click();
    await typeCode(page, GOOD_CODE);
    await expect(page.locator("main").getByRole("alert")).toHaveText(/that code expired/i);
    await expect(page.getByRole("button", { name: /send a new code/i })).toBeVisible();
  });

  test("home shows the unknown-business page when the broker answers 404", async ({ page }) => {
    await stubBroker(page, { me: "gone" });
    await page.goto(HOME);
    await expect(page.locator("[data-membership-view='gone']")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/page not available/i);
  });

  test("an unknown handle renders the neutral not-found page", async ({ page }) => {
    const response = await page.goto("/c/no-such-business-zz/signin");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/page not available/i);
    await expect(page.locator("body")).toContainText(/powered by/i);
  });
});
