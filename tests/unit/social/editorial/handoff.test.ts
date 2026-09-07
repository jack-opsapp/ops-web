import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import {
  createEditorialHandoffHandlers,
  type EditorialAssignmentRecord,
  type EditorialHandoffRepository,
} from "@/lib/social/editorial/handoff";
import {
  EDITORIAL_BRIEF_VERSION,
  EDITORIAL_LIMITS,
  loadEditorialBrief,
} from "@/lib/social/editorial/brief";
import type { EditorialSource } from "@/lib/social/editorial/policy";

// The draft endpoint holds a package. It must have no path at all into
// rendering, publishing or the operator's notification rail; these spies fail
// the suite if any of those modules is even reached through an import.
const forbidden = vi.hoisted(() => ({
  render: vi.fn(),
  submit: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("@/lib/social/render/render-social-post", () => ({
  renderSocialPost: forbidden.render,
  SOCIAL_RENDER_VERSION: "test",
}));
vi.mock("@/lib/social/submission-service", () => ({
  submitSocialPost: forbidden.submit,
  SocialSubmissionError: class extends Error {},
}));
vi.mock("@/lib/social/notification-service", () => ({
  createSocialReviewNotification: forbidden.notify,
}));

const TOKEN = "social-authoring-token-with-32-plus-characters";
const CLAIM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_CLAIM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BLOG_ID = "11111111-1111-4111-8111-111111111111";
const ASSIGNMENT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-08T16:30:00.000Z");
const GUIDE_CONTENT = "# Sam Parr field guide\nWrite the way people talk.\n";
const GUIDE = {
  path: "docs/social/voice/sam-parr-field-guide.md",
  sha256: createHash("sha256").update(GUIDE_CONTENT).digest("hex"),
  content: GUIDE_CONTENT,
};

const source: EditorialSource = {
  id: BLOG_ID,
  title: "A better handoff",
  slug: "better-handoff",
  published_at: "2026-09-01T12:00:00.000Z",
  is_live: true,
  thumbnail_url: null,
  text: "Write the delivery address and material list before the crew leaves the shop.",
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    title: "Before the truck leaves",
    hook: "The address belongs on the job.",
    angle: "A clear handoff before departure",
    caption:
      "Write the delivery address and material list before the crew leaves the shop. Save this for your next handoff.",
    cta: "Save this for your next handoff.",
    alt_text: "A field note about preparing a crew handoff.",
    story_type: "operator_protocol",
    slides: [
      {
        headline: "Before the truck leaves",
        body: "Write the delivery address and material list.",
      },
    ],
    evidence: [
      {
        claim: "Write the delivery address and material list.",
        quote: source.text,
      },
    ],
    ...overrides,
  };
}

function review(overrides: Record<string, unknown> = {}) {
  return {
    approved: true,
    grounded: true,
    current: true,
    distinct: true,
    useful: true,
    format_supported: true,
    identifies_subject: true,
    clear_without_caption: true,
    reason: "approved",
    ...overrides,
  };
}

function assignment(
  overrides: Partial<EditorialAssignmentRecord> = {}
): EditorialAssignmentRecord {
  return {
    id: ASSIGNMENT_ID,
    identity: `blog:${BLOG_ID}`,
    kind: "protocol",
    mode: "prepare",
    state: "authoring",
    attempts: 1,
    submissions: 0,
    claim_token: CLAIM,
    lease_until: new Date(NOW.getTime() + 40 * 60_000).toISOString(),
    blog_id: null,
    slot_date: "2026-09-08",
    source_snapshot: source,
    package: null,
    ...overrides,
  };
}

interface Rig {
  handlers: ReturnType<typeof createEditorialHandoffHandlers>;
  repository: EditorialHandoffRepository;
  finished: Array<{ state: string; code: string | null; pack: unknown }>;
  attempts: Array<Record<string, unknown>>;
  checkpoints: Array<{ source: EditorialSource; brief: string; sha: string }>;
  set: (next: Partial<EditorialAssignmentRecord>) => void;
  claimQueue: EditorialAssignmentRecord[];
}

function rig(initial: Partial<EditorialAssignmentRecord> = {}): Rig {
  let stored = assignment(initial);
  const finished: Rig["finished"] = [];
  const attempts: Rig["attempts"] = [];
  const checkpoints: Rig["checkpoints"] = [];
  const claimQueue: EditorialAssignmentRecord[] = [];
  const repository: EditorialHandoffRepository = {
    claimAssignment: async () => claimQueue.shift() ?? null,
    readMode: async () => "prepare",
    findAssignment: async (id) => (id === stored.id ? stored : null),
    findLiveBlogSource: async (id) => (id === BLOG_ID ? source : null),
    assignmentContext: async () => ({
      sources: [source],
      usedSourceIds: [],
      recentHooks: ["An old hook about something else entirely"],
    }),
    checkpointAssignment: async (_id, _token, s, brief, sha) => {
      checkpoints.push({ source: s, brief, sha });
      return true;
    },
    recordAssignmentAttempt: async (_id, _token, detail) => {
      attempts.push(detail);
      if (detail.event === "submission")
        stored = { ...stored, submissions: stored.submissions + 1 };
      return true;
    },
    finishAssignment: async (_id, _token, state, code, pack) => {
      finished.push({ state, code, pack });
      if (state === "drafted") {
        stored = { ...stored, state: "drafted", package: pack as never };
        return "drafted";
      }
      const final = stored.attempts >= 3 ? "blocked" : state;
      stored = { ...stored, state: final, claim_token: null };
      return final;
    },
  };
  return {
    handlers: createEditorialHandoffHandlers({
      repository,
      now: () => NOW,
      loadBrief: loadEditorialBrief,
      loadGuide: () => GUIDE,
    }),
    repository,
    finished,
    attempts,
    checkpoints,
    claimQueue,
    set: (next) => {
      stored = { ...stored, ...next };
    },
  };
}

function post(path: string, body: unknown, token: string | null = TOKEN) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("SOCIAL_AUTHORING_TOKEN", TOKEN);
  forbidden.render.mockClear();
  forbidden.submit.mockClear();
  forbidden.notify.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("authoring handoff authentication", () => {
  it("fails closed when the token is not configured", async () => {
    vi.stubEnv("SOCIAL_AUTHORING_TOKEN", "");
    const r = rig();
    const response = await r.handlers.claim(
      post("/api/internal/social/editorial/claim", { worker: "routine" })
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "SOCIAL_AUTHORING_NOT_CONFIGURED",
    });
  });

  it("rejects a short configured token instead of accepting a weak secret", async () => {
    vi.stubEnv("SOCIAL_AUTHORING_TOKEN", "too-short");
    const r = rig();
    const response = await r.handlers.claim(
      post("/api/internal/social/editorial/claim", { worker: "routine" }, "too-short")
    );
    expect(response.status).toBe(503);
  });

  it("rejects a wrong bearer token on every handler", async () => {
    const r = rig();
    for (const response of [
      await r.handlers.claim(
        post("/api/internal/social/editorial/claim", { worker: "w" }, "wrong")
      ),
      await r.handlers.draft(
        post("/x", { claim_token: CLAIM }, "wrong"),
        ASSIGNMENT_ID
      ),
      await r.handlers.release(
        post("/x", { claim_token: CLAIM, outcome: "error" }, "wrong"),
        ASSIGNMENT_ID
      ),
    ]) {
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        code: "SOCIAL_AUTHORING_INVALID",
      });
    }
  });

  it("answers 405 to anything but POST", async () => {
    const r = rig();
    const response = await r.handlers.claim(
      new NextRequest("http://localhost/api/internal/social/editorial/claim", {
        method: "GET",
        headers: { authorization: `Bearer ${TOKEN}` },
      })
    );
    expect(response.status).toBe(405);
  });

  it("refuses a body larger than 200 KB before parsing it", async () => {
    const r = rig();
    const request = new NextRequest("http://localhost/x", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "content-length": "200001",
      },
      body: JSON.stringify({ worker: "routine" }),
    });
    const response = await r.handlers.claim(request);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ code: "BODY_TOO_LARGE" });
  });
});

