import { beforeEach, describe, expect, it, vi } from "vitest";
import { scopeContentHash } from "@/lib/admin/spec-locked-total";

// ─── Fakes ───────────────────────────────────────────────────────────────────

interface FakeResponse {
  data?: unknown;
  error?: { message: string } | null;
}

interface RecordedWrite {
  op: "insert" | "update";
  payload: unknown;
  filters: unknown[][];
}

/**
 * Table-aware fake of the service-role client. Every `from(table)` call gets a
 * chainable builder; terminal reads (`maybeSingle()` or `await`) shift the next
 * queued response for that table, and `insert` / `update` payloads are recorded
 * with the filters chained after them.
 */
function makeFakeDb(queues: Record<string, FakeResponse[]>) {
  const writes: Record<string, RecordedWrite[]> = {};
  const from = vi.fn((table: string) => {
    const filters: unknown[][] = [];
    let write: RecordedWrite | null = null;
    const next = (): FakeResponse => {
      const queue = queues[table] ?? [];
      return queue.length > 0 ? (queue.shift() as FakeResponse) : { data: null, error: null };
    };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "in", "order", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        filters.push([method, ...args]);
        return builder;
      };
    }
    builder.insert = (payload: unknown) => {
      write = { op: "insert", payload, filters };
      (writes[table] ??= []).push(write);
      return builder;
    };
    builder.update = (payload: unknown) => {
      write = { op: "update", payload, filters };
      (writes[table] ??= []).push(write);
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve(next());
    builder.then = (resolve: (v: FakeResponse) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(next()).then(resolve, reject);
    return builder;
  });
  return { from, writes };
}

const mocks = vi.hoisted(() => ({
  requireSpecOperatorUserId: vi.fn<() => Promise<string | null>>(),
  revalidatePath: vi.fn(),
  db: { from: vi.fn(), writes: {} as Record<string, RecordedWrite[]> },
}));

