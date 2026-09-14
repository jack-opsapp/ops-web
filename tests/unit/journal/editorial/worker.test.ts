import { describe, expect, it, vi } from "vitest";
import {
  JOURNAL_STALL_COPY,
  clampToLiveWindow,
  computeJournalPublishAt,
  journalDelivery,
  launchLabel,
  newsletterSendAt,
  runJournalTick,
  type JournalTickDependencies,
  type JournalWorkerRepository,
  type JournalWorkerRow,
} from "@/lib/journal/editorial/worker";

const operator = { userId: "user-1", companyId: "0f6f0a8e-2d3b-4c4d-9e5f-6a7b8c9d0e1f" };
const SLOT = "2026-09-14T13:00:00.000Z"; // Monday 06:00 Vancouver
const at = (iso: string) => new Date(iso);

function row(overrides: Partial<JournalWorkerRow> = {}): JournalWorkerRow {
  return {
    id: "a1",
    identity: "weekly:2026-09-14",
    state: "drafted",
    mode: "publish",
    slot_at: SLOT,
    publish_at: null,
    drafted_at: "2026-09-13T14:00:00.000Z",
    published_at: null,
    title: "THE FIRST CALL DECIDES THE WHOLE WEEK",
    last_code: null,
    package: {
      article: { title: "THE FIRST CALL DECIDES THE WHOLE WEEK", hero_line: "The job starts when the phone rings" },
    } as never,
    attempt_log: [],
    notified_state: null,
    blog_id: null,
    newsletter_state: null,
    ...overrides,
  };
}

function repository(overrides: Partial<JournalWorkerRepository> = {}): JournalWorkerRepository {
  return {
    recover: vi.fn(async () => 0),
    discover: vi.fn(async () => ({ created: 0, missed: 0 })),
    readMode: vi.fn(async () => "publish" as const),
    readMinVetoMinutes: vi.fn(async () => 360),
    listDrafted: vi.fn(async () => []),
    listDue: vi.fn(async () => []),
    schedule: vi.fn(async () => "scheduled"),
    annotate: vi.fn(async () => true),
    block: vi.fn(async () => "blocked"),
    publish: vi.fn(async () => ({ state: "published" as const, blog_id: "b1" })),
    listUndelivered: vi.fn(async () => []),
    deliver: vi.fn(async () => true),
    checkStall: vi.fn(async () => false),
    resolveStall: vi.fn(async () => 0),
    newsletterEnabled: vi.fn(async () => false),
    listNewsletterCandidates: vi.fn(async () => []),
    claimNewsletter: vi.fn(async () => true),
    finishNewsletter: vi.fn(async () => true),
    ...overrides,
  };
}

const asset = {
  url: "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/journal/2026-09-14-0123456789abcdef.jpg",
  storage_key: "blog/journal/2026-09-14-0123456789abcdef.jpg",
  backend: "s3" as const,
  sha256: "0".repeat(64),
  width: 1200,
  height: 630,
  bytes: 40000,
  content_type: "image/jpeg" as const,
  render_version: "journal-hero-2026-09-10-v1",
};

function deps(repo: JournalWorkerRepository, now: string, overrides: Partial<JournalTickDependencies> = {}): JournalTickDependencies {
  return {
    now: () => at(now),
    operator,
    repository: repo,
    renderHero: vi.fn(async () => ({ buffer: Buffer.from("x"), width: 1200, height: 630, contentType: "image/jpeg" as const })),
    storeHero: vi.fn(async () => asset),
    heroReadable: vi.fn(async () => true),
    sendNewsletter: vi.fn(async () => ({ sent: 13, failed: 0 })),
    newToken: () => "33333333-3333-4333-8333-333333333333",
    ...overrides,
  };
}

describe("journal timing", () => {
  it("launches an on-time draft at its Monday slot", () => {
    expect(computeJournalPublishAt(at(SLOT), at("2026-09-13T14:00:00Z"), 360).toISOString()).toBe(SLOT);
    expect(computeJournalPublishAt(at(SLOT), at("2026-09-14T05:00:00Z"), 360).toISOString()).toBe(SLOT);
  });

  it("gives a late draft its full veto window, and never launches at night", () => {
    // Monday 05:00 Vancouver draft → 11:00 Vancouver.
    expect(computeJournalPublishAt(at(SLOT), at("2026-09-14T12:00:00Z"), 360).toISOString()).toBe("2026-09-14T18:00:00.000Z");
    // Monday 19:00 Vancouver draft → 01:00 → Tuesday 06:00.
    expect(computeJournalPublishAt(at(SLOT), at("2026-09-15T02:00:00Z"), 360).toISOString()).toBe("2026-09-15T13:00:00.000Z");
    expect(clampToLiveWindow(at("2026-09-14T11:00:00Z")).toISOString()).toBe("2026-09-14T13:00:00.000Z");
  });

  it("mails the Tuesday after publication at 10:00 Vancouver", () => {
    expect(newsletterSendAt(at("2026-09-14T13:09:00Z")).toISOString()).toBe("2026-09-15T17:00:00.000Z");
    expect(newsletterSendAt(at("2026-09-15T17:30:00Z")).toISOString()).toBe("2026-09-22T17:00:00.000Z");
  });

  it("labels the launch the way the rail reads it", () => {
    expect(launchLabel(SLOT)).toBe("Mon Sep 14 · 06:00");
  });
});

