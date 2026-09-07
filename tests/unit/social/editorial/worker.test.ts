import { describe, expect, it } from "vitest";
import {
  clampToVancouverWindow,
  computePublishAt,
  runEditorialTick,
  vancouverDay,
  type EditorialAssignmentRow,
  type EditorialTickDependencies,
  type EditorialWorkerRepository,
} from "@/lib/social/editorial/worker";
import type { EditorialSource } from "@/lib/social/editorial/policy";

const NOW = new Date("2026-09-08T16:30:00.000Z");
const OPERATOR = { userId: "operator", companyId: "company" };
const BLOG_ID = "11111111-1111-4111-8111-111111111111";

const source: EditorialSource = {
  id: BLOG_ID,
  title: "A better handoff",
  slug: "better-handoff",
  published_at: "2026-09-01T12:00:00.000Z",
  is_live: true,
  thumbnail_url: "https://cdn.opsapp.co/handoff.jpg",
  text: "Write the delivery address and material list before the crew leaves the shop.",
};

function pack() {
  return {
    submission: {
      contract_version: "2026-09-01",
      source: {
        type: "blog",
        id: BLOG_ID,
        url: "https://opsapp.co/journal/better-handoff",
        published_at: source.published_at,
      },
      content: {
        title: "Before the truck leaves",
        subtitle: "A better handoff",
        hook: "The address belongs on the job.",
        angle: "A clear handoff before departure",
        caption: "Write the delivery address before the crew leaves.",
        alt_text: "A field note about preparing a crew handoff.",
        slides: [
          {
            headline: "Before the truck leaves",
            body: "Write the delivery address.",
            image_url: "https://cdn.opsapp.co/handoff.jpg",
          },
        ],
      },
      media: [
        {
          url: "https://cdn.opsapp.co/handoff.jpg",
          alt_text: "A field note about preparing a crew handoff.",
        },
      ],
    },
    evidence: [{ claim: "Write it down.", quote: source.text }],
    review: { approved: true },
    usage: [],
  } as never;
}

function row(
  overrides: Partial<EditorialAssignmentRow> = {}
): EditorialAssignmentRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    identity: `blog:${BLOG_ID}`,
    kind: "blog",
    mode: "publish",
    state: "drafted",
    attempts: 1,
    source_snapshot: source,
    package: pack(),
    ...overrides,
  };
}

interface Rig {
  deps: EditorialTickDependencies;
  repository: EditorialWorkerRepository;
  promotions: Array<{
    id: string;
    state: string;
    code: string | null;
    postId: string | null;
    source: EditorialSource | null;
    preview: unknown;
  }>;
  notes: Array<{
    id: string;
    detail: Record<string, unknown> | null;
    source: EditorialSource | null;
    pack: unknown;
  }>;
  submitted: Array<{
    idempotencyKey: string;
    submission: Record<string, unknown>;
  }>;
  previews: Array<{ identity: string; pack: unknown }>;
  calls: string[];
}

function rig(
  options: {
    mode?: "off" | "prepare" | "publish";
    drafted?: EditorialAssignmentRow[];
    current?: EditorialSource | null;
    unchanged?: boolean;
    existingPost?: { id: string; status: string } | null;
    lastScheduled?: Date | null;
    submitStatus?: string;
  } = {}
): Rig {
  const promotions: Rig["promotions"] = [];
  const notes: Rig["notes"] = [];
  const submitted: Rig["submitted"] = [];
  const previews: Rig["previews"] = [];
  const calls: string[] = [];
  const repository: EditorialWorkerRepository = {
    recover: async () => {
      calls.push("recover");
      return 0;
    },
    discover: async (date, weekday) => {
      calls.push(`discover:${date}:${weekday}`);
      return { blogs: 1, recurring: 0 };
    },
    readSettings: async () => ({
      mode: options.mode ?? "publish",
      delivery_gap_minutes: 1200,
    }),
    listDrafted: async () => options.drafted ?? [row()],
    sourceStillCurrent: async () => options.unchanged ?? true,
    findLiveBlogSource: async () =>
      options.current === undefined ? source : options.current,
    annotateAssignment: async (id, detail, s, p) => {
      notes.push({ id, detail, source: s, pack: p });
      return true;
    },
    promote: async (id, state, code, preview, postId, s) => {
      promotions.push({ id, state, code, preview, postId, source: s });
      calls.push(state);
      return state;
    },
    lastScheduledPublishAt: async () => options.lastScheduled ?? null,
    findPost: async () => options.existingPost ?? null,
    notify: async () => {
      calls.push("notify");
      return 2;
    },
    checkAuthoringStall: async () => {
      calls.push("stall");
      return false;
    },
  };
  const deps: EditorialTickDependencies = {
    now: () => NOW,
    operator: OPERATOR,
    repository,
    preview: async (p, identity) => {
      previews.push({ identity, pack: p });
      calls.push("preview");
      return [{ order: 0 }] as never;
    },
    submit: async (input) => {
      submitted.push(input as never);
      calls.push("submit");
      return {
        post: { id: "post-1", status: options.submitStatus ?? "review" },
      };
    },
  };
  return { repository, promotions, notes, submitted, previews, calls, deps };
}