describe("claim", () => {
  it("reports an idle queue without inventing work", async () => {
    const r = rig();
    const response = await r.handlers.claim(
      post("/claim", { worker: "routine" })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      assignment: null,
      reason: "idle",
    });
  });

  it("distinguishes an operator who turned authoring off from an empty queue", async () => {
    const r = rig();
    r.repository.readMode = async () => "off";
    const response = await r.handlers.claim(
      post("/claim", { worker: "routine" })
    );
    await expect(response.json()).resolves.toEqual({
      assignment: null,
      reason: "authoring_off",
    });
  });

  it("rejects a missing worker name", async () => {
    const r = rig();
    const response = await r.handlers.claim(post("/claim", {}));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "SCHEMA_INVALID",
    });
  });

  it("hands over the whole brief, the guide and the article the routine cannot fetch", async () => {
    const r = rig();
    r.claimQueue.push(assignment({ source_snapshot: null }));
    const response = await r.handlers.claim(
      post("/claim", { worker: "routine" })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.assignment).toMatchObject({
      id: ASSIGNMENT_ID,
      identity: `blog:${BLOG_ID}`,
      kind: "protocol",
      mode: "prepare",
      attempt: 1,
      attempts_remaining: 2,
      claim_token: CLAIM,
      brief_version: EDITORIAL_BRIEF_VERSION,
      current_time: NOW.toISOString(),
      recent_hooks: ["An old hook about something else entirely"],
      format: loadEditorialBrief("protocol").format,
      limits: EDITORIAL_LIMITS,
      guide: GUIDE,
    });
    expect(body.assignment.source).toEqual({
      id: BLOG_ID,
      title: source.title,
      slug: source.slug,
      url: "https://opsapp.co/journal/better-handoff",
      published_at: source.published_at,
      text: source.text,
      thumbnail_url: null,
    });
    expect(body.assignment.guide.sha256).toBe(
      createHash("sha256").update(GUIDE_CONTENT).digest("hex")
    );
    // The full snapshot, including is_live, is what the worker later compares.
    expect(r.checkpoints).toEqual([
      { source, brief: EDITORIAL_BRIEF_VERSION, sha: GUIDE.sha256 },
    ]);
  });

  it("stops a blog assignment whose article was withdrawn and moves on", async () => {
    const r = rig();
    r.claimQueue.push(
      assignment({
        kind: "blog",
        blog_id: "33333333-3333-4333-8333-333333333333",
        slot_date: null,
        source_snapshot: null,
      })
    );
    const response = await r.handlers.claim(
      post("/claim", { worker: "routine" })
    );
    await expect(response.json()).resolves.toEqual({
      assignment: null,
      reason: "idle",
    });
    expect(r.finished).toEqual([
      { state: "blocked", code: "SOURCE_WITHDRAWN", pack: null },
    ]);
  });

  it("stops a recurring assignment when nothing fresh is left to write about", async () => {
    const r = rig();
    r.repository.assignmentContext = async () => ({
      sources: [source],
      usedSourceIds: [source.id],
      recentHooks: [],
    });
    r.claimQueue.push(assignment({ source_snapshot: null }));
    await r.handlers.claim(post("/claim", { worker: "routine" }));
    expect(r.finished).toEqual([
      { state: "blocked", code: "NO_FRESH_SOURCE", pack: null },
    ]);
  });

  it("never calls a model, a renderer, the queue or the rail", async () => {
    const r = rig();
    r.claimQueue.push(assignment({ source_snapshot: null }));
    await r.handlers.claim(post("/claim", { worker: "routine" }));
    expect(forbidden.render).not.toHaveBeenCalled();
    expect(forbidden.submit).not.toHaveBeenCalled();
    expect(forbidden.notify).not.toHaveBeenCalled();
  });
});

