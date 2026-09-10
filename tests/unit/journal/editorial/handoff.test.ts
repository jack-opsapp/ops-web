import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JournalSourceFetchError,
  createJournalHandoffHandlers,
  type JournalAssignmentRecord,
  type JournalHandoffRepository,
  type JournalSourceRecord,
  type JournalSourceSnapshotInput,
} from "@/lib/journal/editorial/handoff";
import { policyContext, validCandidate, validEditor } from "./fixtures";

const TOKEN = "t".repeat(48);
const CLAIM = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ASSIGNMENT = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-09-13T13:30:00Z");

const reference = (name: string) => ({
  path: `docs/journal/voice/${name}`,
  sha256: name.padEnd(64, "0").slice(0, 64),
  content: `${name} content`,
});

function assignment(overrides: Partial<JournalAssignmentRecord> = {}): JournalAssignmentRecord {
  return {
    id: ASSIGNMENT,
    identity: "weekly:2026-09-14",
    slot_date: "2026-09-14",
    slot_at: "2026-09-14T13:00:00.000Z",
    mode: "prepare",
    state: "authoring",
    attempts: 1,
    submissions: 0,
    claim_token: CLAIM,
    lease_until: "2026-09-13T14:30:00.000Z",
    title: null,
    package: null,
    ...overrides,
  };
}

const storedSource: JournalSourceRecord = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  url: "https://www.example.gov/survey",
  final_url: "https://www.example.gov/survey/2024",
  content_type: "text/html",
  title: "Homeowner survey 2024",
  site_name: "Example Agency",
  published_hint: "2024-05-01T00:00:00.000Z",
  modified_hint: null,
  text: "In the 2024 survey, 81% of homeowners said they read reviews before calling a business.",
  truncated: false,
  fetched_at: "2026-09-13T13:10:00.000Z",
};

const snapshot: JournalSourceSnapshotInput = {
  url: "https://www.example.gov/survey",
  final_url: "https://www.example.gov/survey/2024",
  http_status: 200,
  content_type: "text/html",
  bytes: 4000,
  sha256: "f".repeat(64),
  title: "Homeowner survey 2024",
  site_name: "Example Agency",
  published_hint: "2024-05-01T00:00:00.000Z",
  modified_hint: null,
  text: storedSource.text,
  truncated: false,
};

function repository(overrides: Partial<JournalHandoffRepository> = {}): JournalHandoffRepository {
  return {
    claimAssignment: vi.fn(async () => assignment({ attempts: 1 })),
    readMode: vi.fn(async () => "prepare" as const),
    findAssignment: vi.fn(async () => assignment()),
    claimContext: vi.fn(async () => ({
      recentPosts: [
        { slug: "word-of-mouth-isnt-a-marketing-plan", title: "WORD OF MOUTH", published_at: "2026-08-31T12:00:00Z", summary: "s", category: "growth" },
      ],
      backlogTopics: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", topic: "Response time" }],
      categories: [{ id: "c1", slug: "operations", name: "Operations" }],
      fetchedSources: [],
      maxSources: 24,
    })),
    policyContext: vi.fn(async () => ({
      sources: policyContext.sources,
      livePosts: policyContext.livePosts,
      takenSlugs: policyContext.takenSlugs,
      categories: policyContext.categories,
      backlogTopicIds: policyContext.backlogTopicIds,
    })),
    findSource: vi.fn(async () => null),
    countClaimSources: vi.fn(async () => 0),
    maxSources: vi.fn(async () => 24),
    storeSource: vi.fn(async () => ({ id: storedSource.id, existing: false })),
    recordAttempt: vi.fn(async () => true),
    finishAssignment: vi.fn(async (_id, _token, state) => state),
    ...overrides,
  };
}

function handlers(repo: JournalHandoffRepository, fetchSource = vi.fn(async () => snapshot)) {
  return {
    fetchSource,
    ...createJournalHandoffHandlers({
      repository: repo,
      now: () => NOW,
      fetchSource,
      loadBrief: () => reference("ops-journal-brief.md"),
      loadGuide: () => reference("blog-voice-sam-parr.md"),
      loadFacts: () => ({ ...reference("ops-product-facts.md"), content: policyContext.productFacts }),
    }),
  };
}