describe("Vancouver delivery window", () => {
  it("reads the local day and weekday the discovery rules are written against", () => {
    // 16:30Z is 09:30 Vancouver on Tuesday the 8th.
    expect(vancouverDay(NOW)).toEqual({ date: "2026-09-08", weekday: "Tue" });
    // 02:30Z on the 9th is still Tuesday evening in Vancouver.
    expect(vancouverDay(new Date("2026-09-09T02:30:00.000Z"))).toEqual({
      date: "2026-09-08",
      weekday: "Tue",
    });
  });

  it("moves an early or late slot to the next ten in the morning", () => {
    expect(
      clampToVancouverWindow(new Date("2026-09-08T16:41:00.000Z")).toISOString()
    ).toBe("2026-09-08T17:00:00.000Z");
    expect(
      clampToVancouverWindow(new Date("2026-09-09T03:30:00.000Z")).toISOString()
    ).toBe("2026-09-09T17:00:00.000Z");
    // 12:00 Vancouver is inside the window and is left alone.
    expect(
      clampToVancouverWindow(new Date("2026-09-08T19:00:00.000Z")).toISOString()
    ).toBe("2026-09-08T19:00:00.000Z");
  });

  it("paces the next post one gap after the last one, inside the window", () => {
    expect(
      computePublishAt(
        NOW,
        new Date("2026-09-08T17:00:00.000Z"),
        1200
      ).toISOString()
    ).toBe("2026-09-09T17:00:00.000Z");
    expect(computePublishAt(NOW, null, 1200).toISOString()).toBe(
      "2026-09-08T17:00:00.000Z"
    );
  });
});