describe("draft", () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    claim_token: CLAIM,
    candidate: candidate(),
    editor: review(),
    usage: [{ stage: "writer", model: "claude", input: 10, output: 20 }],
    ...overrides,
  });

  it("does not know about an assignment that does not exist", async () => {
    const r = rig();
    const response = await r.handlers.draft(
      post("/draft", body()),
      "44444444-4444-4444-8444-444444444444"
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "ASSIGNMENT_NOT_FOUND",
    });
  });

  it("refuses a draft from a routine that does not hold the claim", async () => {
    const r = rig();
    const response = await r.handlers.draft(
      post("/draft", body({ claim_token: OTHER_CLAIM })),
      ASSIGNMENT_ID
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ code: "CLAIM_NOT_OWNED" });
  });

  it("refuses a draft after the lease expired", async () => {
    const r = rig();
    r.set({ lease_until: new Date(NOW.getTime() - 1000).toISOString() });
    const response = await r.handlers.draft(post("/draft", body()), ASSIGNMENT_ID);
    expect(response.status).toBe(409);
  });

  it("rejects evidence that is not actually in the article", async () => {
    const r = rig();
    const response = await r.handlers.draft(
      post(
        "/draft",
        body({
          candidate: candidate({
            evidence: [
              {
                claim: "Invented",
                quote: "The crew saved eleven hours every single week.",
              },
            ],
          }),
        })
      ),
      ASSIGNMENT_ID
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "DRAFT_REJECTED",
      code: "EVIDENCE_INVALID",
    });
    // The claim stays live so the routine can fix the quote and resubmit.
    expect(r.finished).toEqual([]);
  });

  it("rejects a link the model tried to place in the copy", async () => {
    const r = rig();
    const response = await r.handlers.draft(
      post(
        "/draft",
        body({
          candidate: candidate({
            cta: "Read it at opsapp.co right now.",
          }),
        })
      ),
      ASSIGNMENT_ID
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "MODEL_LINK_REJECTED",
    });
  });

  it("rejects a candidate that does not match the accepted shape", async () => {
    const r = rig();
    const response = await r.handlers.draft(
      post("/draft", body({ candidate: { title: "Only a title" } })),
      ASSIGNMENT_ID
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "SCHEMA_INVALID",
    });
  });

  it("rejects an editor verdict that does not answer every question", async () => {
    const r = rig();
    const response = await r.handlers.draft(
      post("/draft", body({ editor: { approved: true } })),
      ASSIGNMENT_ID
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "SCHEMA_INVALID",
    });
  });

  it("spends a submission on every attempt and stops the fourth", async () => {
    const r = rig();
    r.set({ submissions: 3 });
    const response = await r.handlers.draft(post("/draft", body()), ASSIGNMENT_ID);
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      code: "SUBMISSIONS_EXHAUSTED",
    });
    expect(r.finished).toEqual([
      { state: "queued", code: "SUBMISSIONS_EXHAUSTED", pack: null },
    ]);
  });

  it("consumes an attempt when the independent editor says no", async () => {
    const r = rig();
    const response = await r.handlers.draft(
      post(
        "/draft",
        body({
          editor: review({
            approved: false,
            grounded: false,
            reason: "unsupported_claim",
            notes: "The number is not in the article.",
          }),
        })
      ),
      ASSIGNMENT_ID
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      state: "rejected",
      attempts_remaining: 2,
    });
    expect(r.finished).toEqual([
      { state: "queued", code: "EDITOR_REJECTED", pack: null },
    ]);
  });

  it("treats an approved flag with a failed judgement as a rejection", async () => {
    const r = rig();
    const response = await r.handlers.draft(
      post(
        "/draft",
        body({ editor: review({ identifies_subject: false, reason: "approved" }) })
      ),
      ASSIGNMENT_ID
    );
    await expect(response.json()).resolves.toMatchObject({ state: "rejected" });
  });

  it("stops the assignment on the third rejection", async () => {
    const r = rig();
    r.set({ attempts: 3 });
    const response = await r.handlers.draft(
      post("/draft", body({ editor: review({ approved: false, reason: "stale" }) })),
      ASSIGNMENT_ID
    );
    await expect(response.json()).resolves.toEqual({
      state: "rejected",
      attempts_remaining: 0,
    });
  });

  it("stores the approved package with its provenance and holds it there", async () => {
    const r = rig();
    const response = await r.handlers.draft(post("/draft", body()), ASSIGNMENT_ID);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      state: "drafted",
      identity: `blog:${BLOG_ID}`,
      title: "Before the truck leaves",
    });
    const stored = r.finished.at(-1);
    expect(stored?.state).toBe("drafted");
    expect(stored?.pack).toMatchObject({
      brief_version: EDITORIAL_BRIEF_VERSION,
      references: [{ path: GUIDE.path, sha256: GUIDE.sha256 }],
      review: review(),
      usage: [{ stage: "writer", model: "claude", input: 10, output: 20 }],
    });
    expect(
      (stored?.pack as { submission: { source: { url: string } } }).submission
        .source.url
    ).toBe("https://opsapp.co/journal/better-handoff");
    expect(forbidden.render).not.toHaveBeenCalled();
    expect(forbidden.submit).not.toHaveBeenCalled();
    expect(forbidden.notify).not.toHaveBeenCalled();
  });

  it("returns the same answer when the routine retries a call it already won", async () => {
    const r = rig();
    await r.handlers.draft(post("/draft", body()), ASSIGNMENT_ID);
    const replay = await r.handlers.draft(post("/draft", body()), ASSIGNMENT_ID);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({
      state: "drafted",
      identity: `blog:${BLOG_ID}`,
      title: "Before the truck leaves",
    });
    expect(r.finished).toHaveLength(1);
  });

  it("records every submission so the cap is enforced across retries", async () => {
    const r = rig();
    await r.handlers.draft(post("/draft", body()), ASSIGNMENT_ID);
    expect(r.attempts.filter((a) => a.event === "submission")).toHaveLength(1);
  });
});

