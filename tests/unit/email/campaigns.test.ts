/**
 * Unit tests for the campaign service module. Uses a hand-rolled
 * Supabase chain mock that records the last-resolved data + error per
 * builder so each state transition can assert on its result.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createCampaign,
  scheduleCampaign,
  cancelCampaign,
  pauseCampaign,
  resumeCampaign,
  completeCampaignIfDone,
  getCampaignStats,
  listCampaigns,
  enqueueCampaignJobs,
} from "@/lib/email/campaigns";

vi.mock("@/lib/email/suppressions", () => ({
  filterSuppressed: vi.fn(async (_emails: string[]) => new Set<string>()),
}));

import { filterSuppressed } from "@/lib/email/suppressions";

interface Recorder {
  table: string;
  inserts: unknown[];
  updates: unknown[];
  upserts: unknown[];
  filters: Array<{ kind: string; col: string; val: unknown }>;
  upsertOptions: unknown[];
}

function buildClient(opts: {
  /** rows returned by .single() or .maybeSingle() */
  single?: { data: unknown; error: unknown };
  /** rows returned for list queries (await final builder) */
  list?: { data: unknown[]; count: number; error: unknown };
  /** rows returned for count head queries */
  countHead?: { count: number; error: unknown };
  /** rows returned for await on the builder itself (terminal await) */
  terminal?: { data?: unknown[]; count?: number; error: unknown };
}): { client: unknown; rec: Recorder } {
  const rec: Recorder = {
    table: "",
    inserts: [],
    updates: [],
    upserts: [],
    filters: [],
    upsertOptions: [],
  };

  // Per-from() flags. Most are set by select() and consumed by `then`.
  let isHead = false;

  const builder: Record<string, unknown> = {};
  const ensure = () => builder;

  Object.assign(builder, {
    insert(payload: unknown) {
      rec.inserts.push(payload);
      return ensure();
    },
    update(payload: unknown) {
      rec.updates.push(payload);
      return ensure();
    },
    upsert(payload: unknown, options?: unknown) {
      rec.upserts.push(payload);
      if (options !== undefined) rec.upsertOptions.push(options);
      return Promise.resolve({ error: null });
    },
    select(_cols?: string, options?: { count?: string; head?: boolean }) {
      if (options?.head) isHead = true;
      return ensure();
    },
    eq(col: string, val: unknown) {
      rec.filters.push({ kind: "eq", col, val });
      return ensure();
    },
    in(col: string, val: unknown) {
      rec.filters.push({ kind: "in", col, val });
      return ensure();
    },
    not(col: string, _op: string, val: unknown) {
      rec.filters.push({ kind: "not", col, val });
      return ensure();
    },
    or(expr: string) {
      rec.filters.push({ kind: "or", col: "or", val: expr });
      return ensure();
    },
    order(_col: string, _opts?: unknown) {
      return ensure();
    },
    range(_a: number, _b: number) {
      if (opts.list) return Promise.resolve(opts.list);
      return Promise.resolve({ data: [], count: 0, error: null });
    },
    limit(_n: number) {
      if (opts.list) return Promise.resolve(opts.list);
      return Promise.resolve({ data: [], error: null });
    },
    single() {
      return Promise.resolve(opts.single ?? { data: null, error: null });
    },
    maybeSingle() {
      return Promise.resolve(opts.single ?? { data: null, error: null });
    },
    // Thenable so `await db.from(...).select(...).eq(...)` resolves to count
    // when head:true was set, or to {data, error} otherwise.
    then<TFulfilled = unknown>(
      onFulfilled?: (v: unknown) => TFulfilled
    ): Promise<TFulfilled> {
      const result =
        isHead && opts.countHead
          ? opts.countHead
          : opts.terminal ?? { data: [], error: null };
      // Reset for the next call to from() — the thenable was consumed.
      isHead = false;
      return Promise.resolve(result).then(onFulfilled as never);
    },
  });

  const client = {
    from: (table: string) => {
      rec.table = table;
      isHead = false;
      return builder;
    },
  };
  return { client, rec };
}