describe("editorial tick", () => {
  it("always recovers, discovers, notifies and checks for silence", async () => {
    const r = rig({ mode: "off" });
    const result = await runEditorialTick(r.deps);
    expect(r.calls).toEqual([
      "recover",
      "discover:2026-09-08:Tue",
      "notify",
      "stall",
    ]);
    expect(result).toMatchObject({ discovered: 1, promoted: 0, notified: 2 });
  });

  it("leaves drafts alone while the operator has authoring off", async () => {
    const r = rig({ mode: "off" });
    await runEditorialTick(r.deps);
    expect(r.promotions).toEqual([]);
    expect(r.submitted).toEqual([]);
  });

  it("renders a preview and never submits in prepare mode", async () => {
    const r = rig({ mode: "prepare" });
    await runEditorialTick(r.deps);
    expect(r.submitted).toEqual([]);
    expect(r.previews).toEqual([{ identity: `blog:${BLOG_ID}`, pack: pack() }]);
    expect(r.promotions).toMatchObject([
      { state: "prepared", preview: [{ order: 0 }] },
    ]);
  });

  it("holds a draft claimed in prepare mode even after the operator flips to publish", async () => {
    const r = rig({ mode: "publish", drafted: [row({ mode: "prepare" })] });
    await runEditorialTick(r.deps);
    expect(r.submitted).toEqual([]);
    expect(r.promotions).toMatchObject([{ state: "prepared" }]);
  });

  it("queues an approved draft at the paced slot when both controls say publish", async () => {
    const r = rig({
      mode: "publish",
      lastScheduled: new Date("2026-09-08T17:00:00.000Z"),
    });
    await runEditorialTick(r.deps);
    expect(r.submitted).toHaveLength(1);
    expect(r.submitted[0].idempotencyKey).toBe(
      `cloud-editorial-v2:blog:${BLOG_ID}`
    );
    expect(r.submitted[0].submission.publish_at).toBe(
      "2026-09-09T17:00:00.000Z"
    );
    expect(r.promotions).toMatchObject([
      { state: "submitted", postId: "post-1" },
    ]);
  });

  it("stops an assignment whose article was withdrawn", async () => {
    const r = rig({ unchanged: false, current: null });
    await runEditorialTick(r.deps);
    expect(r.submitted).toEqual([]);
    expect(r.promotions).toMatchObject([
      { state: "blocked", code: "SOURCE_WITHDRAWN" },
    ]);
  });

  it("refreshes an edited article that still contains every quote and carries on", async () => {
    const edited: EditorialSource = {
      ...source,
      title: "A much better handoff",
      thumbnail_url: "https://cdn.opsapp.co/handoff-v2.jpg",
      text: `An added opening paragraph. ${source.text} And a closing note.`,
    };
    const r = rig({ unchanged: false, current: edited });
    await runEditorialTick(r.deps);
    expect(r.notes).toMatchObject([
      { detail: { event: "source_refreshed" }, source: edited },
    ]);
    expect(r.submitted).toHaveLength(1);
    const submission = r.submitted[0].submission as {
      content: { subtitle: string; slides: Array<{ image_url?: string }> };
      media: Array<{ url: string }>;
    };
    expect(submission.content.subtitle).toBe("A much better handoff");
    expect(submission.content.slides[0].image_url).toBe(
      "https://cdn.opsapp.co/handoff-v2.jpg"
    );
    expect(submission.media[0].url).toBe("https://cdn.opsapp.co/handoff-v2.jpg");
    expect(r.promotions).toMatchObject([{ state: "submitted" }]);
  });

  it("returns an assignment to the queue when the article no longer says what it quoted", async () => {
    const rewritten: EditorialSource = {
      ...source,
      text: "The article was rewritten and now says something else entirely.",
    };
    const r = rig({ unchanged: false, current: rewritten });
    await runEditorialTick(r.deps);
    expect(r.submitted).toEqual([]);
    expect(r.promotions).toMatchObject([
      { state: "queued", code: "SOURCE_CHANGED" },
    ]);
    expect(r.notes).toMatchObject([{ detail: { event: "source_changed" } }]);
  });

  it("stops rather than loops when the article keeps changing", async () => {
    const rewritten: EditorialSource = { ...source, text: "Something else." };
    const r = rig({
      unchanged: false,
      current: rewritten,
      drafted: [row({ attempts: 3 })],
    });
    await runEditorialTick(r.deps);
    expect(r.promotions).toMatchObject([
      { state: "blocked", code: "SOURCE_CHANGED" },
    ]);
  });

  it("reconciles a post that was queued before the acknowledgement was lost", async () => {
    const r = rig({ existingPost: { id: "post-9", status: "review" } });
    await runEditorialTick(r.deps);
    expect(r.submitted).toEqual([]);
    expect(r.promotions).toMatchObject([
      { state: "submitted", postId: "post-9" },
    ]);
  });

  it("waits instead of resubmitting while an existing post is still rendering", async () => {
    const r = rig({ existingPost: { id: "post-9", status: "rendering" } });
    await runEditorialTick(r.deps);
    expect(r.submitted).toEqual([]);
    expect(r.promotions).toEqual([]);
  });

  it("never treats a failed reservation as delivered", async () => {
    const r = rig({ existingPost: { id: "post-9", status: "failed" } });
    await runEditorialTick(r.deps);
    expect(r.promotions).toMatchObject([
      { state: "blocked", code: "DELIVERY_NEEDS_REVIEW", postId: "post-9" },
    ]);
  });

  it("blocks a submission that did not reach review", async () => {
    const r = rig({ submitStatus: "failed" });
    await runEditorialTick(r.deps);
    expect(r.promotions).toMatchObject([
      { state: "blocked", code: "DELIVERY_NEEDS_REVIEW" },
    ]);
  });

  it("keeps going after one assignment throws", async () => {
    const second = row({
      id: "33333333-3333-4333-8333-333333333333",
      identity: "protocol:2026-09-08",
      kind: "protocol",
    });
    const r = rig({ mode: "prepare", drafted: [row(), second] });
    let first = true;
    r.deps.preview = async (p, identity) => {
      if (first) {
        first = false;
        throw new Error("RENDER_FAILED");
      }
      r.previews.push({ identity, pack: p });
      return [{ order: 0 }] as never;
    };
    const result = await runEditorialTick(r.deps);
    expect(r.notes).toMatchObject([
      { detail: { event: "promotion_failed", code: "RENDER_FAILED" } },
    ]);
    expect(r.promotions).toMatchObject([{ state: "prepared" }]);
    expect(result.promoted).toBe(1);
    expect(r.calls).toContain("notify");
  });

  it("stops an assignment whose package went missing instead of rendering nothing", async () => {
    const r = rig({ drafted: [row({ package: null })] });
    await runEditorialTick(r.deps);
    expect(r.promotions).toMatchObject([
      { state: "blocked", code: "PACKAGE_MISSING" },
    ]);
  });
});
