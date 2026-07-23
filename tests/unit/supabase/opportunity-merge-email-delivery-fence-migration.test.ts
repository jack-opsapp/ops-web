import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const migrationFile =
  "20260723040000_opportunity_merge_email_delivery_fence.sql";
const source = readFileSync(join(migrationsDir, migrationFile), "utf8");

const signature =
  "uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text";

describe("opportunity merge email delivery fence migration", () => {
  it("is an additive wrapper rather than a rewrite of applied migration history", () => {
    expect(source).toContain(
      "alter function public.execute_opportunity_merge_guarded("
    );
    expect(source).toContain(
      ") rename to execute_opportunity_merge_guarded_delivery_fenced_inner;"
    );
    expect(source).toContain(
      "create or replace function public.execute_opportunity_merge_guarded("
    );
    expect(source).toContain(
      "public.execute_opportunity_merge_guarded_delivery_fenced_inner("
    );
  });

  it("uses the canonical company then ordered-opportunity lock order", () => {
    const companyLock = source.indexOf(
      "perform private.lock_lead_assignment_company(p_company_id)"
    );
    const opportunityLock = source.indexOf(
      "from public.opportunities opportunity"
    );
    const intentLock = source.indexOf("from public.email_send_intents intent");
    const canonicalCall = source.lastIndexOf(
      "return public.execute_opportunity_merge_guarded_delivery_fenced_inner("
    );

    expect(companyLock).toBeGreaterThanOrEqual(0);
    expect(opportunityLock).toBeGreaterThan(companyLock);
    expect(source.slice(opportunityLock, intentLock)).toContain("order by opportunity.id");
    expect(source.slice(opportunityLock, intentLock)).toContain("for update");
    expect(intentLock).toBeGreaterThan(opportunityLock);
    expect(canonicalCall).toBeGreaterThan(intentLock);
  });

  it("blocks only delivery-risk intent states before the merge graph can move", () => {
    const intentLock = source.indexOf("from public.email_send_intents intent");
    const canonicalCall = source.lastIndexOf(
      "return public.execute_opportunity_merge_guarded_delivery_fenced_inner("
    );
    const fence = source.slice(intentLock, canonicalCall);

    expect(fence).toContain("intent.company_id = p_company_id");
    expect(fence).toContain(
      "intent.opportunity_id in (p_winner_id, p_loser_id)"
    );
    for (const status of [
      "sending",
      "delivery_unknown",
      "provider_accepted",
      "reconciling",
      "reconciliation_failed",
    ]) {
      expect(fence).toContain(`'${status}'`);
    }
    expect(fence).not.toContain("'prepared'");
    expect(fence).not.toContain("'provider_rejected'");
    expect(fence).not.toContain("'reconciled'");
    expect(fence).toContain("order by intent.id");
    expect(fence).toContain("for share");
    expect(fence).toContain("email_delivery_in_flight");
  });

  it("keeps both the renamed implementation and public entry point service-only", () => {
    expect(source).toContain("auth.role() is distinct from 'service_role'");
    expect(source).toContain(
      `revoke all on function public.execute_opportunity_merge_guarded_delivery_fenced_inner(\n  ${signature}\n) from public, anon, authenticated, service_role;`
    );
    expect(source).toContain(
      `revoke all on function public.execute_opportunity_merge_guarded(\n  ${signature}\n) from public, anon, authenticated, service_role;`
    );
    expect(source).toContain(
      `grant execute on function public.execute_opportunity_merge_guarded(\n  ${signature}\n) to service_role;`
    );
  });

  it("fails closed when its hardened prerequisites are missing", () => {
    expect(source).toContain(
      "opportunity_merge_email_delivery_fence_prerequisites_missing"
    );
    expect(source).toContain("to_regclass('public.email_send_intents')");
    expect(source).toContain(
      "to_regprocedure('private.lock_lead_assignment_company(uuid)')"
    );
  });

  it("commits one complete function replacement transaction", () => {
    expect(source).toContain("\nbegin;\n");
    expect(source).toContain("$function$;\n\nrevoke all on function");
    expect(source.trimEnd().endsWith("commit;")).toBe(true);
  });
});
