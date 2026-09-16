import { describe, expect, it, vi } from "vitest";
import {
  JOURNAL_IMAGE_FAILED_COPY,
  JOURNAL_RADAR_COPY,
  JOURNAL_STALL_COPY,
  clampToLiveWindow,
  computeJournalPublishAt,
  journalDelivery,
  launchLabel,
  newsletterSendAt,
  fulfilJournalImageRequest,
  runJournalTick,
  type JournalTickDependencies,
  type JournalWorkerRepository,
  type JournalWorkerRow,
} from "@/lib/journal/editorial/worker";

const DIRECTION = "An owner-operator in a work truck cab at dawn answers a ringing phone, a clipboard of job tickets on the dash.";
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
      article: { title: "THE FIRST CALL DECIDES THE WHOLE WEEK", image_prompt: DIRECTION },
    } as never,
    attempt_log: [],
    notified_state: null,
    blog_id: null,
    newsletter_state: null,
    image_requested_at: null,
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
    listImageRequests: vi.fn(async () => []),
    replaceImage: vi.fn(async () => "published"),
    failImage: vi.fn(async () => "retry" as const),
    beginRadarScan: vi.fn(async () => false),
    recordRadarScan: vi.fn(async () => ({ stored: 0, pruned: 0 })),
    notifyRadar: vi.fn(async () => "clear"),
    ...overrides,
  };
}

const feed = (key: string, ok: boolean) => ({ key, name: key, sphere: "trades" as const, ok, items: ok ? 4 : 0, code: ok ? null : "FEED_BLOCKED" });
const radarSignal = {
  source_key: "tommy-mello",
  sphere: "trades" as const,
  kind: "video" as const,
  item_key: "yt:abc",
  url: "https://www.youtube.com/watch?v=abc",
  title: "Why your best tech quits",
  summary: null,
  published_at: "2026-09-12T12:00:00.000Z",
  views: 900,
  baseline_views: 300,
  momentum: 3,
  comments: null,
};

const asset = {
  url: "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/blog/weekly/2026-09-14-0123456789abcdef.jpg",
  storage_key: "blog/weekly/2026-09-14-0123456789abcdef.jpg",
  backend: "s3" as const,
  sha256: "0".repeat(64),
  width: 1600,
  height: 900,
  bytes: 240000,
  content_type: "image/jpeg" as const,
  render_version: "journal-photo-2026-09-15-v1",
  model: "gpt-image-2.5-flare",
  prompt_sha256: "1".repeat(64),
};
const photo = {
  buffer: Buffer.from("x"),
  width: 1600,
  height: 900,
  contentType: "image/jpeg" as const,
  model: "gpt-image-2.5-flare",
  prompt_sha256: "1".repeat(64),
};

