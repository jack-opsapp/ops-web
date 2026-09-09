import { describe, expect, it, vi } from "vitest";
import { retainImportForWorkReview } from "@/lib/email/import-email-work-review";
import { loadEmailCustomerContext } from "@/lib/email/email-work-routing";

type Row = Record<string, unknown>;
function database() {
  const tables: Record<string, Row[]> = {
    clients: [
      { id: "client", company_id: "company", email: "primary@example.com" },
    ],
    sub_clients: [
      {
        id: "contact",
        company_id: "company",
        client_id: "client",
        email: "customer@example.com",
      },
    ],
    projects: [
      {
        id: "project",
        company_id: "company",
        client_id: "client",
        status: "in_progress",
        address: "123 Cedar Lane",
      },
    ],
    activities: [],
  };
  const writes: string[] = [];
  let failRouting = false;
  const rpc = vi.fn(async (_name: string, params: Row) => {
    if (failRouting) {
      failRouting = false;
      return { data: null, error: { message: "interrupted" } };
    }
    const row = tables.activities.find(
      (row) => row.id === params.p_activity_id
    )!;
    row.match_confidence = params.p_needs_review
      ? "work_intent_review"
      : "existing_job";
    row.client_id = params.p_client_id;
    row.project_id = params.p_project_id;
    return { data: true, error: null };
  });
  const client = {
    rpc,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let inserted: Row | null = null;
      const result = () => ({
        data: inserted
          ? [inserted]
          : (tables[table] ?? []).filter((row) =>
              filters.every((filter) => filter(row))
            ),
        error: null,
      });
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        ilike(column: string, value: string) {
          filters.push(
            (row) =>
              String(row[column] ?? "").toLowerCase() === value.toLowerCase()
          );
          return builder;
        },
        is(column: string, value: unknown) {
          filters.push((row) => (row[column] ?? null) === value);
          return builder;
        },
        in(column: string, values: unknown[]) {
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        order: () => builder,
        range: () => builder,
        insert(row: Row) {
          inserted = { id: `activity-${tables.activities.length}`, ...row };
          tables[table].push(inserted);
          writes.push(table);
          return builder;
        },
        async single() {
          return { data: result().data[0] ?? null, error: null };
        },
        async maybeSingle() {
          return { data: result().data[0] ?? null, error: null };
        },
        then(resolve: (r: ReturnType<typeof result>) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return builder;
    },
  };
  return {
    client,
    tables,
    writes,
    rpc,
    failNextRouting() {
      failRouting = true;
    },
  };
}
const message = {
  providerMessageId: "message",
  providerThreadId: "thread",
  fromEmail: "customer@example.com",
  subject: "Warranty",
  occurredAt: new Date("2026-09-09T04:00:00Z"),
  direction: "inbound" as const,
  bodyText: "The railing you installed is loose.",
};
function hold(
  db: ReturnType<typeof database>,
  overrides: Partial<Parameters<typeof retainImportForWorkReview>[0]> = {}
) {
  return retainImportForWorkReview({
    supabase: db.client as never,
    companyId: "company",
    connectionId: "connection",
    connectionEmail: "office@example.com",
    customerEmail: "customer@example.com",
    messages: [message],
    ...overrides,
  });
}
describe("import work-purpose boundary", () => {
  it("holds an established subcontact's old scan without creating a client or sale", async () => {
    const db = database();
    expect(await hold(db)).toEqual({ held: true, activitiesCreated: 1 });
    expect(db.writes).toEqual(["activities"]);
    expect(db.tables.activities[0]).toMatchObject({
      opportunity_id: null,
      client_id: "client",
      match_confidence: "work_intent_review",
      body_text: message.bodyText,
    });
    expect(await hold(db)).toEqual({ held: true, activitiesCreated: 0 });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("hydrates an exact metadata-only import before finalizing its receipt", async () => {
    const db = database();
    const hydrateMessage = vi.fn(async () => ({
      ...message,
      bodyText: "Please deduct the damaged gate from our bill.",
    }));
    await hold(db, {
      messages: [{ ...message, bodyText: undefined }],
      hydrateMessage,
    });
    expect(hydrateMessage).toHaveBeenCalledOnce();
    expect(db.tables.activities[0]).toMatchObject({
      body_text: "Please deduct the damaged gate from our bill.",
      match_confidence: "work_intent_review",
      opportunity_id: null,
    });
    expect(db.writes).toEqual(["activities"]);
  });
  it("refuses an unreadable or different source before writing a final receipt", async () => {
    for (const hydrateMessage of [
      undefined,
      vi.fn(async () => ({ ...message, providerMessageId: "other" })),
    ]) {
      const db = database();
      await expect(
        hold(db, {
          messages: [{ ...message, bodyText: undefined }],
          hydrateMessage,
        })
      ).rejects.toThrow(/body is missing|source could not be verified/);
      expect(db.writes).toEqual([]);
      expect(db.rpc).not.toHaveBeenCalled();
    }
  });
  it("does not fetch provider content for a first-time customer's ordinary import", async () => {
    const db = database();
    db.tables.projects = [];
    const hydrateMessage = vi.fn();
    expect(
      await hold(db, {
        messages: [{ ...message, bodyText: undefined }],
        hydrateMessage,
      })
    ).toEqual({ held: false, activitiesCreated: 0 });
    expect(hydrateMessage).not.toHaveBeenCalled();
  });
  it("repairs an interrupted routing transaction without duplicating the source", async () => {
    const db = database();
    db.failNextRouting();
    await expect(hold(db)).rejects.toThrow("interrupted");
    expect(db.tables.activities[0].match_confidence).toBe(
      "work_routing_pending"
    );
    expect(await hold(db)).toEqual({ held: true, activitiesCreated: 0 });
    expect(db.tables.activities).toHaveLength(1);
    expect(db.tables.activities[0].match_confidence).toBe("work_intent_review");
  });
  it("does not let another import override a durable project receipt", async () => {
    const db = database();
    db.tables.activities.push({
      id: "existing",
      email_message_id: "message",
      email_thread_id: "thread",
      email_connection_id: "connection",
      company_id: "company",
      type: "email",
      client_id: "client",
      project_id: "project",
      match_confidence: "existing_job",
    });
    db.tables.projects = [];
    expect(await hold(db)).toEqual({ held: true, activitiesCreated: 0 });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.tables.activities[0].project_id).toBe("project");
  });
  it("preserves an already-owned current message", async () => {
    const db = database();
    db.tables.activities.push({
      id: "existing",
      email_message_id: "message",
      email_thread_id: "thread",
      email_connection_id: "connection",
      company_id: "company",
      type: "email",
      opportunity_id: "explicit-new-job",
    });
    expect(await hold(db)).toEqual({ held: false, activitiesCreated: 0 });
    expect(db.writes).toEqual([]);
  });
  it("does not borrow another company's customer or project", async () => {
    const db = database();
    db.tables.clients[0].company_id = "foreign-company";
    expect(
      await loadEmailCustomerContext({
        supabase: db.client as never,
        companyId: "company",
        contactEmails: ["customer@example.com"],
      })
    ).toEqual({ clientIds: [], projects: [] });
  });
  it("does not use deleted or merged customer records as identity authority", async () => {
    for (const field of ["deleted_at", "merged_into_client_id"]) {
      const db = database();
      db.tables.clients[0][field] = "removed";
      expect(
        await loadEmailCustomerContext({
          supabase: db.client as never,
          companyId: "company",
          contactEmails: ["customer@example.com"],
        })
      ).toEqual({ clientIds: [], projects: [] });
    }
  });
});