describe("release", () => {
  it("returns an errored assignment to the queue behind a two-hour wait", async () => {
    const r = rig();
    const response = await r.handlers.release(
      post("/release", {
        claim_token: CLAIM,
        outcome: "error",
        detail: "The sandbox lost the network.",
      }),
      ASSIGNMENT_ID
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      state: "queued",
      code: "AUTHORING_ERROR",
    });
    expect(r.finished).toEqual([
      { state: "queued", code: "AUTHORING_ERROR", pack: null },
    ]);
  });

  it("stops an assignment the routine cannot write in a supported format", async () => {
    const r = rig();
    const response = await r.handlers.release(
      post("/release", {
        claim_token: CLAIM,
        outcome: "unsupported",
        detail: "The article has no takeaway that stands alone.",
      }),
      ASSIGNMENT_ID
    );
    await expect(response.json()).resolves.toEqual({
      state: "blocked",
      code: "UNSUPPORTED_FORMAT",
    });
  });

  it("names exhaustion honestly on the third error", async () => {
    const r = rig();
    r.set({ attempts: 3 });
    const response = await r.handlers.release(
      post("/release", { claim_token: CLAIM, outcome: "error", detail: "" }),
      ASSIGNMENT_ID
    );
    await expect(response.json()).resolves.toEqual({
      state: "blocked",
      code: "ATTEMPTS_EXHAUSTED",
    });
  });

  it("refuses a release from a routine that does not hold the claim", async () => {
    const r = rig();
    const response = await r.handlers.release(
      post("/release", { claim_token: OTHER_CLAIM, outcome: "error" }),
      ASSIGNMENT_ID
    );
    expect(response.status).toBe(409);
  });

  it("rejects an unknown outcome", async () => {
    const r = rig();
    const response = await r.handlers.release(
      post("/release", { claim_token: CLAIM, outcome: "published" }),
      ASSIGNMENT_ID
    );
    expect(response.status).toBe(422);
  });
});