describe("journal rail items", () => {
  it("names the launch when the post will go live on its own", () => {
    const delivery = journalDelivery(row({ state: "scheduled", publish_at: SLOT }), "publish")!;
    expect(delivery).toMatchObject({
      title: "JOURNAL POST READY",
      body: "THE FIRST CALL DECIDES THE WHOLE WEEK goes live Mon Sep 14 · 06:00 unless you stop it.",
      persistent: true,
      actionUrl: "/admin/blog?journal=a1",
      actionLabel: "PREVIEW",
      dedupeKey: "journal:weekly:2026-09-14:ready",
    });
  });

  it("says the post waits when either control holds it", () => {
    expect(journalDelivery(row({ state: "scheduled", publish_at: SLOT }), "prepare")!.body).toBe(
      "THE FIRST CALL DECIDES THE WHOLE WEEK is ready. It waits for your go."
    );
    expect(journalDelivery(row({ state: "scheduled", mode: "prepare", publish_at: SLOT }), "publish")!.body).toContain("waits for your go");
  });

  it("clears the ready item when the post goes live, is blocked or is stopped", () => {
    expect(journalDelivery(row({ state: "published" }), "publish")).toMatchObject({ title: "JOURNAL POST LIVE", persistent: false, resolvePrefix: "journal:weekly:2026-09-14:" });
    expect(journalDelivery(row({ state: "blocked", last_code: "SLOT_MISSED" }), "publish")).toMatchObject({
      title: "JOURNAL POST BLOCKED",
      body: "No draft arrived in time. Nothing went live this week.",
      resolvePrefix: "journal:weekly:2026-09-14:ready",
    });
    expect(journalDelivery(row({ state: "cancelled" }), "publish")).toMatchObject({ title: null, resolvePrefix: "journal:weekly:2026-09-14:" });
    expect(journalDelivery(row({ state: "queued" }), "publish")).toBeNull();
  });

  it("never uses an exclamation point or the banned audience word", () => {
    const copies = ["SLOT_MISSED", "ATTEMPTS_EXHAUSTED", "WEEKLY_ALREADY_LIVE", "HERO_FAILED", "UNKNOWN"].map(
      (code) => journalDelivery(row({ state: "blocked", last_code: code }), "publish")!.body!
    );
    for (const text of [...copies, JOURNAL_STALL_COPY.body]) {
      expect(text).not.toMatch(/!|contractor/i);
    }
  });
});