vi.mock("../_require-operator", () => ({
  requireSpecOperatorUserId: mocks.requireSpecOperatorUserId,
  denyNonOperator: () => {
    throw new Error("SYS :: SPEC OPERATOR GATE DENIED");
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

vi.mock("@/lib/supabase/admin-client", () => ({
  getAdminSupabase: () => ({ from: (table: string) => mocks.db.from(table) }),
}));

import { lockTotal } from "../lock-total";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const OPERATOR = "1746a0c1-be43-45d6-ab4d-584e82594b1b";
const PROJECT = "5c0b1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4";

const project = (overrides: Record<string, unknown> = {}) => ({
  id: PROJECT,
  tier: "spec03",
  status: "discovery",
  is_test: true,
  locked_total_cents: null,
  customer_name: "Ridgeline Roofing",
  customer_email: "ops@ridgeline.ca",
  ...overrides,
});

const docs = (overrides: Record<string, unknown> = {}) => [
  {
    id: "doc-2",
    version: 2,
    content_json: { features: ["takeoff"] },
    sent_at: null,
    superseded_at: null,
    ...overrides,
  },
  {
    id: "doc-1",
    version: 1,
    content_json: { features: [] },
    sent_at: null,
    superseded_at: "2026-09-02T00:00:00Z",
  },
];

function useDb(queues: Record<string, FakeResponse[]>) {
  const fake = makeFakeDb(queues);
  mocks.db.from = fake.from;
  mocks.db.writes = fake.writes;
  return fake;
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Queues for a lockable engagement; the action reads project → docs → sign-off → P2 in that order. */
function lockableQueues(overrides: Partial<Record<string, FakeResponse[]>> = {}) {
  return {
    spec_projects: [{ data: project() }, { error: null }],
    spec_scope_documents: [{ data: docs() }, { error: null }],
    spec_acceptance_events: [{ data: [] }],
    spec_payments: [{ data: [] }],
    spec_communications: [{ error: null }],
    notifications: [{ error: null }],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.requireSpecOperatorUserId.mockReset();
  mocks.requireSpecOperatorUserId.mockResolvedValue(OPERATOR);
  mocks.revalidatePath.mockReset();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("lockTotal — gate and validation", () => {
  it("denies a non-operator before touching the database", async () => {
    mocks.requireSpecOperatorUserId.mockResolvedValue(null);
    const fake = useDb(lockableQueues());
    await expect(lockTotal(form({ project_id: PROJECT, locked_total: "31000" }))).rejects.toThrow(
      "SYS :: SPEC OPERATOR GATE DENIED",
    );
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("requires a project id", async () => {
    const fake = useDb(lockableQueues());
    await expect(lockTotal(form({ locked_total: "31000" }))).rejects.toThrow("SYS :: MISSING PROJECT ID");
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("rejects a figure below the floor before any read", async () => {
    const fake = useDb(lockableQueues());
    await expect(lockTotal(form({ project_id: PROJECT, locked_total: "24,999.99" }))).rejects.toThrow(
      "SYS :: TOTAL BELOW FLOOR · $25,000",
    );
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("names each parse failure in the console voice", async () => {
    useDb(lockableQueues());
    await expect(lockTotal(form({ project_id: PROJECT, locked_total: "" }))).rejects.toThrow(
      "SYS :: TOTAL REQUIRED",
    );
    await expect(lockTotal(form({ project_id: PROJECT, locked_total: "lots" }))).rejects.toThrow(
      "SYS :: TOTAL IS NOT A DOLLAR FIGURE",
    );
    await expect(lockTotal(form({ project_id: PROJECT, locked_total: "31000.123" }))).rejects.toThrow(
      "SYS :: TOTAL CARRIES FRACTIONAL CENTS",
    );
    await expect(lockTotal(form({ project_id: PROJECT, locked_total: "99999999" }))).rejects.toThrow(
      "SYS :: TOTAL EXCEEDS THE COLUMN CEILING · $21,474,836.47",
    );
  });

  it("refuses a fixed-total tier and writes nothing", async () => {
    const fake = useDb(lockableQueues({ spec_projects: [{ data: project({ tier: "spec02" }) }] }));
    await expect(lockTotal(form({ project_id: PROJECT, locked_total: "31000" }))).rejects.toThrow(
      "SYS :: LOCK REFUSED · ONLY SPEC-03 CARRIES A VARIABLE TOTAL",
    );
    expect(fake.writes).toEqual({});
  });

  it("refuses once the customer has signed, naming the signature date", async () => {
    const fake = useDb(
      lockableQueues({
        spec_acceptance_events: [{ data: [{ id: "acc-1", accepted_at: "2026-09-05T12:00:00Z" }] }],
      }),
    );
    await expect(lockTotal(form({ project_id: PROJECT, locked_total: "31000" }))).rejects.toThrow(
      "SYS :: LOCK REFUSED · SIGNED · SEP 05, 2026 — CHANGES GO THROUGH A CHANGE ORDER",
    );
    expect(fake.writes).toEqual({});
  });

  it("refuses once the current doc has been sent, naming the version", async () => {
    const fake = useDb(
      lockableQueues({
        spec_scope_documents: [{ data: docs({ sent_at: "2026-09-05T12:00:00Z" }) }],
      }),
    );
    await expect(lockTotal(form({ project_id: PROJECT, locked_total: "31000" }))).rejects.toThrow(
      "SYS :: LOCK REFUSED · V2 SENT — CUT A NEW REVISION TO CHANGE THE TOTAL",
    );
    expect(fake.writes).toEqual({});
  });

  it("refuses when the engagement has no scope doc yet", async () => {
    const fake = useDb(lockableQueues({ spec_scope_documents: [{ data: [] }] }));
    await expect(lockTotal(form({ project_id: PROJECT, locked_total: "31000" }))).rejects.toThrow(
      "SYS :: LOCK REFUSED · DRAFT V1 FIRST — THE TOTAL LIVES ON THE SCOPE DOC",
    );
    expect(fake.writes).toEqual({});
  });

  it("surfaces a missing project", async () => {
    useDb(lockableQueues({ spec_projects: [{ data: null }] }));
    await expect(lockTotal(form({ project_id: PROJECT, locked_total: "31000" }))).rejects.toThrow(
      "SYS :: PROJECT NOT FOUND",
    );
  });
});

describe("lockTotal — happy path", () => {
  it("writes the figure onto the current scope doc and the project, then logs and notifies", async () => {
    const fake = useDb(lockableQueues());

    await lockTotal(form({ project_id: PROJECT, locked_total: "$31,000" }));

    const expectedContent = { features: ["takeoff"], locked_total_cents: 3_100_000 };
    const docWrite = fake.writes.spec_scope_documents?.[0];
    expect(docWrite?.op).toBe("update");
    expect(docWrite?.payload).toEqual({
      content_json: expectedContent,
      content_hash: scopeContentHash(expectedContent),
    });
    expect(docWrite?.filters).toContainEqual(["eq", "id", "doc-2"]);

    const projectWrite = fake.writes.spec_projects?.[0];
    expect(projectWrite?.op).toBe("update");
    expect(projectWrite?.payload).toMatchObject({ locked_total_cents: 3_100_000 });
    expect((projectWrite?.payload as { updated_at: string }).updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(projectWrite?.filters).toContainEqual(["eq", "id", PROJECT]);

    expect(fake.writes.spec_communications?.[0]?.payload).toEqual({
      spec_project_id: PROJECT,
      direction: "outbound",
      channel: "system",
      summary: "Total locked at $31,000 on scope doc v2 (SPEC-03 · floor $25,000)",
      logged_by_user_id: OPERATOR,
      is_test: true,
    });

    expect(fake.writes.notifications?.[0]?.payload).toEqual({
      user_id: OPERATOR,
      company_id: "00000000-0000-0000-0000-00000000000a",
      type: "spec_total_locked",
      title: "Total locked",
      body: "Ridgeline Roofing · $31,000 on scope doc v2",
      is_read: false,
      action_url: `/admin/spec/${PROJECT}?tab=milestones`,
      action_label: "VIEW MILESTONES",
    });

    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/spec/${PROJECT}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/spec");
  });

  it("describes a re-lock as a change from the previous figure", async () => {
    const fake = useDb(
      lockableQueues({
        spec_projects: [{ data: project({ locked_total_cents: 3_100_000 }) }, { error: null }],
      }),
    );

    await lockTotal(form({ project_id: PROJECT, locked_total: "32,500.50" }));

    expect(fake.writes.spec_projects?.[0]?.payload).toMatchObject({ locked_total_cents: 3_250_050 });
    expect(fake.writes.spec_communications?.[0]?.payload).toMatchObject({
      summary: "Total re-locked $31,000 → $32,500.50 on scope doc v2",
    });
    expect(fake.writes.notifications?.[0]?.payload).toMatchObject({
      title: "Total re-locked",
      body: "Ridgeline Roofing · $32,500.50 on scope doc v2",
    });
  });

  it("stops before the project write when the scope doc write fails", async () => {
    const fake = useDb(
      lockableQueues({
        spec_scope_documents: [{ data: docs() }, { error: { message: "permission denied" } }],
      }),
    );
    await expect(lockTotal(form({ project_id: PROJECT, locked_total: "31000" }))).rejects.toThrow(
      "SYS :: SCOPE DOC UPDATE FAILED · permission denied",
    );
    expect(fake.writes.spec_projects).toBeUndefined();
    expect(fake.writes.spec_communications).toBeUndefined();
  });

  it("does not let a notification failure undo the lock", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    useDb(lockableQueues({ notifications: [{ error: { message: "rail closed" } }] }));
    await expect(lockTotal(form({ project_id: PROJECT, locked_total: "31000" }))).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/spec/${PROJECT}`);
    error.mockRestore();
  });
});