const baseRow = {
  id: "c1",
  name: "X",
  slug: "x",
  template_id: "product_update",
  audience_filter: {},
  audience_template_id: null,
  scheduled_for: null,
  send_status: "draft",
  recipient_count_estimate: 0,
  recipient_count_actual: null,
  sent_count: 0,
  delivered_count: 0,
  bounced_count: 0,
  opened_count: 0,
  clicked_count: 0,
  suppressed_skipped_count: 0,
  failed_count: 0,
  paused_at: null,
  pause_reason: null,
  created_by_user_id: null,
  created_at: "2026-04-27T00:00:00Z",
  updated_at: "2026-04-27T00:00:00Z",
  completed_at: null,
};

beforeEach(() => {
  vi.mocked(filterSuppressed).mockClear();
  vi.mocked(filterSuppressed).mockImplementation(
    async (_emails: string[]) => new Set<string>()
  );
});

describe("createCampaign", () => {
  it("inserts with defaults and returns a typed Campaign", async () => {
    const { client, rec } = buildClient({ single: { data: baseRow, error: null } });
    const c = await createCampaign({
      name: "X",
      slug: "x",
      templateId: "product_update",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
    });
    expect(c.id).toBe("c1");
    expect(rec.table).toBe("email_campaigns");
    expect(rec.inserts).toHaveLength(1);
    expect((rec.inserts[0] as { send_status: string }).send_status).toBe(
      "draft"
    );
  });

  it("throws on insert error", async () => {
    const { client } = buildClient({
      single: { data: null, error: { message: "boom" } },
    });
    await expect(
      createCampaign({
        name: "X",
        slug: "x",
        templateId: "product_update",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: client as any,
      })
    ).rejects.toThrow(/createCampaign/);
  });
});

describe("scheduleCampaign", () => {
  it("sets scheduled_for + send_status='scheduled'", async () => {
    const when = new Date("2026-05-01T10:00:00Z");
    const updated = { ...baseRow, send_status: "scheduled", scheduled_for: when.toISOString() };
    const { client, rec } = buildClient({ single: { data: updated, error: null } });
    const c = await scheduleCampaign(
      "c1",
      when,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any
    );
    expect(c.sendStatus).toBe("scheduled");
    expect((rec.updates[0] as { send_status: string }).send_status).toBe(
      "scheduled"
    );
  });
});

describe("cancelCampaign", () => {
  it("flips status to cancelled and cancels pending jobs", async () => {
    const cancelled = { ...baseRow, send_status: "cancelled" };
    const { client, rec } = buildClient({ single: { data: cancelled, error: null } });
    const c = await cancelCampaign(
      "c1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any
    );
    expect(c.sendStatus).toBe("cancelled");
    // First update is the campaign, second is the jobs sweep.
    expect(rec.updates.length).toBeGreaterThanOrEqual(2);
    expect(
      (rec.updates[1] as { status: string }).status
    ).toBe("cancelled");
  });
});

describe("pauseCampaign", () => {
  it("only acts when send_status is in_flight", async () => {
    const paused = {
      ...baseRow,
      send_status: "paused",
      pause_reason: "manual",
      paused_at: "2026-04-27T00:00:00Z",
    };
    const { client, rec } = buildClient({ single: { data: paused, error: null } });
    const c = await pauseCampaign(
      "c1",
      "manual",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any
    );
    expect(c.sendStatus).toBe("paused");
    // pause asserts both id and prior-status filter
    expect(rec.filters.some((f) => f.col === "send_status" && f.val === "in_flight")).toBe(true);
  });
});

describe("resumeCampaign", () => {
  it("flips paused → in_flight and clears pause fields", async () => {
    const resumed = {
      ...baseRow,
      send_status: "in_flight",
      pause_reason: null,
      paused_at: null,
    };
    const { client, rec } = buildClient({ single: { data: resumed, error: null } });
    const c = await resumeCampaign(
      "c1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any
    );
    expect(c.sendStatus).toBe("in_flight");
    const upd = rec.updates[0] as { send_status: string; paused_at: null; pause_reason: null };
    expect(upd.send_status).toBe("in_flight");
    expect(upd.paused_at).toBe(null);
    expect(upd.pause_reason).toBe(null);
  });
});

