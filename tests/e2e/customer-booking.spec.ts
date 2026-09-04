/**
 * Playwright smoke: hosted guest booking (/c/<handle>/book).
 *
 * The four booking routes (/api/customer/booking/…) are stubbed at the network
 * layer, so this exercises the shell, the three steps, both terminal states,
 * the sold-out page and every way a hold can end — never Supabase.
 *
 * Server prerequisite: the dev server must resolve the handle through
 * `companies.public_handle` (P1 migration, live 2026-09-02). The default is
 * the Maverick test company's real handle; override with E2E_CUSTOMER_HANDLE.
 */

import { test, expect, type Page, type Route } from "@playwright/test";

const HANDLE = process.env.E2E_CUSTOMER_HANDLE ?? "maverick-projects-ltd";
const BOOK = `/c/${HANDLE}/book`;
const SIGNIN = `/c/${HANDLE}/signin`;
const GOOD_CODE = "123456";

const TZ = "America/Denver";
/** 09:00 / 11:00 / 13:00 Denver on a Tuesday, then 09:00 the next day. */
const SLOTS = [
  "2027-09-07T15:00:00.000Z",
  "2027-09-07T17:00:00.000Z",
  "2027-09-07T19:00:00.000Z",
  "2027-09-08T15:00:00.000Z",
];

type BookingOutcome = "confirmed" | "submitted";

interface BrokerStub {
  slots?: string[];
  mode?: "instant" | "request";
  outcome?: BookingOutcome;
  bookingRef?: string | null;
  durationMinutes?: number;
  /** Seconds of hold the broker grants. Small values prove the expiry path. */
  holdSeconds?: number;
  retryAfterSeconds?: number;
  hold?: "ok" | "limited" | "taken";
  /** "ok": the code confirms. "taken"/"expired": the confirm refuses for a reason that is not the code. */
  verify?: "ok" | "taken" | "expired" | "count";
  availability?: "ok" | "error" | "gone";
}

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Stub the four booking routes with the documented P2 contracts (design §6). */
async function stubBooking(page: Page, stub: BrokerStub = {}) {
  const slots = stub.slots ?? SLOTS;
  const holdSeconds = stub.holdSeconds ?? 300;
  const holdMode = stub.hold ?? "ok";
  const verifyMode = stub.verify ?? "ok";
  const calls = {
    availability: [] as string[],
    hold: [] as Record<string, unknown>[],
    contact: [] as Record<string, unknown>[],
    verify: [] as Record<string, unknown>[],
  };
  let attemptsRemaining = 5;

  await page.route("**/api/customer/booking/availability**", async (route) => {
    calls.availability.push(route.request().url());
    if (stub.availability === "error") {
      await json(route, 500, { error: "boom" });
      return;
    }
    if (stub.availability === "gone") {
      // What the route answers for a business that has not turned booking on.
      await json(route, 404, { error: "not_found" });
      return;
    }
    await json(route, 200, {
      slots: slots.map((startAt, i) => ({ slot: `sl_${i}`, startAt })),
      timezone: TZ,
      durationMinutes: stub.durationMinutes ?? 60,
      ...(stub.mode ? { mode: stub.mode } : {}),
    });
  });

  await page.route("**/api/customer/booking/hold", async (route) => {
    calls.hold.push(route.request().postDataJSON());
    if (holdMode === "limited") {
      await json(route, 429, {
        error: "rate_limited",
        retryAfterSeconds: stub.retryAfterSeconds ?? 90,
      });
      return;
    }
    if (holdMode === "taken") {
      await json(route, 409, { error: "slot_no_longer_available" });
      return;
    }
    await json(route, 200, {
      intentRef: "in_e2e",
      holdExpiresAt: new Date(Date.now() + holdSeconds * 1000).toISOString(),
    });
  });

  await page.route("**/api/customer/booking/contact", async (route) => {
    calls.contact.push(route.request().postDataJSON());
    await json(route, 200, {
      challengeId: "ch_e2e",
      retryAfterSeconds: stub.retryAfterSeconds ?? 60,
    });
  });

  await page.route("**/api/customer/booking/verify", async (route) => {
    const body = route.request().postDataJSON() as { code?: string; email?: string };
    calls.verify.push(body);
    if (verifyMode === "taken") {
      await json(route, 409, { error: "slot_no_longer_available" });
      return;
    }
    if (verifyMode === "expired") {
      await json(route, 410, { error: "hold_expired" });
      return;
    }
    if (verifyMode === "count") {
      if (attemptsRemaining <= 0) {
        await json(route, 400, { error: "challenge_exhausted" });
        return;
      }
      if (body.code !== GOOD_CODE) {
        attemptsRemaining -= 1;
        await json(route, 400, { error: "invalid_code", attemptsRemaining });
        return;
      }
    }
    await json(route, 200, {
      outcome: stub.outcome ?? "confirmed",
      ...(stub.bookingRef === undefined ? { bookingRef: "bk_e2e" } : stub.bookingRef === null ? {} : { bookingRef: stub.bookingRef }),
    });
  });

  return calls;
}

