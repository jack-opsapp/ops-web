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
