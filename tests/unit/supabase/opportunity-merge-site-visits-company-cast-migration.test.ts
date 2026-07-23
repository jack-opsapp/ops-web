import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const migrationFile =
  "20260722213000_fix_opportunity_merge_site_visits_company_cast.sql";

const source = readFileSync(join(migrationsDir, migrationFile), "utf8");

// The site_visits re-point, casted so the uuid parameter matches prod's legacy
// TEXT `site_visits.company_id` column.
const castedSiteVisits = `update public.site_visits set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id::text;`;

// The uncasted uuid-vs-text comparison that raised 42883 and aborted the merge.
const uncastedSiteVisits = `update public.site_visits set opportunity_id = p_winner_id
   where opportunity_id = p_loser_id and company_id = p_company_id;`;

describe("opportunity-merge site_visits company_id text-cast migration", () => {
  it("re-defines the guarded opportunity-merge function", () => {
    expect(source).toContain(
      "CREATE OR REPLACE FUNCTION public.execute_opportunity_merge_guarded_internal("
    );
  });

  it("casts the site_visits company scope to text for the legacy column", () => {
    expect(source).toContain(castedSiteVisits);
  });

  it("leaves no uncasted site_visits company comparison", () => {
    // The uncasted uuid = text comparison is exactly what raised 42883.
    expect(source).not.toContain(uncastedSiteVisits);
    // And there is only one site_visits re-point, so no second statement can
    // smuggle an uncasted comparison back in.
    const siteVisitsUpdates = source.match(/update public\.site_visits\b/g) ?? [];
    expect(siteVisitsUpdates).toHaveLength(1);
  });

  it("refuses a merge while either opportunity has delivery-risk email", () => {
    const companyLock = source.indexOf(
      "perform private.lock_lead_assignment_company(p_company_id)"
    );
    const opportunityLock = source.indexOf("from public.opportunities");
    const intentProof = source.indexOf("from public.email_send_intents intent");
    const firstChildMutation = source.indexOf("update public.activities");

    expect(companyLock).toBeGreaterThanOrEqual(0);
    expect(opportunityLock).toBeGreaterThan(companyLock);
    expect(intentProof).toBeGreaterThan(opportunityLock);
    expect(firstChildMutation).toBeGreaterThan(intentProof);

    const fence = source.slice(intentProof, firstChildMutation);
    expect(fence).toContain("intent.company_id = p_company_id");
    expect(fence).toContain(
      "intent.opportunity_id in (p_winner_id, p_loser_id)"
    );
    expect(fence).toContain(
      "intent.status in ( 'sending', 'delivery_unknown', 'provider_accepted', 'reconciling', 'reconciliation_failed' )"
    );
    expect(fence).toContain("order by intent.id");
    expect(fence).toContain("for share");
    expect(fence).toContain("email_delivery_in_flight");
    expect(fence).not.toContain("'prepared'");
    expect(fence).not.toContain("'provider_rejected'");
    expect(fence).not.toContain("'reconciled'");
  });

  it("wraps the redefinition in a single begin/commit like its siblings", () => {
    expect(source).toContain("\nbegin;\n");
    expect(source.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("terminates the function definition before the transaction commit", () => {
    // pg_get_functiondef output ends bare (no `;`). Without a terminator the
    // parser reads the following `commit` as a continuation of the CREATE
    // statement -> syntax error at or near "commit". The dollar-quote close
    // must carry the `;`, exactly as sibling migrations terminate theirs.
    expect(source).toContain("$function$;\n\ncommit;");
  });
});