async function typeCode(page: Page, code: string) {
  for (let i = 0; i < code.length; i += 1) {
    await page.getByLabel(`Digit ${i + 1} of 6`).fill(code[i]);
  }
}

/** Step 1 → step 2: take the first open time on the day the page opened on. */
async function pickFirstTime(page: Page) {
  await page.locator("[data-booking-step='time']").waitFor();
  await page.locator("[data-slot-time]").first().click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.locator("[data-booking-step='details']").waitFor();
}

async function fillDetails(page: Page) {
  await page.getByLabel(/^name$/i).fill("Jordan Lee");
  await page.getByLabel(/^email$/i).fill("jordan@example.com");
  await page.getByRole("button", { name: /send code/i }).click();
  await page.locator("[data-booking-step='code']").waitFor();
}

test.describe("hosted guest booking", () => {
  // The smoke runs against a dev server that compiles routes on first hit;
  // the repo-wide 15s navigation budget is for a warm production-like build.
  test.describe.configure({ timeout: 120_000 });
  test.use({ navigationTimeout: 90_000, actionTimeout: 20_000 });

  test("pick a time → details → code → booked, inside the company letterhead", async ({ page }) => {
    const calls = await stubBooking(page);
    await page.goto(BOOK);

    // The shell is the same one sign-in uses.
    const shell = page.locator(".customer-shell");
    await expect(shell).toBeVisible();
    await expect(shell.locator("header")).toContainText(/\S/);
    await expect(shell.locator("footer")).toContainText(/powered by/i);

    // Step 1 opens on the soonest day with real times already on screen.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/pick a time/i);
    await expect(page.getByText("STEP 01 / 03")).toBeVisible();
    await expect(page.getByRole("group", { name: "DAY" }).getByRole("button")).toHaveCount(2);
    await expect(page.getByRole("group", { name: "TIME" }).getByRole("button")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "9:00 AM" })).toBeVisible();

    // Times read on the business's clock, with the duration and zone stated once.
    await expect(page.getByText("60 MIN VISIT · TIMES IN MDT")).toBeVisible();

    // Nothing is held until CONTINUE: tapping around the grid costs no hold (I13).
    await expect(page.getByRole("button", { name: /^continue$/i })).toBeDisabled();
    await page.getByRole("button", { name: "11:00 AM" }).click();
    await page.getByRole("button", { name: "9:00 AM" }).click();
    expect(calls.hold).toHaveLength(0);

    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.locator("[data-booking-step='details']").waitFor();
    expect(calls.hold).toEqual([{ handle: HANDLE, slot: "sl_0" }]);

    // Step 2 carries the chosen time and its hold, quietly.
    await expect(page.getByText("STEP 02 / 03")).toBeVisible();
    await expect(page.getByText("Tue, Sep 7 · 9:00 AM")).toBeVisible();
    await expect(page.locator("[data-hold-remaining]")).toContainText(/TIME HELD [45]:\d\d/);

    await page.getByLabel(/^name$/i).fill("Jordan Lee");
    await page.getByLabel(/^email$/i).fill("jordan@example.com");
    await page.getByLabel(/phone/i).fill("403-555-0199");
    await page.getByRole("button", { name: /send code/i }).click();

    // Step 3 is the sign-in code widget, bound to this intent.
    await page.locator("[data-booking-step='code']").waitFor();
    await expect(page.getByText("STEP 03 / 03")).toBeVisible();
    await expect(page.getByText(/sent to jordan@example.com/i)).toBeVisible();
    expect(calls.contact).toEqual([
      {
        handle: HANDLE,
        intentRef: "in_e2e",
        name: "Jordan Lee",
        email: "jordan@example.com",
        phone: "403-555-0199",
      },
    ]);

    await typeCode(page, GOOD_CODE);

    // Terminal state: booked, with the date and what happens next.
    await expect(page.locator("[data-booking-outcome='confirmed']")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/you're booked/i);
    await expect(page.getByText("Tue, Sep 7 · 9:00 AM")).toBeVisible();
    await expect(page.getByText(/a confirmation is on the way to jordan@example.com/i)).toBeVisible();
    await expect(page.getByText("REF bk_e2e")).toBeVisible();
    expect(calls.verify).toEqual([
      {
        handle: HANDLE,
        intentRef: "in_e2e",
        challengeId: "ch_e2e",
        code: GOOD_CODE,
        email: "jordan@example.com",
      },
    ]);

    // The account is offered once, quietly, and never blocks anything.
    const signIn = page.getByRole("link", { name: /^sign in$/i });
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute("href", SIGNIN);
    await expect(page.getByText(/sign in with this email to follow your visit/i)).toBeVisible();
  });

  test("a request-mode business gets a different ending: honest, not booked", async ({ page }) => {
    await stubBooking(page, { mode: "request", outcome: "submitted", bookingRef: null });
    await page.goto(BOOK);

    // The promise is honest before the commitment, not only after it.
    await expect(page.getByText(/confirms it after/i)).toBeVisible();

    await pickFirstTime(page);
    await fillDetails(page);
    await typeCode(page, GOOD_CODE);

    await expect(page.locator("[data-booking-outcome='submitted']")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/request sent/i);
    await expect(page.getByText("AWAITING CONFIRMATION")).toBeVisible();
    await expect(page.getByText(/the time isn't held until they do/i)).toBeVisible();
    // Nothing here may claim a booking.
    await expect(page.locator("main")).not.toContainText(/you're booked/i);
    // No reference exists yet, so none is invented.
    await expect(page.locator("main")).not.toContainText(/^REF/);
  });

  test("a business with nothing open says so — no row of disabled days", async ({ page }) => {
    await stubBooking(page, { slots: [] });
    await page.goto(BOOK);

    await expect(page.locator("[data-booking-step='empty']")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/no open times/i);
    await expect(page.getByText(/has no visit times open right now/i)).toBeVisible();
    // Absence, not explanation: there is no day or time control on the page at all.
    await expect(page.locator("[data-day]")).toHaveCount(0);
    await expect(page.locator("[data-slot-time]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /continue/i })).toHaveCount(0);
  });

  test("an expired hold returns to step one with the details kept", async ({ page }) => {
    await stubBooking(page, { holdSeconds: 3 });
    await page.goto(BOOK);
    await pickFirstTime(page);

    await page.getByLabel(/^name$/i).fill("Jordan Lee");
    await page.getByLabel(/^email$/i).fill("jordan@example.com");

    // The hold runs out while they are typing.
    await page.locator("[data-booking-step='time']").waitFor({ timeout: 15_000 });
    await expect(page.getByText(/that time was released/i)).toBeVisible();
    await expect(page.getByText(/your details are saved/i)).toBeVisible();

    // Back through the flow, the typing is exactly where they left it.
    await page.locator("[data-slot-time]").first().click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.locator("[data-booking-step='details']").waitFor();
    await expect(page.getByLabel(/^name$/i)).toHaveValue("Jordan Lee");
    await expect(page.getByLabel(/^email$/i)).toHaveValue("jordan@example.com");
  });

  test("a slot taken during the confirm is not treated as a bad code (I12)", async ({ page }) => {
    await stubBooking(page, { verify: "taken" });
    await page.goto(BOOK);
    await pickFirstTime(page);
    await fillDetails(page);
    await typeCode(page, GOOD_CODE);

    await page.locator("[data-booking-step='time']").waitFor();
    await expect(page.getByText(/that time was just taken/i)).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/that code didn't work/i);
  });

  test("the hold cap is refused honestly, with the wait", async ({ page }) => {
    await stubBooking(page, { hold: "limited", retryAfterSeconds: 90 });
    await page.goto(BOOK);
    await page.locator("[data-booking-step='time']").waitFor();
    await page.locator("[data-slot-time]").first().click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    await expect(page.locator("main").getByRole("alert")).toHaveText(
      /too many times held at once\. try again in 1:30\./i
    );
    await expect(page.locator("[data-booking-step='time']")).toBeVisible();
  });

  test("a wrong code stays on step three and never blames the slot", async ({ page }) => {
    await stubBooking(page, { verify: "count" });
    await page.goto(BOOK);
    await pickFirstTime(page);
    await fillDetails(page);

    await typeCode(page, "111111");
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toHaveText(/that code didn't work/i);
    await expect(page.getByLabel("Digit 1 of 6")).toHaveValue("");
    await expect(page.locator("[data-booking-step='code']")).toBeVisible();
    // The hold survives a wrong code.
    await expect(page.locator("[data-hold-remaining]")).toBeVisible();

    await typeCode(page, GOOD_CODE);
    await expect(page.locator("[data-booking-outcome='confirmed']")).toBeVisible();
  });

  test("details are validated before anything is sent", async ({ page }) => {
    const calls = await stubBooking(page);
    await page.goto(BOOK);
    await pickFirstTime(page);

    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText(/enter your name/i);

    await page.getByLabel(/^name$/i).fill("Jordan Lee");
    await page.getByLabel(/^email$/i).fill("jordan");
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText(/enter a valid email/i);

    await page.getByLabel(/^email$/i).fill("jordan@example.com");
    await page.getByLabel(/phone/i).fill("55");
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText(/valid phone number/i);

    expect(calls.contact).toHaveLength(0);
  });

  test("changing the time or the details keeps everything already typed", async ({ page }) => {
    await stubBooking(page);
    await page.goto(BOOK);
    await pickFirstTime(page);
    await fillDetails(page);

    await page.getByRole("button", { name: /change your details/i }).click();
    await page.locator("[data-booking-step='details']").waitFor();
    await expect(page.getByLabel(/^name$/i)).toHaveValue("Jordan Lee");

    await page.getByRole("button", { name: /change time/i }).click();
    await page.locator("[data-booking-step='time']").waitFor();
    // Nothing was lost, and no notice claims something went wrong.
    await expect(page.locator("main")).not.toContainText(/was released|was just taken/i);
  });

  test("a second day's times replace the first day's", async ({ page }) => {
    await stubBooking(page);
    await page.goto(BOOK);
    await page.locator("[data-booking-step='time']").waitFor();

    await expect(page.locator("[data-slot-time]")).toHaveCount(3);
    await page.locator("[data-day='2027-09-08']").click();
    await expect(page.locator("[data-slot-time]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "9:00 AM" })).toBeVisible();
    // Switching days clears a pick made on the day before it.
    await expect(page.getByRole("button", { name: /^continue$/i })).toBeDisabled();
  });

  test("an availability outage offers a retry, not a dead page", async ({ page }) => {
    await stubBooking(page, { availability: "error" });
    await page.goto(BOOK);

    await expect(page.locator("main").getByRole("alert")).toHaveText(
      /couldn't load available times/i
    );
    await page.unrouteAll();
    await stubBooking(page);
    await page.getByRole("button", { name: /^retry$/i }).click();
    await expect(page.locator("[data-booking-step='time']")).toBeVisible();
  });

  test("booking switched off reads exactly like an unknown link", async ({ page }) => {
    await stubBooking(page, { availability: "gone" });
    await page.goto(BOOK);

    await expect(page.locator("[data-booking-step='gone']")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/page not available/i);
    // Nothing here may hint at why: no times, no retry, no explanation.
    await expect(page.locator("[data-slot-time]")).toHaveCount(0);
    await expect(page.locator("main").getByRole("button")).toHaveCount(0);
  });

  test("an unknown handle renders the neutral not-found page", async ({ page }) => {
    const response = await page.goto("/c/no-such-business-zz/book");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/page not available/i);
  });
});