describe("completeCampaignIfDone", () => {
  it("returns false when there are still pending jobs", async () => {
    const { client } = buildClient({ countHead: { count: 3, error: null } });
    const done = await completeCampaignIfDone(
      "c1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any
    );
    expect(done).toBe(false);
  });

  it("flips to completed when no pending and not already terminal", async () => {
    const { client, rec } = buildClient({
      countHead: { count: 0, error: null },
      single: { data: { send_status: "in_flight" }, error: null },
    });
    const done = await completeCampaignIfDone(
      "c1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any
    );
    expect(done).toBe(true);
    // Final update flips to completed.
    const lastUpdate = rec.updates[rec.updates.length - 1] as {
      send_status: string;
    };
    expect(lastUpdate.send_status).toBe("completed");
  });

  it("returns false when campaign already in a terminal state", async () => {
    const { client } = buildClient({
      countHead: { count: 0, error: null },
      single: { data: { send_status: "completed" }, error: null },
    });
    const done = await completeCampaignIfDone(
      "c1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any
    );
    expect(done).toBe(false);
  });
});

describe("getCampaignStats", () => {
  it("returns null when no row found", async () => {
    const { client } = buildClient({ single: { data: null, error: null } });
    const c = await getCampaignStats(
      "missing",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any
    );
    expect(c).toBeNull();
  });

  it("returns row mapped to Campaign shape", async () => {
    const { client } = buildClient({ single: { data: baseRow, error: null } });
    const c = await getCampaignStats(
      "c1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any
    );
    expect(c?.id).toBe("c1");
    expect(c?.templateId).toBe("product_update");
  });
});

describe("listCampaigns", () => {
  it("returns rows + total", async () => {
    const { client } = buildClient({
      list: { data: [baseRow, baseRow], count: 2, error: null },
    });
    const r = await listCampaigns({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
    });
    expect(r.rows.length).toBe(2);
    expect(r.total).toBe(2);
  });
});

describe("enqueueCampaignJobs", () => {
  it("inserts pending jobs, marks campaign in_flight when audience non-empty", async () => {
    const { client, rec } = buildClient({});
    const r = await enqueueCampaignJobs({
      campaignId: "c1",
      recipients: [
        { email: "A@example.com", userId: "u1" },
        { email: "b@example.com", userId: "u2" },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
    });
    expect(r.enqueued).toBe(2);
    expect(r.suppressedSkipped).toBe(0);
    expect(rec.upserts).toHaveLength(1);
    const rows = rec.upserts[0] as Array<{ recipient_email: string }>;
    // Lowercase enforcement
    expect(rows.map((r) => r.recipient_email).sort()).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    // Final campaign update sets in_flight (rows present)
    const lastUpdate = rec.updates[rec.updates.length - 1] as {
      send_status: string;
      recipient_count_actual: number;
    };
    expect(lastUpdate.send_status).toBe("in_flight");
    expect(lastUpdate.recipient_count_actual).toBe(2);
  });

  it("flips straight to completed when audience is fully suppressed", async () => {
    vi.mocked(filterSuppressed).mockResolvedValueOnce(
      new Set(["a@example.com", "b@example.com"])
    );
    const { client, rec } = buildClient({});
    const r = await enqueueCampaignJobs({
      campaignId: "c1",
      recipients: [
        { email: "a@example.com" },
        { email: "b@example.com" },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
    });
    expect(r.enqueued).toBe(0);
    expect(r.suppressedSkipped).toBe(2);
    const lastUpdate = rec.updates[rec.updates.length - 1] as {
      send_status: string;
    };
    expect(lastUpdate.send_status).toBe("completed");
  });
});