function deps(repo: JournalWorkerRepository, now: string, overrides: Partial<JournalTickDependencies> = {}): JournalTickDependencies {
  return {
    now: () => at(now),
    operator,
    repository: repo,
    generateImage: vi.fn(async () => photo),
    storeImage: vi.fn(async () => asset),
    imageReadable: vi.fn(async () => true),
    sendNewsletter: vi.fn(async () => ({ sent: 13, failed: 0 })),
    newToken: () => "33333333-3333-4333-8333-333333333333",
    scanRadar: vi.fn(async () => ({ signals: [radarSignal], sources: [feed("a", true), feed("b", true), feed("c", false)] })),
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
    const copies = ["SLOT_MISSED", "ATTEMPTS_EXHAUSTED", "WEEKLY_ALREADY_LIVE", "IMAGE_REFUSED", "UNKNOWN"].map(
      (code) => journalDelivery(row({ state: "blocked", last_code: code }), "publish")!.body!
    );
    for (const text of [...copies, JOURNAL_STALL_COPY.body, JOURNAL_IMAGE_FAILED_COPY.body]) {
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
      listImageRequests: track("image requests", []),
      listDue: track("due", []),
      beginRadarScan: track("radar", false),
      listUndelivered: track("undelivered", []),
      checkStall: track("stall", false),
      resolveStall: track("resolve", 0),
    });
    const result = await runJournalTick(deps(repo, "2026-09-11T13:09:00Z"));
    expect(order).toEqual(["recover", "discover", "drafted", "image requests", "due", "radar", "undelivered", "stall", "resolve"]);
    expect(result.state).toBe("discovered");
    expect(repo.checkStall).toHaveBeenCalledWith(operator, JOURNAL_STALL_COPY, 12);
  });

  it("generates, stores, verifies and schedules a draft's photo for its slot", async () => {
    const repo = repository({ listDrafted: vi.fn(async () => [row()]) });
    const d = deps(repo, "2026-09-13T14:09:00Z");
    const result = await runJournalTick(d);
    expect(d.generateImage).toHaveBeenCalledWith(DIRECTION);
    expect(d.storeImage).toHaveBeenCalledWith("weekly:2026-09-14", photo);
    expect(d.imageReadable).toHaveBeenCalledWith(asset.url);
    expect(repo.schedule).toHaveBeenCalledWith("a1", asset, at(SLOT));
    expect(result.promoted).toBe(1);
  });

  it("makes one photo per tick: a new draft goes before a replacement request", async () => {
    const repo = repository({
      listDrafted: vi.fn(async () => [row()]),
      listImageRequests: vi.fn(async () => [row({ id: "live", state: "published" })]),
    });
    const d = deps(repo, "2026-09-13T14:09:00Z");
    await runJournalTick(d);
    expect(repo.listDrafted).toHaveBeenCalledWith(1);
    expect(repo.listImageRequests).not.toHaveBeenCalled();
    expect(d.generateImage).toHaveBeenCalledTimes(1);
  });

  it("never promises a preview whose photo is not public, and stops after three failures", async () => {
    const repo = repository({ listDrafted: vi.fn(async () => [row()]) });
    await runJournalTick(deps(repo, "2026-09-13T14:09:00Z", { imageReadable: vi.fn(async () => false) }));
    expect(repo.schedule).not.toHaveBeenCalled();
    expect(repo.annotate).toHaveBeenCalledWith("a1", expect.objectContaining({ event: "promotion_failed", code: "IMAGE_UNREADABLE" }));
    expect(repo.block).not.toHaveBeenCalled();

    const failing = repository({
      listDrafted: vi.fn(async () => [row({ attempt_log: [{ event: "promotion_failed" }, { event: "promotion_failed" }] })]),
    });
    await runJournalTick(deps(failing, "2026-09-13T14:09:00Z", { generateImage: vi.fn(async () => { throw new Error("IMAGE_REFUSED"); }) }));
    expect(failing.block).toHaveBeenCalledWith("a1", "IMAGE_REFUSED");

    const unexplained = repository({
      listDrafted: vi.fn(async () => [row({ attempt_log: [{ event: "promotion_failed" }, { event: "promotion_failed" }] })]),
    });
    await runJournalTick(deps(unexplained, "2026-09-13T14:09:00Z", { storeImage: vi.fn(async () => { throw new Error("socket hang up"); }) }));
    expect(unexplained.block).toHaveBeenCalledWith("a1", "IMAGE_FAILED");
  });

  it("replaces a live post's photo when one was requested", async () => {
    const live = row({ id: "live", state: "published", image_requested_at: "2026-09-15T04:00:00Z" });
    const repo = repository({ listImageRequests: vi.fn(async () => [live]) });
    const d = deps(repo, "2026-09-15T04:09:00Z");
    const result = await runJournalTick(d);
    expect(d.generateImage).toHaveBeenCalledWith(DIRECTION);
    expect(repo.replaceImage).toHaveBeenCalledWith("live", asset);
    expect(result.images).toEqual({ replaced: 1, failed: 0 });
    expect(repo.failImage).not.toHaveBeenCalled();
  });

  it("keeps a failed request for the next tick and lets the ledger close it", async () => {
    const live = row({ id: "live", state: "published", image_requested_at: "2026-09-15T04:00:00Z" });
    const repo = repository({ failImage: vi.fn(async () => "dropped" as const) });
    const result = await fulfilJournalImageRequest(
      { ...deps(repo, "2026-09-15T04:09:00Z"), generateImage: vi.fn(async () => { throw new Error("IMAGE_NOT_AUTHORIZED"); }) },
      live
    );
    expect(result).toEqual({ code: "IMAGE_NOT_AUTHORIZED", retry: false });
    expect(repo.failImage).toHaveBeenCalledWith("live", "IMAGE_NOT_AUTHORIZED", operator, JOURNAL_IMAGE_FAILED_COPY);
    expect(repo.replaceImage).not.toHaveBeenCalled();

    const noDirection = await fulfilJournalImageRequest(deps(repository(), "2026-09-15T04:09:00Z"), row({ package: null }));
    expect(noDirection).toEqual({ code: "NO_IMAGE_PROMPT", retry: true });
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

  describe("radar lane", () => {
    it("scans when the radar is due, keeps what it saw and clears the degraded item", async () => {
      const repo = repository({ beginRadarScan: vi.fn(async () => true), recordRadarScan: vi.fn(async () => ({ stored: 1, pruned: 0 })) });
      const d = deps(repo, "2026-09-16T18:09:00Z");
      const result = await runJournalTick(d);
      // 11:09 Vancouver: today's read has been due since 04:00 Vancouver.
      expect(repo.beginRadarScan).toHaveBeenCalledWith(at("2026-09-16T11:00:00.000Z"));
      expect(d.scanRadar).toHaveBeenCalledWith(at("2026-09-16T18:09:00Z"));
      expect(repo.recordRadarScan).toHaveBeenCalledWith([radarSignal], [feed("a", true), feed("b", true), feed("c", false)]);
      expect(repo.notifyRadar).toHaveBeenCalledWith(operator, false, JOURNAL_RADAR_COPY);
      expect(result.radar).toEqual({ state: "scanned", ok: 2, total: 3, stored: 1, degraded: false });
    });

    it("raises the degraded item when fewer than half the feeds answer", async () => {
      const repo = repository({ beginRadarScan: vi.fn(async () => true) });
      const d = deps(repo, "2026-09-16T18:09:00Z", {
        scanRadar: vi.fn(async () => ({ signals: [], sources: [feed("a", true), feed("b", false), feed("c", false)] })),
      });
      const result = await runJournalTick(d);
      expect(repo.notifyRadar).toHaveBeenCalledWith(operator, true, JOURNAL_RADAR_COPY);
      expect(result.radar).toMatchObject({ state: "scanned", degraded: true });
      expect(JOURNAL_RADAR_COPY.title).toBe("JOURNAL RADAR DEGRADED");
      expect(JOURNAL_RADAR_COPY.body).not.toMatch(/!|contractor/i);
    });

    it("leaves a current radar alone", async () => {
      const repo = repository();
      const d = deps(repo, "2026-09-16T18:09:00Z");
      expect((await runJournalTick(d)).radar).toEqual({ state: "current" });
      expect(d.scanRadar).not.toHaveBeenCalled();
    });

    it("waits for a tick that made no photograph", async () => {
      const repo = repository({ listDrafted: vi.fn(async () => [row()]), beginRadarScan: vi.fn(async () => true) });
      const d = deps(repo, "2026-09-13T14:09:00Z");
      expect((await runJournalTick(d)).radar).toEqual({ state: "deferred" });
      expect(repo.beginRadarScan).not.toHaveBeenCalled();
    });

    it("never fails the tick when the scan fails, and tells nobody without a recipient", async () => {
      const repo = repository({
        beginRadarScan: vi.fn(async () => true),
        listDue: vi.fn(async () => [row({ state: "scheduled" })]),
      });
      const failing = deps(repo, "2026-09-16T18:09:00Z", { scanRadar: vi.fn(async () => { throw new Error("RADAR_DOWN"); }) });
      const result = await runJournalTick(failing);
      expect(result.radar).toEqual({ state: "failed", code: "RADAR_DOWN" });
      expect(result.published).toEqual(["a1"]);
      expect(repo.recordRadarScan).not.toHaveBeenCalled();

      const quiet = repository({ beginRadarScan: vi.fn(async () => true) });
      await runJournalTick(deps(quiet, "2026-09-16T18:09:00Z", { operator: null }));
      expect(quiet.recordRadarScan).toHaveBeenCalled();
      expect(quiet.notifyRadar).not.toHaveBeenCalled();
    });
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