describe("runJournalTick", () => {
  it("recovers, discovers, promotes, publishes, notifies and checks the stall in order", async () => {
    const order: string[] = [];
    const track = <T,>(name: string, value: T) => vi.fn(async () => { order.push(name); return value; });
    const repo = repository({
      recover: track("recover", 0),
      discover: track("discover", { created: 1, missed: 0 }),
      listDrafted: track("drafted", []),
      listDue: track("due", []),
      listUndelivered: track("undelivered", []),
      checkStall: track("stall", false),
      resolveStall: track("resolve", 0),
    });
    const result = await runJournalTick(deps(repo, "2026-09-11T13:09:00Z"));
    expect(order).toEqual(["recover", "discover", "drafted", "due", "undelivered", "stall", "resolve"]);
    expect(result.state).toBe("discovered");
    expect(repo.checkStall).toHaveBeenCalledWith(operator, JOURNAL_STALL_COPY, 12);
  });

  it("renders, stores, verifies and schedules a draft for its slot", async () => {
    const repo = repository({ listDrafted: vi.fn(async () => [row()]) });
    const d = deps(repo, "2026-09-13T14:09:00Z");
    const result = await runJournalTick(d);
    expect(d.renderHero).toHaveBeenCalledWith("The job starts when the phone rings");
    expect(d.storeHero).toHaveBeenCalledWith("weekly:2026-09-14", expect.anything());
    expect(d.heroReadable).toHaveBeenCalledWith(asset.url);
    expect(repo.schedule).toHaveBeenCalledWith("a1", asset, at(SLOT));
    expect(result.promoted).toBe(1);
  });

  it("never promises a preview whose image is not public, and stops after three failures", async () => {
    const repo = repository({ listDrafted: vi.fn(async () => [row()]) });
    await runJournalTick(deps(repo, "2026-09-13T14:09:00Z", { heroReadable: vi.fn(async () => false) }));
    expect(repo.schedule).not.toHaveBeenCalled();
    expect(repo.annotate).toHaveBeenCalledWith("a1", expect.objectContaining({ event: "promotion_failed", code: "HERO_UNREADABLE" }));
    expect(repo.block).not.toHaveBeenCalled();

    const failing = repository({
      listDrafted: vi.fn(async () => [row({ attempt_log: [{ event: "promotion_failed" }, { event: "promotion_failed" }] })]),
    });
    await runJournalTick(deps(failing, "2026-09-13T14:09:00Z", { renderHero: vi.fn(async () => { throw new Error("boom"); }) }));
    expect(failing.block).toHaveBeenCalledWith("a1", "HERO_FAILED");
  });

  it("blocks a draft that lost its package", async () => {
    const repo = repository({ listDrafted: vi.fn(async () => [row({ package: null })]) });
    await runJournalTick(deps(repo, "2026-09-13T14:09:00Z"));
    expect(repo.block).toHaveBeenCalledWith("a1", "PACKAGE_MISSING");
  });

  it("publishes what is due through the guarded function, never by hand", async () => {
    const repo = repository({
      listDue: vi.fn(async () => [row({ id: "due-1", state: "scheduled" }), row({ id: "due-2", state: "scheduled" })]),
      publish: vi.fn().mockResolvedValueOnce({ state: "published", blog_id: "b1" }).mockResolvedValueOnce({ code: "HELD" }),
    });
    const result = await runJournalTick(deps(repo, "2026-09-14T13:09:00Z"));
    expect(repo.publish).toHaveBeenNthCalledWith(1, "due-1", false, "system:journal-editorial");
    expect(result.published).toEqual(["due-1"]);
    expect(result.held).toEqual([{ id: "due-2", code: "HELD" }]);
  });

  it("delivers one rail item per undelivered state and nothing without a recipient", async () => {
    const pending = [row({ state: "scheduled", publish_at: SLOT }), row({ id: "a2", identity: "weekly:2026-09-21", state: "queued" })];
    const repo = repository({ listUndelivered: vi.fn(async () => pending) });
    const result = await runJournalTick(deps(repo, "2026-09-13T14:09:00Z"));
    expect(repo.deliver).toHaveBeenCalledTimes(1);
    expect(result.notified).toBe(1);

    const silent = repository({ listUndelivered: vi.fn(async () => pending) });
    await runJournalTick(deps(silent, "2026-09-13T14:09:00Z", { operator: null }));
    expect(silent.deliver).not.toHaveBeenCalled();
    expect(silent.checkStall).not.toHaveBeenCalled();
  });

  describe("newsletter lane", () => {
    const published = row({ state: "published", published_at: "2026-09-14T13:09:00.000Z", blog_id: "b1" });

    it("waits for Tuesday 10:00", async () => {
      const repo = repository({ listNewsletterCandidates: vi.fn(async () => [published]) });
      await runJournalTick(deps(repo, "2026-09-15T16:59:00Z"));
      expect(repo.claimNewsletter).not.toHaveBeenCalled();
    });

    it("records a skip while switched off so an old post is never mailed later", async () => {
      const repo = repository({ listNewsletterCandidates: vi.fn(async () => [published]) });
      const d = deps(repo, "2026-09-15T17:09:00Z");
      const result = await runJournalTick(d);
      expect(repo.finishNewsletter).toHaveBeenCalledWith("a1", "33333333-3333-4333-8333-333333333333", "skipped");
      expect(d.sendNewsletter).not.toHaveBeenCalled();
      expect(result.newsletter).toEqual({ sent: 0, skipped: 1 });
    });

    it("mails once when switched on", async () => {
      const repo = repository({ listNewsletterCandidates: vi.fn(async () => [published]), newsletterEnabled: vi.fn(async () => true) });
      const d = deps(repo, "2026-09-15T17:09:00Z");
      const result = await runJournalTick(d);
      expect(d.sendNewsletter).toHaveBeenCalledWith("b1");
      expect(repo.finishNewsletter).toHaveBeenCalledWith("a1", expect.any(String), "sent");
      expect(result.newsletter.sent).toBe(1);
    });

    it("leaves a failed send claimed instead of mailing twice", async () => {
      const repo = repository({ listNewsletterCandidates: vi.fn(async () => [published]), newsletterEnabled: vi.fn(async () => true) });
      await runJournalTick(deps(repo, "2026-09-15T17:09:00Z", { sendNewsletter: vi.fn(async () => { throw new Error("SENDGRID_DOWN"); }) }));
      expect(repo.finishNewsletter).not.toHaveBeenCalled();
      expect(repo.annotate).toHaveBeenCalledWith("a1", expect.objectContaining({ event: "newsletter_failed", code: "SENDGRID_DOWN" }));
    });
  });
});
