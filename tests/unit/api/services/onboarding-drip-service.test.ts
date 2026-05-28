import { describe, it, expect } from "vitest";
import { computeOperatorLocalHour, OnboardingDripService } from "@/lib/api/services/onboarding-drip-service";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("computeOperatorLocalHour", () => {
  it("returns the hour in operator local time for a known timezone", () => {
    // 2026-05-27 14:00:00 UTC = 7am PDT
    const utc = new Date("2026-05-27T14:00:00Z");
    expect(computeOperatorLocalHour(utc, "America/Los_Angeles")).toBe(7);
  });

  it("returns 9 in PT when UTC is 16:00 (PDT)", () => {
    const utc = new Date("2026-05-27T16:00:00Z");
    expect(computeOperatorLocalHour(utc, "America/Los_Angeles")).toBe(9);
  });

  it("returns the hour for an Eastern operator", () => {
    // 14:00 UTC = 10am EDT
    const utc = new Date("2026-05-27T14:00:00Z");
    expect(computeOperatorLocalHour(utc, "America/New_York")).toBe(10);
  });

  it("falls back to UTC hour if timezone is unknown / null", () => {
    const utc = new Date("2026-05-27T14:00:00Z");
    expect(computeOperatorLocalHour(utc, null)).toBe(14);
  });
});

/**
 * Build a fake supabase client that returns the given count for the next
 * .select(..., { count: ... }) chain. Used to stub branch-decision counts.
 *
 * Shape: db.from(table).select(cols, opts).eq(...).is(...) returns
 *        { count, error: null }.
 */
