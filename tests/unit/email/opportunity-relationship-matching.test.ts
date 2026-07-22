import { describe, expect, it } from "vitest";
import {
  decideOpportunityRelationshipMatch,
  findOpportunityRelationshipMatch,
  findUniqueExistingProjectForEmailConversion,
  type OpportunityRelationshipCandidate,
  type OpportunityRelationshipFacts,
} from "@/lib/email/opportunity-relationship-matching";

type FixtureRow = Record<string, unknown>;

function ilikePatternToRegex(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\" && index + 1 < pattern.length) {
      index += 1;
      source += pattern[index].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (character === "%") {
      source += ".*";
    } else if (character === "_") {
      source += ".";
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`, "i");
}

function fixtureSupabase(tables: Record<string, FixtureRow[]>) {
  const ranges: Array<{ table: string; from: number; to: number }> = [];

  return {
    ranges,
    supabase: {
      from(tableName: string) {
        const filters: Array<(row: FixtureRow) => boolean> = [];
        const orders: Array<{ column: string; ascending: boolean }> = [];
        let limitCount: number | null = null;
        let range: { from: number; to: number } | null = null;

        const execute = () => {
          let rows = [...(tables[tableName] ?? [])].filter((row) =>
            filters.every((filter) => filter(row))
          );
          for (const order of [...orders].reverse()) {
            rows.sort((left, right) => {
              const leftValue = String(left[order.column] ?? "");
              const rightValue = String(right[order.column] ?? "");
              const comparison = leftValue.localeCompare(rightValue);
              return order.ascending ? comparison : -comparison;
            });
          }
          if (range) rows = rows.slice(range.from, range.to + 1);
          if (limitCount !== null) rows = rows.slice(0, limitCount);
          return { data: rows, error: null };
        };

        const chain = {
          select() {
            return chain;
          },
          eq(column: string, value: unknown) {
            filters.push((row) => row[column] === value);
            return chain;
          },
          ilike(column: string, value: unknown) {
            const regex = ilikePatternToRegex(String(value));
            filters.push((row) => regex.test(String(row[column] ?? "")));
            return chain;
          },
          is(column: string, value: unknown) {
            filters.push((row) => (row[column] ?? null) === value);
            return chain;
          },
          in(column: string, values: unknown[]) {
            filters.push((row) => values.includes(row[column]));
            return chain;
          },
          or(expression: string) {
            const equalities = expression.split(",").map((clause) => {
              const [column, operator, ...rawValue] = clause.split(".");
              if (!column || operator !== "eq") {
                throw new Error(`Unsupported fixture OR clause: ${clause}`);
              }
              return { column, value: rawValue.join(".") };
            });
            filters.push((row) =>
              equalities.some(({ column, value }) => row[column] === value)
            );
            return chain;
          },
          order(column: string, options?: { ascending?: boolean }) {
            orders.push({
              column,
              ascending: options?.ascending !== false,
            });
            return chain;
          },
          limit(count: number) {
            limitCount = count;
            return chain;
          },
          range(from: number, to: number) {
            range = { from, to };
            ranges.push({ table: tableName, from, to });
            return chain;
          },
          async maybeSingle() {
            const result = execute();
            return {
              data: result.data.length === 1 ? result.data[0] : null,
              error: null,
            };
          },
          then(
            resolve: (value: { data: FixtureRow[]; error: null }) => unknown,
            reject?: (reason: unknown) => unknown
          ) {
            return Promise.resolve(execute()).then(resolve, reject);
          },
        };
        return chain;
      },
    },
  };
}

function candidate(
  overrides: Partial<OpportunityRelationshipCandidate> = {}
): OpportunityRelationshipCandidate {
  return {
    id: "opp-active",
    clientId: "client-john",
    stage: "follow_up",
    archivedAt: null,
    deletedAt: null,
    contactEmail: "john@example.com",
    contactPhone: "250-555-0100",
    address: "18 Cedar Road, Victoria BC",
    title: "John Carter - Deck rebuild",
    description: "Replace the existing back deck and railing.",
    sourceEmailId: "thread-john-1",
    createdAt: "2026-05-20T17:00:00.000Z",
    updatedAt: "2026-05-21T17:00:00.000Z",
    clientEmails: ["john@example.com"],
    subClientEmails: [],
    clientPhones: ["250-555-0100"],
    subClientPhones: [],
    clientAddresses: ["18 Cedar Road, Victoria BC"],
    subClientAddresses: [],
    project: null,
    ...overrides,
  };
}

function facts(
  overrides: Partial<OpportunityRelationshipFacts> = {}
): OpportunityRelationshipFacts {
  return {
    contactName: "John Carter",
    contactEmail: "john@example.com",
    contactPhone: null,
    address: null,
    description: "Following up on the existing deck estimate.",
    subject: "Deck estimate follow-up",
    providerThreadId: "thread-new-1",
    participantEmails: [],
    forwardedParticipantEmails: [],
    sourcePlatform: null,
    phaseCEnabled: false,
    ...overrides,
  };
}

function opportunityRow(index: number, overrides: FixtureRow = {}): FixtureRow {
  return {
    id: `opp-${String(index).padStart(3, "0")}`,
    company_id: "company-1",
    client_id: null,
    client_ref: null,
    stage: "won",
    archived_at: null,
    deleted_at: null,
    contact_email: "shared@example.com",
    contact_phone: null,
    address: null,
    title: `Historical opportunity ${index}`,
    description: null,
    source_email_id: null,
    project_id: null,
    project_ref: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: new Date(
      Date.UTC(2026, 6, 20, 0, 0, 0) - index * 1_000
    ).toISOString(),
    ...overrides,
  };
}

describe("opportunity relationship matching", () => {
  it("fails closed when a relationship lookup read fails", async () => {
    const failedQuery = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      ilike() {
        return this;
      },
      is() {
        return this;
      },
      order() {
        return this;
      },
      limit() {
        return this;
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve({
          data: null,
          error: { message: "relationship database unavailable" },
        }).then(resolve);
      },
    };

    await expect(
      findOpportunityRelationshipMatch({
        supabase: { from: () => failedQuery } as never,
        companyId: "company-1",
        connectionId: "connection-1",
        providerThreadId: "thread-1",
        clientId: null,
        facts: facts(),
      })
    ).rejects.toThrow(
      "Opportunity relationship lookup failed: relationship database unavailable"
    );
  });

  it("links a new thread from the exact same customer email to an active opportunity", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts(),
      candidates: [candidate()],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-active",
      confidence: "exact_contact_email",
      reason: expect.stringContaining("email"),
    });
  });

  it("fails closed when the same exact email matches multiple active opportunities", () => {
    expect(() =>
      decideOpportunityRelationshipMatch({
        facts: facts({ address: null }),
        candidates: [
          candidate({ id: "opp-email-a", address: null }),
          candidate({ id: "opp-email-b", address: null }),
        ],
      })
    ).toThrow("Multiple active opportunities matched the exact customer email");
  });

  it("fails closed when the same phone matches multiple active opportunities", () => {
    expect(() =>
      decideOpportunityRelationshipMatch({
        facts: facts({
          contactEmail: "new@example.com",
          contactPhone: "250-555-0100",
          address: null,
        }),
        candidates: [
          candidate({
            id: "opp-phone-a",
            contactEmail: "a@example.com",
            address: null,
          }),
          candidate({
            id: "opp-phone-b",
            contactEmail: "b@example.com",
            address: null,
          }),
        ],
      })
    ).toThrow("Multiple active opportunities matched the exact phone");
  });

  it("fails closed when the same job address matches multiple active opportunities", () => {
    expect(() =>
      decideOpportunityRelationshipMatch({
        facts: facts({
          contactEmail: "new@example.com",
          contactPhone: null,
          address: "18 Cedar Road, Victoria BC",
        }),
        candidates: [
          candidate({
            id: "opp-address-a",
            contactEmail: "a@example.com",
            contactPhone: null,
          }),
          candidate({
            id: "opp-address-b",
            contactEmail: "b@example.com",
            contactPhone: null,
          }),
        ],
      })
    ).toThrow("Multiple active opportunities matched the exact job address");
  });

  it("does not revive an archived opportunity through an active project", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts(),
      candidates: [
        candidate({
          id: "opp-archived",
          archivedAt: "2026-07-01T00:00:00.000Z",
          project: {
            id: "project-active",
            clientId: "client-john",
            opportunityId: null,
            status: "accepted",
            title: "18 Cedar Road",
            description: null,
            address: "18 Cedar Road, Victoria BC",
            completedAt: null,
            deletedAt: null,
          },
        }),
      ],
    });

    expect(decision).toMatchObject({ action: "create_new" });
  });

  it.each([
    {
      label: "contact email",
      incoming: facts({
        contactEmail: "john@example.com",
        address: "91 Maple Road, Victoria BC",
      }),
      existing: candidate(),
    },
    {
      label: "CC participant",
      incoming: facts({
        contactEmail: "new.sender@example.com",
        participantEmails: ["john@example.com"],
        address: "91 Maple Road, Victoria BC",
      }),
      existing: candidate(),
    },
    {
      label: "alternate contact",
      incoming: facts({
        contactEmail: "mary@example.com",
        address: "91 Maple Road, Victoria BC",
      }),
      existing: candidate({ subClientEmails: ["mary@example.com"] }),
    },
  ])(
    "creates a new opportunity when an exact $label belongs to a different job address",
    ({ incoming, existing }) => {
      const decision = decideOpportunityRelationshipMatch({
        facts: incoming,
        candidates: [existing],
      });

      expect(decision).toMatchObject({
        action: "create_new",
        suggestedOpportunityId: "opp-active",
      });
    }
  );

  it("keeps exact-email matching when job addresses differ only by a canonical street-type variant", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({ address: "18 Cedar Rd, Victoria BC" }),
      candidates: [candidate({ address: "18 Cedar Road, Victoria BC" })],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-active",
      confidence: "exact_contact_email",
    });
  });

  it("matches the same street when optional locality text is present on only one side", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({ address: "2745 Fernwood Rd" }),
      candidates: [candidate({ address: "2745 Fernwood Road, Victoria BC" })],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-active",
      confidence: "exact_contact_email",
    });
  });

  it("matches the same explicit unit across designator and locality variants", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({ address: "123 Main St Apt. 2, Victoria BC" }),
      candidates: [
        candidate({ address: "123 Main Street, Unit 2, Victoria, BC" }),
      ],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-active",
      confidence: "exact_contact_email",
    });
  });

  it("does not link the same contact when explicit unit identifiers differ", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({ address: "123 Main St #3, Victoria BC" }),
      candidates: [candidate({ address: "123 Main Street, Suite 2" })],
    });

    expect(decision).toMatchObject({
      action: "create_new",
      suggestedOpportunityId: "opp-active",
    });
  });

  it("returns the provider-linked opportunity's real client instead of a separate matcher candidate", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts(),
      candidates: [
        candidate({
          id: "opp-thread-owner",
          clientId: "client-thread-owner",
        }),
        candidate({ id: "opp-other", clientId: "client-other" }),
      ],
      providerLinkedOpportunityId: "opp-thread-owner",
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-thread-owner",
      clientId: "client-thread-owner",
      confidence: "provider_thread",
    });
  });

  it("fails closed when a provider-linked opportunity was not hydrated with its client", () => {
    expect(() =>
      decideOpportunityRelationshipMatch({
        facts: facts(),
        candidates: [candidate({ id: "opp-other" })],
        providerLinkedOpportunityId: "opp-missing",
      })
    ).toThrow("Provider-linked opportunity identity was not loaded");
  });

  it("links an existing related sub-client email to the active parent opportunity", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        contactName: "Mary Carter",
        contactEmail: "mary@example.com",
      }),
      candidates: [
        candidate({
          contactEmail: "john@example.com",
          subClientEmails: ["mary@example.com"],
        }),
      ],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-active",
      confidence: "existing_sub_client",
    });
  });

  it("reconciles a fragmented Owen-style thread through an exact CC participant and carries the unlinked accepted project", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        contactName: "Jennifer Vornbrock",
        contactEmail: "jenvee12@example.com",
        participantEmails: [
          "jason@canprodeckandrail.com",
          "owen.schellenberger@example.com",
          "jenvee12@example.com",
        ],
        address: null,
        description: "Owen accepted and paid the 50% deposit.",
      }),
      candidates: [
        candidate({
          id: "62213-jennifer-placeholder",
          clientId: "client-jennifer",
          stage: "new_lead",
          contactEmail: "jenvee12@example.com",
          clientEmails: ["jenvee12@example.com"],
          address: null,
          project: null,
          updatedAt: "2026-07-20T17:00:00.000Z",
        }),
        candidate({
          id: "17d8d8c1-6eba-40f2-8f66-052ee3de198c",
          clientId: "client-owen",
          stage: "new_lead",
          contactEmail: "owen.schellenberger@example.com",
          clientEmails: ["owen.schellenberger@example.com"],
          address: "2745 Fernwood Rd, Victoria BC",
          updatedAt: "2026-07-10T17:00:00.000Z",
          project: {
            id: "1f4a718a-05c0-47b7-8823-7de51e717d97",
            opportunityId: null,
            status: "accepted",
            title: "2745 Fernwood Rd",
            description: null,
            address: "2745 Fernwood Rd, Victoria BC",
            completedAt: null,
            deletedAt: null,
          },
        }),
      ],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "17d8d8c1-6eba-40f2-8f66-052ee3de198c",
      clientId: "client-owen",
      confidence: "exact_participant_email",
      existingProjectId: "1f4a718a-05c0-47b7-8823-7de51e717d97",
    });
  });

  it("fails closed when one external participant matches multiple unlinked committed projects", () => {
    expect(() =>
      decideOpportunityRelationshipMatch({
        facts: facts({
          contactEmail: "forwarder@example.com",
          participantEmails: ["john@example.com"],
        }),
        candidates: [
          candidate({
            id: "opp-newer-project",
            updatedAt: "2026-07-20T17:00:00.000Z",
            project: {
              id: "project-newer",
              opportunityId: null,
              status: "accepted",
              title: "Cedar deck",
              description: null,
              address: "18 Cedar Road, Victoria BC",
              completedAt: null,
              deletedAt: null,
            },
          }),
          candidate({
            id: "opp-older-project",
            updatedAt: "2026-07-10T17:00:00.000Z",
            project: {
              id: "project-older",
              opportunityId: null,
              status: "in_progress",
              title: "Oak railing",
              description: null,
              address: "20 Oak Street, Victoria BC",
              completedAt: null,
              deletedAt: null,
            },
          }),
        ],
      })
    ).toThrow(
      "Multiple unlinked committed projects matched the same external participant; automatic association is blocked"
    );
  });

  it("discovers 2745 Fernwood Road from an incoming Fernwood Rd address before canonical comparison", async () => {
    const fixture = fixtureSupabase({
      opportunity_email_threads: [],
      clients: [],
      sub_clients: [],
      projects: [],
      opportunities: [
        {
          id: "opp-fernwood",
          company_id: "company-1",
          client_id: null,
          stage: "follow_up",
          archived_at: null,
          deleted_at: null,
          contact_email: null,
          contact_phone: null,
          address: "2745 Fernwood Road, Victoria BC",
          title: "Fernwood railing",
          description: "Supply and install railing at Fernwood.",
          source_email_id: null,
          project_id: null,
          project_ref: null,
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-07-02T00:00:00.000Z",
        },
      ],
    });

    const decision = await findOpportunityRelationshipMatch({
      supabase: fixture.supabase as never,
      companyId: "company-1",
      connectionId: null,
      providerThreadId: null,
      clientId: null,
      facts: facts({
        contactEmail: null,
        address: "2745 Fernwood Rd, Victoria BC",
      }),
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-fernwood",
      confidence: "shared_active_address",
    });
  });

  it("discovers the same unit across address designator variants", async () => {
    const fixture = fixtureSupabase({
      opportunity_email_threads: [],
      clients: [],
      sub_clients: [],
      projects: [],
      opportunities: [
        {
          id: "opp-unit-2",
          company_id: "company-1",
          client_id: null,
          stage: "follow_up",
          archived_at: null,
          deleted_at: null,
          contact_email: null,
          contact_phone: null,
          address: "123 Main Street, Suite 2, Victoria BC",
          title: "Unit 2 railing",
          description: null,
          source_email_id: null,
          project_id: null,
          project_ref: null,
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-07-02T00:00:00.000Z",
        },
      ],
    });

    await expect(
      findOpportunityRelationshipMatch({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        connectionId: null,
        providerThreadId: null,
        clientId: null,
        facts: facts({
          contactEmail: null,
          address: "123 Main St Apt. 2",
        }),
      })
    ).resolves.toMatchObject({
      action: "link",
      opportunityId: "opp-unit-2",
      confidence: "shared_active_address",
    });
  });

  it("scans every exact-email opportunity page to find the only active relationship", async () => {
    const opportunities = Array.from({ length: 105 }, (_, index) =>
      opportunityRow(index, index === 104 ? { stage: "follow_up" } : {})
    );
    const fixture = fixtureSupabase({
      opportunity_email_threads: [],
      clients: [],
      sub_clients: [],
      projects: [],
      opportunities,
    });

    await expect(
      findOpportunityRelationshipMatch({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        connectionId: null,
        providerThreadId: null,
        clientId: null,
        facts: facts({ contactEmail: "shared@example.com" }),
      })
    ).resolves.toMatchObject({
      action: "link",
      opportunityId: "opp-104",
      confidence: "exact_contact_email",
    });
    expect(
      fixture.ranges.filter(({ table }) => table === "opportunities")
    ).toEqual([
      { table: "opportunities", from: 0, to: 99 },
      { table: "opportunities", from: 100, to: 199 },
    ]);
  });

  it("loads later exact-email pages so a hidden second active opportunity blocks an ambiguous link", async () => {
    const opportunities = Array.from({ length: 105 }, (_, index) =>
      opportunityRow(
        index,
        index === 0 || index === 104 ? { stage: "follow_up" } : {}
      )
    );
    const fixture = fixtureSupabase({
      opportunity_email_threads: [],
      clients: [],
      sub_clients: [],
      projects: [],
      opportunities,
    });

    await expect(
      findOpportunityRelationshipMatch({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        connectionId: null,
        providerThreadId: null,
        clientId: null,
        facts: facts({ contactEmail: "shared@example.com" }),
      })
    ).rejects.toThrow(
      "Multiple active opportunities matched the exact customer email"
    );
  });

  it("scans every exact-email client page to find an active opportunity behind the first 100 clients", async () => {
    const clients = Array.from({ length: 105 }, (_, index) => ({
      id: `client-${String(index).padStart(3, "0")}`,
      company_id: "company-1",
      email: "family@example.com",
      phone_number: null,
      address: null,
      deleted_at: null,
    }));
    const fixture = fixtureSupabase({
      opportunity_email_threads: [],
      clients,
      sub_clients: [],
      projects: [],
      opportunities: [
        opportunityRow(104, {
          id: "opp-family",
          client_id: "client-104",
          contact_email: null,
          stage: "follow_up",
        }),
      ],
    });

    await expect(
      findOpportunityRelationshipMatch({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        connectionId: null,
        providerThreadId: null,
        clientId: null,
        facts: facts({ contactEmail: "family@example.com" }),
      })
    ).resolves.toMatchObject({
      action: "link",
      opportunityId: "opp-family",
      confidence: "exact_contact_email",
    });
    expect(fixture.ranges.filter(({ table }) => table === "clients")).toEqual([
      { table: "clients", from: 0, to: 99 },
      { table: "clients", from: 100, to: 199 },
    ]);
  });

  it("hydrates every sub-client page before deciding an alternate-contact relationship", async () => {
    const subClients = Array.from({ length: 105 }, (_, index) => ({
      id: `sub-${String(index).padStart(3, "0")}`,
      company_id: "company-1",
      client_id: "client-family",
      email:
        index === 104
          ? "alternate@example.com"
          : `relative-${index}@example.com`,
      phone_number: null,
      address: null,
      deleted_at: null,
    }));
    const fixture = fixtureSupabase({
      opportunity_email_threads: [],
      clients: [
        {
          id: "client-family",
          company_id: "company-1",
          email: "primary@example.com",
          phone_number: null,
          address: null,
          deleted_at: null,
        },
      ],
      sub_clients: subClients,
      projects: [],
      opportunities: [
        opportunityRow(0, {
          id: "opp-family",
          client_id: "client-family",
          contact_email: "primary@example.com",
          stage: "follow_up",
        }),
      ],
    });

    await expect(
      findOpportunityRelationshipMatch({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        connectionId: null,
        providerThreadId: null,
        clientId: "client-family",
        facts: facts({ contactEmail: "alternate@example.com" }),
      })
    ).resolves.toMatchObject({
      action: "link",
      opportunityId: "opp-family",
      confidence: "existing_sub_client",
    });
    expect(
      fixture.ranges.filter(({ table }) => table === "sub_clients")
    ).toEqual([
      // Exact-email discovery returns one filtered row on its first page.
      { table: "sub_clients", from: 0, to: 99 },
      // Candidate hydration must continue through the complete parent roster.
      { table: "sub_clients", from: 0, to: 99 },
      { table: "sub_clients", from: 100, to: 199 },
    ]);
  });

  it("hydrates a historical client_ref-only opportunity through its canonical customer", async () => {
    const fixture = fixtureSupabase({
      opportunity_email_threads: [],
      clients: [
        {
          id: "client-ref-only",
          company_id: "company-1",
          email: "primary@example.com",
          phone_number: null,
          address: null,
          deleted_at: null,
        },
      ],
      sub_clients: [],
      projects: [],
      opportunities: [
        opportunityRow(0, {
          id: "opp-client-ref-only",
          client_id: null,
          client_ref: "client-ref-only",
          contact_email: null,
          stage: "follow_up",
        }),
      ],
    });

    await expect(
      findOpportunityRelationshipMatch({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        connectionId: null,
        providerThreadId: null,
        clientId: "client-ref-only",
        facts: facts({ contactEmail: "primary@example.com" }),
      })
    ).resolves.toMatchObject({
      action: "link",
      opportunityId: "opp-client-ref-only",
      clientId: "client-ref-only",
      confidence: "exact_contact_email",
    });
  });

  it("fails closed when an opportunity's client mirrors disagree", async () => {
    const fixture = fixtureSupabase({
      opportunity_email_threads: [],
      clients: [],
      sub_clients: [],
      projects: [],
      opportunities: [
        opportunityRow(0, {
          id: "opp-mismatched-client",
          client_id: "client-a",
          client_ref: "client-b",
          stage: "follow_up",
        }),
      ],
    });

    await expect(
      findOpportunityRelationshipMatch({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        connectionId: null,
        providerThreadId: null,
        clientId: null,
        facts: facts({ contactEmail: "shared@example.com" }),
      })
    ).rejects.toThrow("Opportunity client mirrors disagree");
  });

  it("scans beyond 100 client projects to find the only canonical address match", async () => {
    const projects = Array.from({ length: 105 }, (_, index) => ({
      id: `project-${String(index).padStart(3, "0")}`,
      company_id: "company-1",
      client_id: "client-owen",
      opportunity_id: null,
      opportunity_ref: null,
      status: "accepted",
      title: `Project ${index}`,
      description: null,
      address:
        index === 104
          ? "2745 Fernwood Road, Victoria BC"
          : `${1000 + index} Other Street, Victoria BC`,
      completed_at: null,
      deleted_at: null,
    }));
    const fixture = fixtureSupabase({ projects });

    await expect(
      findUniqueExistingProjectForEmailConversion({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        opportunityId: "opp-owen",
        clientId: "client-owen",
        opportunityAddress: "2745 Fernwood Rd, Victoria BC",
      })
    ).resolves.toBe("project-104");
    expect(fixture.ranges.filter(({ table }) => table === "projects")).toEqual([
      { table: "projects", from: 0, to: 99 },
      { table: "projects", from: 100, to: 199 },
    ]);
  });

  it("uses client_ref-only identity for existing-project conversion lookup", async () => {
    const fixture = fixtureSupabase({
      projects: [
        {
          id: "project-client-ref-only",
          company_id: "company-1",
          client_id: "client-owen",
          opportunity_id: null,
          opportunity_ref: null,
          status: "accepted",
          title: "2745 Fernwood Rd",
          description: null,
          address: "2745 Fernwood Road, Victoria BC",
          completed_at: null,
          deleted_at: null,
        },
      ],
    });

    await expect(
      findUniqueExistingProjectForEmailConversion({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        opportunityId: "opp-owen",
        clientId: null,
        clientRef: "client-owen",
        opportunityAddress: "2745 Fernwood Rd, Victoria BC",
      })
    ).resolves.toBe("project-client-ref-only");
  });

  it("blocks existing-project conversion lookup when client mirrors disagree", async () => {
    const fixture = fixtureSupabase({ projects: [] });

    await expect(
      findUniqueExistingProjectForEmailConversion({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        opportunityId: "opp-owen",
        clientId: "client-a",
        clientRef: "client-b",
        opportunityAddress: "2745 Fernwood Rd, Victoria BC",
      })
    ).rejects.toThrow("Opportunity client mirrors disagree");
  });

  it("fails closed when multiple unlinked projects match so conversion cannot create another duplicate", async () => {
    const projects = Array.from({ length: 105 }, (_, index) => ({
      id: `project-${String(index).padStart(3, "0")}`,
      company_id: "company-1",
      client_id: "client-owen",
      opportunity_id: null,
      opportunity_ref: null,
      status: "accepted",
      title: `Project ${index}`,
      description: null,
      address: [101, 104].includes(index)
        ? "2745 Fernwood Road, Victoria BC"
        : `${1000 + index} Other Street, Victoria BC`,
      completed_at: null,
      deleted_at: null,
    }));
    const fixture = fixtureSupabase({ projects });

    await expect(
      findUniqueExistingProjectForEmailConversion({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        opportunityId: "opp-owen",
        clientId: "client-owen",
        opportunityAddress: "2745 Fernwood Rd, Victoria BC",
      })
    ).rejects.toThrow("automatic project creation is blocked");
  });

  it("fails closed when the only matching project belongs to another opportunity", async () => {
    const fixture = fixtureSupabase({
      projects: [
        {
          id: "project-linked-other",
          company_id: "company-1",
          client_id: "client-owen",
          opportunity_id: "opp-other",
          opportunity_ref: "opp-other",
          status: "accepted",
          title: "2745 Fernwood Rd",
          description: null,
          address: "2745 Fernwood Road, Victoria BC",
          completed_at: null,
          deleted_at: null,
        },
      ],
    });

    await expect(
      findUniqueExistingProjectForEmailConversion({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        opportunityId: "opp-owen",
        clientId: "client-owen",
        opportunityAddress: "2745 Fernwood Rd, Victoria BC",
      })
    ).rejects.toThrow("linked to another opportunity");
  });

  it("repairs a one-way project link to the same opportunity", async () => {
    const fixture = fixtureSupabase({
      projects: [
        {
          id: "project-linked-same",
          company_id: "company-1",
          client_id: "client-owen",
          opportunity_id: null,
          opportunity_ref: "opp-owen",
          status: "accepted",
          title: "2745 Fernwood Rd",
          description: null,
          address: "2745 Fernwood Road, Victoria BC",
          completed_at: null,
          deleted_at: null,
        },
      ],
    });

    await expect(
      findUniqueExistingProjectForEmailConversion({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        opportunityId: "opp-owen",
        clientId: "client-owen",
        opportunityAddress: "2745 Fernwood Rd, Victoria BC",
      })
    ).resolves.toBe("project-linked-same");
  });

  it("does not guess among active same-client projects when the opportunity address is absent", async () => {
    const fixture = fixtureSupabase({
      projects: [
        {
          id: "project-without-address-proof",
          company_id: "company-1",
          client_id: "client-owen",
          opportunity_id: null,
          opportunity_ref: null,
          status: "accepted",
          title: "Another active job",
          description: null,
          address: "90 Other Rd, Victoria BC",
          completed_at: null,
          deleted_at: null,
        },
      ],
    });

    await expect(
      findUniqueExistingProjectForEmailConversion({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        opportunityId: "opp-owen",
        clientId: "client-owen",
        opportunityAddress: null,
      })
    ).rejects.toThrow("address proof is unavailable");
  });

  it("allows creation without an address only after proving the client has no active project", async () => {
    const fixture = fixtureSupabase({ projects: [] });

    await expect(
      findUniqueExistingProjectForEmailConversion({
        supabase: fixture.supabase as never,
        companyId: "company-1",
        opportunityId: "opp-owen",
        clientId: "client-owen",
        opportunityAddress: null,
      })
    ).resolves.toBeNull();
  });

  it("uses a strict forwarded participant only when exact address evidence corroborates the relationship", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        contactName: "Jackson",
        contactEmail: "jackson@canprodeckandrail.com",
        participantEmails: ["jackson@canprodeckandrail.com"],
        forwardedParticipantEmails: ["owen.schellenberger@example.com"],
        address: "2745 Fernwood Rd, Victoria BC",
      }),
      candidates: [
        candidate({
          id: "opp-owen",
          clientId: "client-owen",
          contactEmail: "owen.schellenberger@example.com",
          clientEmails: ["owen.schellenberger@example.com"],
          address: "2745 Fernwood Rd, Victoria BC",
        }),
      ],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-owen",
      confidence: "forwarded_participant_with_address",
    });
  });

  it("does not link from an uncorroborated forwarded address embedded in untrusted content", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        contactEmail: "unrelated@example.com",
        participantEmails: ["unrelated@example.com"],
        forwardedParticipantEmails: ["owen.schellenberger@example.com"],
        address: null,
        description: "Forwarded for awareness.",
        subject: "Fwd: estimate",
      }),
      candidates: [
        candidate({
          id: "opp-owen",
          contactEmail: "owen.schellenberger@example.com",
          clientEmails: ["owen.schellenberger@example.com"],
          address: "2745 Fernwood Rd, Victoria BC",
          contactPhone: null,
          clientPhones: [],
          clientAddresses: [],
        }),
      ],
    });

    expect(decision).toMatchObject({ action: "create_new" });
  });

  it("links a different email at the same address only when the opportunity is active", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        contactName: "Mary Carter",
        contactEmail: "mary.new@example.com",
        address: "18 Cedar Road, Victoria BC",
      }),
      candidates: [
        candidate({
          contactEmail: "john@example.com",
          subClientEmails: [],
        }),
      ],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-active",
      confidence: "shared_active_address",
    });
  });

  it("creates a separate opportunity when the prior same-address project is closed and scope is distinct", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        contactName: "John Carter",
        contactEmail: "john@example.com",
        address: "18 Cedar Road, Victoria BC",
        description: "Need pricing for a new detached garage soffit job.",
      }),
      candidates: [
        candidate({
          id: "opp-closed",
          stage: "won",
          project: {
            id: "project-closed",
            status: "closed",
            title: "Back deck rebuild",
            description: "Replace the existing back deck and railing.",
            address: "18 Cedar Road, Victoria BC",
            completedAt: "2026-05-01T00:00:00.000Z",
            deletedAt: null,
          },
        }),
      ],
    });

    expect(decision).toMatchObject({
      action: "create_new",
      suggestedOpportunityId: "opp-closed",
      reason: expect.stringContaining("closed"),
    });
  });

  it("does not over-link a Mary and John style case without a deterministic relationship signal", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        contactName: "Mary Carter",
        contactEmail: "mary@example.com",
        contactPhone: null,
        address: null,
        description: "Can you call me about a quote?",
      }),
      candidates: [
        candidate({
          contactEmail: "john@example.com",
          contactPhone: null,
          clientPhones: [],
          clientAddresses: [],
        }),
      ],
    });

    expect(decision).toMatchObject({
      action: "create_new",
      reason: expect.stringContaining("No deterministic"),
    });
  });

  it("uses parsed customer identity for platform form senders, not the platform mailbox", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        contactName: "Marcel Mercier",
        contactEmail: "marcel.mercier@example.com",
        sourcePlatform: "Wix Forms",
      }),
      candidates: [
        candidate({
          id: "opp-marcel",
          contactEmail: "marcel.mercier@example.com",
          clientEmails: ["marcel.mercier@example.com"],
        }),
      ],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-marcel",
      confidence: "exact_contact_email",
    });
  });

  it("works with Phase C off when deterministic relationship evidence is present", () => {
    const decision = decideOpportunityRelationshipMatch({
      facts: facts({
        phaseCEnabled: false,
        contactEmail: "mary.new@example.com",
        contactPhone: "2505550100",
      }),
      candidates: [candidate()],
    });

    expect(decision).toMatchObject({
      action: "link",
      opportunityId: "opp-active",
      confidence: "exact_phone",
    });
  });
});
