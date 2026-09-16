import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  assignments: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/email/sendgrid", () => ({ sendBlogNewsletter: vi.fn() }));
vi.mock("@/lib/journal/editorial/runtime", () => ({ fulfilJournalImageRequestNow: vi.fn() }));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => ({
      select: () => {
        if (table === "journal_editorial_settings")
          return { eq: () => ({ single: async () => ({ data: state.settings, error: null }) }) };
        if (table === "journal_editorial_assignments")
          return { order: () => ({ limit: async () => ({ data: state.assignments, error: null }) }) };
        return { eq: () => ({ maybeSingle: async () => ({ data: { value: false }, error: null }) }) };
      },
    }),
  }),
}));

import { readJournalEditorial } from "@/lib/journal/editorial/admin";

const CLAIM = "11111111-1111-4111-8111-111111111111";
const OLD_CLAIM = "22222222-2222-4222-8222-222222222222";
const pitch = (topic: string) => ({ topic, headline: "YOUR NEW GUY QUIT BEFORE LUNCH", signals: [], chatter: [] });
const feeds = (ok: number, failed: number) => [
  ...Array.from({ length: ok }, (_, index) => ({ key: `ok-${index}`, ok: true })),
  ...Array.from({ length: failed }, (_, index) => ({ key: `failed-${index}`, ok: false })),
];

function assignment(overrides: Record<string, unknown>) {
  return {
    id: "a1",
    identity: "weekly:2026-09-21",
    state: "authoring",
    package: null,
    attempt_log: [],
    claim_token: CLAIM,
    pitch_claim_token: CLAIM,
    pitch: pitch("Live claim topic"),
    ...overrides,
  };
}

describe("admin journal read", () => {
  beforeEach(() => {
    state.settings = { mode: "prepare", radar_scanned_at: "2026-09-16T18:09:00+00:00", radar_sources: feeds(25, 1) };
    state.assignments = [];
  });

  it("reports the radar's health and hides its raw feed list", async () => {
    const result = await readJournalEditorial();
    expect(result.settings).toEqual({ mode: "prepare" });
    expect(result.radar).toEqual({ scanned_at: "2026-09-16T18:09:00+00:00", ok: 25, total: 26, degraded: false });

    state.settings = { mode: "prepare", radar_scanned_at: "2026-09-16T18:09:00+00:00", radar_sources: feeds(9, 17) };
    expect((await readJournalEditorial()).radar).toMatchObject({ ok: 9, total: 26, degraded: true });

    state.settings = { mode: "prepare", radar_scanned_at: null, radar_sources: [] };
    expect((await readJournalEditorial()).radar).toEqual({ scanned_at: null, ok: 0, total: 0, degraded: false });
  });

  it("shows the draft's pitch, or the live claim's pitch while writing, and never a claim token", async () => {
    state.assignments = [
      assignment({ id: "writing" }),
      assignment({ id: "stale-pitch", pitch_claim_token: OLD_CLAIM }),
      assignment({ id: "requeued", state: "queued", claim_token: null }),
      assignment({
        id: "drafted",
        state: "scheduled",
        claim_token: CLAIM,
        pitch: pitch("Row pitch"),
        package: {
          article: { title: "T" },
          html: "<p>x</p>",
          word_count: 1100,
          citations: [],
          internal_links: [],
          evidence: [],
          review: {},
          pitch: pitch("Draft topic"),
        },
      }),
      assignment({ id: "before-funnel", state: "published", package: { article: {}, citations: [], internal_links: [], evidence: [], review: {} }, pitch: null }),
    ];
    const rows = (await readJournalEditorial()).assignments as Array<Record<string, unknown>>;
    expect(rows.map((row) => [row.id, (row.pitch as { topic: string } | null)?.topic ?? null])).toEqual([
      ["writing", "Live claim topic"],
      ["stale-pitch", null],
      ["requeued", null],
      ["drafted", "Draft topic"],
      ["before-funnel", null],
    ]);
    expect(JSON.stringify(rows)).not.toContain(CLAIM);
    for (const row of rows) {
      expect(row).not.toHaveProperty("claim_token");
      expect(row).not.toHaveProperty("pitch_claim_token");
    }
  });
});