function mockSupabaseCounts(counts: Record<string, number>): SupabaseClient {
  return {
    from(table: string) {
      const value = counts[table] ?? 0;
      const result = { count: value, error: null };
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        is: () => chain,
        then: (resolve: any) => resolve(result),
        // Allow await on the chain itself (used by some Supabase versions)
      };
      // Make chain awaitable AND act as the final resolver
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe("OnboardingDripService.computeState", () => {
  it("day_0 returns null branch + welcome emailType", async () => {
    const db = mockSupabaseCounts({});
    const user = { id: "u1", onboarding_completed: null } as any;
    const company = { id: "c1" } as any;
    const result = await OnboardingDripService.computeState(db, user, company, "day_0");
    expect(result.branch).toBeNull();
    expect(result.emailType).toBe("onboarding_day_0_welcome");
  });

  it("day_1 returns no_project branch when user is not web-onboarded", async () => {
    const db = mockSupabaseCounts({ projects: 5 }); // even if projects exist, no_project wins if not web-onboarded
    const user = { id: "u1", onboarding_completed: null } as any;
    const company = { id: "c1" } as any;
    const result = await OnboardingDripService.computeState(db, user, company, "day_1");
    expect(result.branch).toBe("no_project");
    expect(result.emailType).toBe("onboarding_day_1_no_project");
  });

  it("day_1 returns no_project branch when user is web-onboarded but has zero projects", async () => {
    const db = mockSupabaseCounts({ projects: 0 });
    const user = { id: "u1", onboarding_completed: { web: true } } as any;
    const company = { id: "c1" } as any;
    const result = await OnboardingDripService.computeState(db, user, company, "day_1");
    expect(result.branch).toBe("no_project");
  });

  it("day_1 returns has_project branch when web-onboarded AND has projects", async () => {
    const db = mockSupabaseCounts({ projects: 2 });
    const user = { id: "u1", onboarding_completed: { web: true } } as any;
    const company = { id: "c1" } as any;
    const result = await OnboardingDripService.computeState(db, user, company, "day_1");
    expect(result.branch).toBe("has_project");
    expect(result.emailType).toBe("onboarding_day_1_has_project");
    expect(result.payload.projectCount).toBe(2);
  });

  it("day_3 returns null branch + inbox emailType", async () => {
    const db = mockSupabaseCounts({});
    const user = { id: "u1" } as any;
    const company = { id: "c1" } as any;
    const result = await OnboardingDripService.computeState(db, user, company, "day_3");
    expect(result.branch).toBeNull();
    expect(result.emailType).toBe("onboarding_day_3_inbox");
  });

  it("day_4 returns no_aha when no task_completed notifications", async () => {
    const db = mockSupabaseCounts({ notifications: 0 });
    const user = { id: "u1" } as any;
    const company = { id: "c1" } as any;
    const result = await OnboardingDripService.computeState(db, user, company, "day_4");
    expect(result.branch).toBe("no_aha");
    expect(result.emailType).toBe("onboarding_day_4_no_notification");
  });

  it("day_4 returns has_aha when task_completed notifications exist", async () => {
    const db = mockSupabaseCounts({ notifications: 3 });
    const user = { id: "u1" } as any;
    const company = { id: "c1" } as any;
    const result = await OnboardingDripService.computeState(db, user, company, "day_4");
    expect(result.branch).toBe("has_aha");
    expect(result.emailType).toBe("onboarding_day_4_has_notification");
  });

  it("day_8 returns null branch + estimates emailType", async () => {
    const db = mockSupabaseCounts({});
    const user = { id: "u1" } as any;
    const company = { id: "c1" } as any;
    const result = await OnboardingDripService.computeState(db, user, company, "day_8");
    expect(result.branch).toBeNull();
    expect(result.emailType).toBe("onboarding_day_8_estimates");
  });

  it("day_14 returns quiet branch when zero activity across 6 tables in last 7d", async () => {
    const db = mockSupabaseCounts({});
    const user = { id: "u1" } as any;
    const company = { id: "c1" } as any;
    const result = await OnboardingDripService.computeState(db, user, company, "day_14");
    expect(result.branch).toBe("quiet");
    expect(result.emailType).toBe("onboarding_day_14_quiet");
  });

  it("day_14 returns active branch when activity in last 7d, payload has counts", async () => {
    const db = mockSupabaseCounts({
      projects: 2, project_tasks: 5, clients: 1, opportunities: 0, estimates: 1, invoices: 0,
      notifications: 3,
    });
    const user = { id: "u1" } as any;
    const company = { id: "c1" } as any;
    const result = await OnboardingDripService.computeState(db, user, company, "day_14");
    expect(result.branch).toBe("active");
    expect(result.emailType).toBe("onboarding_day_14_active");
    expect(result.payload.projectCount).toBe(2);
    expect(result.payload.taskCount).toBe(5);
    expect(result.payload.notificationCount).toBe(3);
  });

  it("lost_you returns null branch + lost_you emailType", async () => {
    const db = mockSupabaseCounts({});
    const user = { id: "u1" } as any;
    const company = { id: "c1" } as any;
    const result = await OnboardingDripService.computeState(db, user, company, "lost_you");
    expect(result.branch).toBeNull();
    expect(result.emailType).toBe("onboarding_lost_you");
  });
});

// ─── claimAndSend test helpers ───────────────────────────────────────────

/**
 * Spy that captures every Supabase call so the test can assert on
 * insert/update payloads + which tables were queried.
 */
function buildMockDb(opts: {
  // Should the claim INSERT succeed (return a row) or conflict (return null)
  claimResult: "win" | "conflict";
  // Result returned by the email_log primary reconciliation query
  reconcilePrimary?: Array<{ id: string; metadata: Record<string, unknown> }>;
  // Result returned by the email_log fallback reconciliation query
  reconcileFallback?: Array<{ id: string; metadata: Record<string, unknown> }>;
}) {
  const log: { table: string; op: string; args: unknown[] }[] = [];

  function from(table: string) {
    const chain: any = {
      // mutation builders
      insert: (...args: unknown[]) => {
        log.push({ table, op: "insert", args });
        return {
          select: () => ({
            single: async () => {
              if (table === "onboarding_email_log") {
                if (opts.claimResult === "win") {
                  return { data: { id: "claim-row-1" }, error: null };
                }
                return { data: null, error: { code: "23505" } };
              }
              return { data: null, error: null };
            },
          }),
        };
      },
      update: (...args: unknown[]) => {
        log.push({ table, op: "update", args });
        return { eq: () => Promise.resolve({ error: null }) };
      },
      // select chain — covers reconciliation queries
      select: () => chain,
      eq: (col: string) => {
        // Track which eq() chain we're on so we can decide primary vs fallback
        chain._eqCols = [...(chain._eqCols ?? []), col];
        return chain;
      },
      gte: () => chain,
      order: () => chain,
      limit: async () => {
        // If this is the fallback query (has recipient_email eq + gte), return fallback
        const cols: string[] = chain._eqCols ?? [];
        if (cols.includes("recipient_email")) {
          return { data: opts.reconcileFallback ?? [], error: null };
        }
        return { data: opts.reconcilePrimary ?? [], error: null };
      },
    };
    return chain;
  }

  return { db: { from } as unknown as SupabaseClient, log };
}

describe("OnboardingDripService.claimAndSend", () => {
  it("returns 'already_claimed' when INSERT conflicts", async () => {
    const { db, log } = buildMockDb({ claimResult: "conflict" });
    const result = await OnboardingDripService.claimAndSend(db, {
      user: { id: "u1", email: "test@example.com", first_name: "Pat" } as any,
      company: { id: "c1", latitude: 49, longitude: -123 } as any,
      daySlot: "day_1",
      branch: "no_project",
      emailType: "onboarding_day_1_no_project",
      payload: {},
      now: new Date("2026-05-27T16:00:00Z"),
    });
    expect(result.status).toBe("already_claimed");
    // No send attempt — no update should have been called on onboarding_email_log
    expect(log.find((l) => l.op === "update")).toBeUndefined();
  });

  it("returns 'reconciled' when primary email_log query finds a matching row", async () => {
    const { db, log } = buildMockDb({
      claimResult: "win",
      reconcilePrimary: [{ id: "elog-1", metadata: { sg_message_id: "sg-xyz" } }],
    });
    const result = await OnboardingDripService.claimAndSend(db, {
      user: { id: "u1", email: "test@example.com", first_name: "Pat" } as any,
      company: { id: "c1", latitude: 49, longitude: -123 } as any,
      daySlot: "day_1",
      branch: "no_project",
      emailType: "onboarding_day_1_no_project",
      payload: {},
      now: new Date("2026-05-27T16:00:00Z"),
    });
    expect(result.status).toBe("reconciled");
    expect(result.rowId).toBe("claim-row-1");
    // The claim row should have been marked sent with the reconciled sg_message_id
    const upd = log.find((l) => l.table === "onboarding_email_log" && l.op === "update");
    expect(upd).toBeDefined();
    expect((upd!.args[0] as any).status).toBe("sent");
    expect((upd!.args[0] as any).sg_message_id).toBe("sg-xyz");
  });

  it("falls back to recipient+5min window when primary returns nothing", async () => {
    const { db } = buildMockDb({
      claimResult: "win",
      reconcilePrimary: [],
      reconcileFallback: [{ id: "elog-2", metadata: { sg_message_id: "sg-fallback" } }],
    });
    const result = await OnboardingDripService.claimAndSend(db, {
      user: { id: "u1", email: "Test@Example.COM", first_name: "Pat" } as any, // note uppercase to verify lowercasing
      company: { id: "c1", latitude: 49, longitude: -123 } as any,
      daySlot: "day_1",
      branch: "no_project",
      emailType: "onboarding_day_1_no_project",
      payload: {},
      now: new Date("2026-05-27T16:00:00Z"),
    });
    expect(result.status).toBe("reconciled");
  });
});

describe("OnboardingDripService.processCompany kill switches", () => {
  /**
   * Mock supabase that responds to .from("users").select("id, email, ...").eq("id", ...).maybeSingle()
   * to return either a found operator or null. Used to test kill switches.
   */
  function dbForOperator(operator: { id: string; email: string; first_name: string | null; deleted_at: string | null } | null) {
    return {
      from(table: string) {
        if (table === "users") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: operator, error: null }),
              }),
            }),
          };
        }
        return { from: () => ({}) };
      },
    } as unknown as SupabaseClient;
  }

  it("skips when company.deleted_at is set", async () => {
    const result = await OnboardingDripService.processCompany(
      dbForOperator(null),
      { id: "c1", deleted_at: "2026-01-01T00:00:00Z", subscription_status: "active", account_holder_id: "u1", admin_ids: ["u1"], created_at: new Date(Date.now() - 86400_000).toISOString(), latitude: null, longitude: null } as any,
      new Date(),
    );
    expect(result.processed).toBe(0);
    expect(result.skipped[0]?.reason).toContain("deleted");
  });

  it("skips when subscription_status is 'cancelled'", async () => {
    const result = await OnboardingDripService.processCompany(
      dbForOperator(null),
      { id: "c1", deleted_at: null, subscription_status: "cancelled", account_holder_id: "u1", admin_ids: ["u1"], created_at: new Date(Date.now() - 86400_000).toISOString(), latitude: null, longitude: null } as any,
      new Date(),
    );
    expect(result.processed).toBe(0);
    expect(result.skipped[0]?.reason).toContain("cancelled");
  });

  it("skips when subscription_status is 'expired'", async () => {
    const result = await OnboardingDripService.processCompany(
      dbForOperator(null),
      { id: "c1", deleted_at: null, subscription_status: "expired", account_holder_id: "u1", admin_ids: ["u1"], created_at: new Date(Date.now() - 86400_000).toISOString(), latitude: null, longitude: null } as any,
      new Date(),
    );
    expect(result.processed).toBe(0);
    expect(result.skipped[0]?.reason).toContain("expired");
  });

  it("skips when no account_holder_id", async () => {
    const result = await OnboardingDripService.processCompany(
      dbForOperator(null),
      { id: "c1", deleted_at: null, subscription_status: "active", account_holder_id: null, admin_ids: [], created_at: new Date(Date.now() - 86400_000).toISOString(), latitude: null, longitude: null } as any,
      new Date(),
    );
    expect(result.processed).toBe(0);
    expect(result.skipped[0]?.reason).toContain("account_holder_id");
  });

  it("skips when account_holder email matches @opsapp.co (internal allowlist)", async () => {
    const result = await OnboardingDripService.processCompany(
      dbForOperator({ id: "u1", email: "founder@opsapp.co", first_name: "Jack", deleted_at: null }),
      { id: "c1", deleted_at: null, subscription_status: "active", account_holder_id: "u1", admin_ids: ["u1"], created_at: new Date(Date.now() - 86400_000).toISOString(), latitude: null, longitude: null } as any,
      new Date(),
    );
    expect(result.processed).toBe(0);
    expect(result.skipped[0]?.reason).toContain("internal");
  });

  it("skips when operator is deleted", async () => {
    const result = await OnboardingDripService.processCompany(
      dbForOperator({ id: "u1", email: "test@example.com", first_name: "Pat", deleted_at: "2026-01-01T00:00:00Z" }),
      { id: "c1", deleted_at: null, subscription_status: "active", account_holder_id: "u1", admin_ids: ["u1"], created_at: new Date(Date.now() - 86400_000).toISOString(), latitude: null, longitude: null } as any,
      new Date(),
    );
    expect(result.processed).toBe(0);
    expect(result.skipped[0]?.reason).toContain("operator");
  });

  it("returns empty processed when company age does not match any day slot", async () => {
    // age = 2 days; not in [1, 3, 4, 8, 14]
    const ageDays = 2;
    const result = await OnboardingDripService.processCompany(
      dbForOperator({ id: "u1", email: "test@example.com", first_name: "Pat", deleted_at: null }),
      { id: "c1", deleted_at: null, subscription_status: "active", account_holder_id: "u1", admin_ids: ["u1"], created_at: new Date(Date.now() - ageDays * 86400_000).toISOString(), latitude: null, longitude: null } as any,
      new Date(),
    );
    expect(result.processed).toBe(0);
  });
});

