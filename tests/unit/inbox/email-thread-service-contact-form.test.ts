import { afterEach, describe, expect, it } from "vitest";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";

type ClientRow = { id: string; email: string; name: string };

interface SupabaseDoubleState {
  connectionEmail: string;
  clients: ClientRow[];
  insertedThreads: Array<Record<string, unknown>>;
}

function makeSupabaseDouble(state: SupabaseDoubleState) {
  class Query {
    private action: "select" | "insert" | "update" = "select";
    private payload: Record<string, unknown> | null = null;
    private filters = new Map<string, unknown>();

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    ilike(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    in(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    limit() {
      return this;
    }

    insert(payload: Record<string, unknown>) {
      this.action = "insert";
      this.payload = payload;
      if (this.table === "email_threads") {
        state.insertedThreads.push(payload);
      }
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.action = "update";
      this.payload = payload;
      return this;
    }

    async maybeSingle() {
      if (this.table === "email_threads") {
        return { data: null, error: null };
      }
      if (this.table === "email_connections") {
        return { data: { email: state.connectionEmail }, error: null };
      }
      if (this.table === "clients") {
        const email = String(this.filters.get("email") ?? "").toLowerCase();
        const match = state.clients.find((c) => c.email.toLowerCase() === email);
        return { data: match ? { id: match.id, name: match.name, email: match.email } : null, error: null };
      }
      if (this.table === "sub_clients" || this.table === "users") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }

    async single() {
      if (this.table === "email_threads" && this.action === "insert") {
        return {
          data: {
            id: "thread-row-1",
            archived_at: null,
            snoozed_until: null,
            ai_summary: null,
            next_commitment_due_at: null,
            has_unresolved_commitments: false,
            agent_blocking_question: null,
            created_at: "2026-05-20T21:31:07.000Z",
            updated_at: "2026-05-20T21:31:07.000Z",
            ...this.payload,
          },
          error: null,
        };
      }
      if (this.table === "clients") {
        const id = String(this.filters.get("id") ?? "");
        const match = state.clients.find((c) => c.id === id);
        return { data: match ? { id: match.id, name: match.name } : null, error: null };
      }
      return { data: null, error: null };
    }

    async then(resolve: (value: unknown) => unknown) {
      if (this.table === "clients") {
        const emails = this.filters.get("email");
        const list = Array.isArray(emails)
          ? state.clients
              .filter((c) => emails.includes(c.email.toLowerCase()))
              .map((c) => ({ id: c.id, email: c.email }))
          : [];
        return resolve({ data: list, error: null });
      }
      return resolve({ data: [], error: null });
    }
  }

  return {
    from(table: string) {
      return new Query(table);
    },
  };
}

function baseEmail(overrides: Partial<NormalizedEmail>): NormalizedEmail {
  return {
    id: "msg-1",
    threadId: "provider-thread-1",
    from: "Jared Jerome <jared@example-contractors.com>",
    fromName: "Jared Jerome",
    to: ["office@example-contractors.com"],
    cc: [],
    subject: "Fwd: Contact Us 3 got a new submission",
    snippet: "A site visitor just submitted your form Contact Us 3",
    bodyText: "",
    date: new Date("2026-05-20T21:31:07.000Z"),
    labelIds: ["INBOX"],
    isRead: false,
    hasAttachments: false,
    sizeEstimate: 0,
    ...overrides,
  };
}

const contactFormBody = `Thanks,
Jared Jerome
778-268-3324
Canpro Deck and Rail

Sent from my iPhone

Begin forwarded message:

From: Canpro Deck and Rail <notifications@wix-forms.com>
Date: May 20, 2026 at 14:46:39 MDT
To: jared@example-contractors.com
Subject: Contact Us 3 got a new submission
Reply-To: "marcel.mercier@example.com" <marcel.mercier@example.com>

A site visitor just submitted your form Contact Us 3 on example-contractors

Submission summary:

Full Name:
Marcel Mercier

Phone:
12505388340

Email:
marcel.mercier@example.com

How can we help?:
We need someone to renovate and replace two existing roof decks.`;

describe("EmailThreadService.upsertFromEmail contact-form sender identity", () => {
  afterEach(() => {
    setSupabaseOverride(null);
  });

  it("links the thread to the parsed submitter client instead of the internal forwarder", async () => {
    const state: SupabaseDoubleState = {
      connectionEmail: "office@example-contractors.com",
      clients: [
        {
          id: "client-marcel",
          email: "marcel.mercier@example.com",
          name: "Marcel Mercier",
        },
      ],
      insertedThreads: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    await EmailThreadService.upsertFromEmail({
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "provider-thread-1",
      direction: "inbound",
      email: baseEmail({ bodyText: contactFormBody }),
    });

    expect(state.insertedThreads).toHaveLength(1);
    expect(state.insertedThreads[0]).toMatchObject({
      latest_sender_email: "marcel.mercier@example.com",
      latest_sender_name: "Marcel Mercier",
      client_id: "client-marcel",
    });
    expect(state.insertedThreads[0].participants).toContain(
      "marcel.mercier@example.com"
    );
    expect(state.insertedThreads[0].participants).not.toContain(
      "notifications@wix-forms.com"
    );
  });

  it("keeps normal non-form email sender/client resolution unchanged", async () => {
    const state: SupabaseDoubleState = {
      connectionEmail: "office@example-contractors.com",
      clients: [
        {
          id: "client-david",
          email: "david@example.net",
          name: "David Riddell",
        },
      ],
      insertedThreads: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    await EmailThreadService.upsertFromEmail({
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "provider-thread-2",
      direction: "inbound",
      email: baseEmail({
        id: "msg-2",
        threadId: "provider-thread-2",
        from: "David Riddell <david@example.net>",
        fromName: "David Riddell",
        to: ["office@example-contractors.com"],
        subject: "Deck quote request",
        snippet: "Can you quote my deck replacement?",
        bodyText: "Can you quote my deck replacement?",
      }),
    });

    expect(state.insertedThreads[0]).toMatchObject({
      latest_sender_email: "david@example.net",
      latest_sender_name: "David Riddell",
      client_id: "client-david",
    });
  });
});