function post(body: unknown, { token = TOKEN, method = "POST", raw }: { token?: string | null; method?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest("https://app.opsapp.co/api/internal/journal/editorial/claim", {
    method,
    headers,
    ...(method === "GET" ? {} : { body: raw ?? JSON.stringify(body) }),
  });
}

describe("journal handoff", () => {
  beforeEach(() => {
    process.env.JOURNAL_AUTHORING_TOKEN = TOKEN;
  });
  afterEach(() => {
    delete process.env.JOURNAL_AUTHORING_TOKEN;
  });

  describe("authentication and transport", () => {
    it("fails closed without a configured token", async () => {
      delete process.env.JOURNAL_AUTHORING_TOKEN;
      const response = await handlers(repository()).claim(post({ worker: "w" }));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("rejects a wrong token, a GET, an oversize body and invalid JSON", async () => {
      const h = handlers(repository());
      expect((await h.claim(post({ worker: "w" }, { token: "x".repeat(48) }))).status).toBe(401);
      expect((await h.claim(post({ worker: "w" }, { token: null }))).status).toBe(401);
      expect((await h.claim(post(null, { method: "GET" }))).status).toBe(405);
      expect((await h.claim(post(null, { raw: "x".repeat(200_001) }))).status).toBe(413);
      expect((await h.claim(post(null, { raw: "{" }))).status).toBe(400);
    });
  });

  describe("claim", () => {
    it("answers idle or off without an assignment", async () => {
      const repo = repository({ claimAssignment: vi.fn(async () => null) });
      const idle = await (await handlers(repo).claim(post({ worker: "w" }))).json();
      expect(idle).toEqual({ assignment: null, reason: "idle" });
      (repo.readMode as ReturnType<typeof vi.fn>).mockResolvedValueOnce("off");
      const off = await (await handlers(repo).claim(post({ worker: "w" }))).json();
      expect(off).toEqual({ assignment: null, reason: "authoring_off" });
    });

    it("hands the writer everything it needs and nothing it should not have", async () => {
      const response = await handlers(repository()).claim(post({ worker: "cse_1" }));
      const body = await response.json();
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body.assignment).toMatchObject({
        id: ASSIGNMENT,
        identity: "weekly:2026-09-14",
        kind: "weekly",
        publishes_at: "2026-09-14T13:00:00.000Z",
        attempt: 1,
        attempts_remaining: 2,
        claim_token: CLAIM,
        max_sources: 24,
        brief_version: "ops-journal-2026-09-10-v1",
      });
      expect(body.assignment.brief.sha256).toHaveLength(64);
      expect(body.assignment.guide.path).toBe("docs/journal/voice/blog-voice-sam-parr.md");
      expect(body.assignment.product_facts.content).toContain("$1.6M");
      expect(body.assignment.industry_pages).toContain("/industries/hvac");
      expect(body.assignment.recent_posts[0].slug).toBe("word-of-mouth-isnt-a-marketing-plan");
      expect(body.assignment.backlog_topics).toHaveLength(1);
      expect(JSON.stringify(body)).not.toMatch(/service_role|SUPABASE|AWS_|Bearer/);
    });
  });

  describe("sources", () => {
    const sourceRequest = (url: string, claim = CLAIM) => post({ claim_token: claim, url });

    it("only serves the live claim", async () => {
      const h = handlers(repository());
      expect((await h.source(sourceRequest("https://x.gov/a", OTHER), ASSIGNMENT)).status).toBe(409);
      const expired = handlers(repository({ findAssignment: vi.fn(async () => assignment({ lease_until: "2026-09-13T13:00:00.000Z" })) }));
      expect((await expired.source(sourceRequest("https://x.gov/a"), ASSIGNMENT)).status).toBe(409);
      expect((await h.source(sourceRequest("https://x.gov/a"), "not-a-uuid")).status).toBe(404);
    });

    it("refuses anything but HTTPS before fetching", async () => {
      const h = handlers(repository());
      const response = await h.source(sourceRequest("http://x.gov/plain"), ASSIGNMENT);
      expect(response.status).toBe(422);
      expect((await response.json()).code).toBe("SOURCE_URL_INVALID");
      expect(h.fetchSource).not.toHaveBeenCalled();
    });

    it("returns a page OPS already kept without fetching it again", async () => {
      const h = handlers(repository({ findSource: vi.fn(async () => storedSource) }));
      const response = await h.source(sourceRequest("https://www.example.gov/survey#section"), ASSIGNMENT);
      expect(response.status).toBe(200);
      expect((await response.json()).existing).toBe(true);
      expect(h.fetchSource).not.toHaveBeenCalled();
    });

    it("stops at the per-claim cap before fetching", async () => {
      const h = handlers(repository({ countClaimSources: vi.fn(async () => 24) }));
      const response = await h.source(sourceRequest("https://x.gov/a"), ASSIGNMENT);
      expect(response.status).toBe(429);
      expect(h.fetchSource).not.toHaveBeenCalled();
    });

    it("passes on a fetch refusal with its code and status", async () => {
      const h = handlers(repository(), vi.fn(async () => {
        throw new JournalSourceFetchError("SOURCE_FETCH_FAILED", 404);
      }));
      const response = await h.source(sourceRequest("https://x.gov/missing"), ASSIGNMENT);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ code: "SOURCE_FETCH_FAILED", status: 404 });
    });

    it("fetches, keeps and returns the snapshot keyed by the normalised URL", async () => {
      const findSource = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(storedSource);
      const repo = repository({ findSource });
      const h = handlers(repo);
      const response = await h.source(sourceRequest("https://www.example.gov/survey#top"), ASSIGNMENT);
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(h.fetchSource).toHaveBeenCalledWith("https://www.example.gov/survey");
      expect(repo.storeSource).toHaveBeenCalledWith(ASSIGNMENT, CLAIM, expect.objectContaining({ url: "https://www.example.gov/survey", sha256: "f".repeat(64) }));
      expect(body).toMatchObject({ source_id: storedSource.id, existing: false, text: storedSource.text });
    });
  });

  describe("draft", () => {
    const draftRequest = (overrides: Record<string, unknown> = {}) =>
      post({
        claim_token: CLAIM,
        candidate: validCandidate(),
        editor: validEditor,
        usage: [{ stage: "writer", model: "claude-opus-5" }, { stage: "editor", model: "claude-opus-5" }],
        ...overrides,
      });

    it("stores a validated package and nothing else", async () => {
      const repo = repository();
      const response = await handlers(repo).draft(draftRequest(), ASSIGNMENT);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        state: "drafted",
        identity: "weekly:2026-09-14",
        title: "THE FIRST CALL DECIDES THE WHOLE WEEK",
      });
      const [, , state, code, pack, slug, title] = (repo.finishAssignment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect([state, code, slug, title]).toEqual(["drafted", null, "the-first-call-decides-the-week", "THE FIRST CALL DECIDES THE WHOLE WEEK"]);
      expect(pack.brief_version).toBe("ops-journal-2026-09-10-v1");
      expect(pack.references.map((entry: { path: string }) => entry.path)).toEqual([
        "docs/journal/voice/ops-journal-brief.md",
        "docs/journal/voice/blog-voice-sam-parr.md",
        "docs/journal/voice/ops-product-facts.md",
      ]);
      expect(pack.html).toContain("<h2>Sources</h2>");
      expect(pack.review.reason).toBe("approved");
    });

    it("reads back an accepted draft on a retried call", async () => {
      const repo = repository({
        findAssignment: vi.fn(async () => assignment({ state: "drafted", lease_until: null, title: "THE TITLE", package: {} as never })),
      });
      const response = await handlers(repo).draft(draftRequest(), ASSIGNMENT);
      expect(await response.json()).toEqual({ state: "drafted", identity: "weekly:2026-09-14", title: "THE TITLE" });
      expect(repo.finishAssignment).not.toHaveBeenCalled();
    });

    it("returns a fixable code with the exact issues", async () => {
      const repo = repository();
      const response = await handlers(repo).draft(draftRequest({ candidate: validCandidate({ teaser: "Answer the phone!" }) }), ASSIGNMENT);
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.code).toBe("VOICE_REJECTED");
      expect(body.issues[0]).toEqual({ path: "teaser", message: "no exclamation points" });
      expect(repo.finishAssignment).not.toHaveBeenCalled();
      expect(repo.recordAttempt).toHaveBeenCalledWith(ASSIGNMENT, CLAIM, expect.objectContaining({ event: "rejected", code: "VOICE_REJECTED" }));
    });

    it("returns the slot to the queue when the editor says no", async () => {
      const repo = repository();
      const response = await handlers(repo).draft(draftRequest({ editor: { ...validEditor, approved: false, grounded: false, reason: "unsupported_claim" } }), ASSIGNMENT);
      expect(await response.json()).toEqual({ state: "rejected", attempts_remaining: 2 });
      expect(repo.finishAssignment).toHaveBeenCalledWith(ASSIGNMENT, CLAIM, "queued", "EDITOR_REJECTED", null, null, null);
    });

    it("stops after three submissions on one claim", async () => {
      const repo = repository({ findAssignment: vi.fn(async () => assignment({ submissions: 3 })) });
      const response = await handlers(repo).draft(draftRequest(), ASSIGNMENT);
      expect(response.status).toBe(429);
      expect(repo.finishAssignment).toHaveBeenCalledWith(ASSIGNMENT, CLAIM, "queued", "SUBMISSIONS_EXHAUSTED", null, null, null);
    });

    it("turns a slug lost at the last moment into a fixable rejection", async () => {
      const repo = repository({ finishAssignment: vi.fn(async () => "SLUG_TAKEN") });
      const response = await handlers(repo).draft(draftRequest(), ASSIGNMENT);
      expect(response.status).toBe(422);
      expect((await response.json()).code).toBe("SLUG_TAKEN");
    });

    it("refuses a caller that does not hold the claim", async () => {
      const response = await handlers(repository()).draft(draftRequest({ claim_token: OTHER }), ASSIGNMENT);
      expect(response.status).toBe(409);
    });
  });

  describe("release", () => {
    it("blocks an unsupported topic and requeues an error", async () => {
      const repo = repository();
      const h = handlers(repo);
      await h.release(post({ claim_token: CLAIM, outcome: "unsupported", detail: "no sources" }), ASSIGNMENT);
      expect(repo.finishAssignment).toHaveBeenLastCalledWith(ASSIGNMENT, CLAIM, "blocked", "UNSUPPORTED_TOPIC", null, null, null);
      await h.release(post({ claim_token: CLAIM, outcome: "error" }), ASSIGNMENT);
      expect(repo.finishAssignment).toHaveBeenLastCalledWith(ASSIGNMENT, CLAIM, "queued", "AUTHORING_ERROR", null, null, null);
      const last = handlers(repository({ findAssignment: vi.fn(async () => assignment({ attempts: 3 })) }));
      const response = await last.release(post({ claim_token: CLAIM, outcome: "error" }), ASSIGNMENT);
      expect((await response.json()).code).toBe("ATTEMPTS_EXHAUSTED");
    });
  });

  describe("boundary", () => {
    const source = (file: string) => readFileSync(join(process.cwd(), "src/lib/journal/editorial", file), "utf8");

    it("gives the writer's routes no path to publication, rendering, storage or the rail", () => {
      for (const file of ["handoff.ts", "handoff-runtime.ts", "repository.ts"]) {
        const text = source(file);
        expect(text, file).not.toMatch(/publish_journal_editorial_assignment|schedule_journal_editorial_assignment|deliver_journal_editorial_notification/);
        expect(text, file).not.toMatch(/from\(["']notifications["']\)|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
        expect(text, file).not.toMatch(/hero|render-social-post|s3\/client|storage/i);
      }
    });
  });
});