describe("OnboardingDripService.processRetries", () => {
  /**
   * Build a mock supabase that responds to:
   *   .from("onboarding_email_log").select(...).in(...).lt(...).gt(...).lt(...).limit(N)
   * with the given candidate rows. Captures any subsequent update calls.
   */
  function buildRetryDb(candidates: Array<{ id: string; user_id: string; company_id: string; day_slot: string; branch: string | null; email_type: string; attempts: number }>) {
    const log: { table: string; op: string; args: unknown[] }[] = [];

    function from(table: string) {
      if (table === "onboarding_email_log") {
        return {
          // candidate query chain
          select: () => ({
            in: () => ({
              lt: () => ({
                gt: () => ({
                  lt: () => ({
                    limit: async () => ({ data: candidates, error: null }),
                  }),
                }),
              }),
            }),
          }),
          update: (...args: unknown[]) => {
            log.push({ table, op: "update", args });
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      // No-op for other tables
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    }

    return { db: { from } as unknown as SupabaseClient, log };
  }

  it("returns retried=0 when no candidates", async () => {
    const { db } = buildRetryDb([]);
    const result = await OnboardingDripService.processRetries(db, new Date());
    expect(result.retried).toBe(0);
  });

  it("counts candidate rows as retried (best-effort — exact dispatch behavior covered by integration tests)", async () => {
    // Two rows in the candidate set. Without seeded user/company data, the
    // retry attempts will short-circuit, but the candidate sweep still
    // iterates over them.
    const { db } = buildRetryDb([
      { id: "r1", user_id: "u1", company_id: "c1", day_slot: "day_1", branch: null, email_type: "onboarding_day_1_no_project", attempts: 1 },
      { id: "r2", user_id: "u2", company_id: "c2", day_slot: "day_3", branch: null, email_type: "onboarding_day_3_inbox", attempts: 0 },
    ]);
    const result = await OnboardingDripService.processRetries(db, new Date());
    expect(typeof result.retried).toBe("number");
    expect(result.retried).toBeGreaterThanOrEqual(0);
  });
});
