/* ── scripts/backfill-strip-draft-fences.ts ── */
/*
 * One-off cleanup for `ai_draft_history` rows whose `original_draft` (or
 * `final_version`) was generated while the system prompt asked the model
 * to "write in markdown format". The model interpreted that as "wrap the
 * entire body in a ```markdown ... ``` code fence", and the wrapped text
 * landed in the database, the composer, and outbound email.
 *
 * The fix at `src/lib/api/services/ai-draft-service.ts` (1) updates the
 * prompt rule to explicitly forbid code fences and (2) calls
 * `stripMarkdownFences()` on the LLM output at the boundary. This script
 * cleans up the rows that were written before that fix.
 *
 * Idempotent: rows without leading/trailing fences pass through unchanged.
 * Safe to run multiple times.
 *
 * Dry-run by default. Pass --apply to write. Pass --company-id <uuid> to
 * scope to a single tenant; omit it to run across all tenants (operator
 * use only — relies on service-role key).
 *
 *   npx tsx scripts/backfill-strip-draft-fences.ts
 *   npx tsx scripts/backfill-strip-draft-fences.ts --apply
 *   npx tsx scripts/backfill-strip-draft-fences.ts --company-id <uuid> --apply
 */

import { createClient } from "@supabase/supabase-js";
import { stripMarkdownFences } from "../src/lib/api/services/ai-draft-service";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const companyIdArgIdx = process.argv.indexOf("--company-id");
const COMPANY_ID =
  companyIdArgIdx >= 0 ? process.argv[companyIdArgIdx + 1] : null;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log(
    `[backfill-strip-draft-fences] mode=${APPLY ? "APPLY" : "DRY-RUN"}` +
      (COMPANY_ID ? ` company_id=${COMPANY_ID}` : " (all tenants)"),
  );

  // Fetch only rows that look fenced. Postgres `like` is case-sensitive,
  // which is what we want — fences are always exactly three backticks.
  // We use OR across the two columns; rows touching either get pulled.
  let query = supabase
    .from("ai_draft_history")
    .select("id, company_id, original_draft, final_version")
    .or("original_draft.like.```%,final_version.like.```%");

  if (COMPANY_ID) {
    query = query.eq("company_id", COMPANY_ID);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error("[backfill-strip-draft-fences] query failed:", error);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log("[backfill-strip-draft-fences] no fenced rows found — nothing to do.");
    return;
  }

  console.log(`[backfill-strip-draft-fences] candidate rows: ${rows.length}`);

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of rows) {
    const id = row.id as string;
    const orig = (row.original_draft as string | null) ?? null;
    const final = (row.final_version as string | null) ?? null;

    const cleanedOrig = orig ? stripMarkdownFences(orig) : null;
    const cleanedFinal = final ? stripMarkdownFences(final) : null;

    const origChanged = cleanedOrig !== null && cleanedOrig !== orig;
    const finalChanged = cleanedFinal !== null && cleanedFinal !== final;

    if (!origChanged && !finalChanged) {
      // Matched the `like '```%'` filter (e.g. starts with backticks) but
      // the strip decided no change was warranted — e.g. fence not at end.
      unchanged++;
      continue;
    }

    const update: Record<string, unknown> = {};
    if (origChanged) update.original_draft = cleanedOrig;
    if (finalChanged) update.final_version = cleanedFinal;

    if (!APPLY) {
      console.log(
        `[dry-run] would update row id=${id}` +
          (origChanged ? " original_draft" : "") +
          (finalChanged ? " final_version" : ""),
      );
      updated++;
      continue;
    }

    const { error: updateErr } = await supabase
      .from("ai_draft_history")
      .update(update)
      .eq("id", id);

    if (updateErr) {
      console.error(`[backfill-strip-draft-fences] update failed for id=${id}:`, updateErr);
      failed++;
      continue;
    }

    console.log(
      `[apply] updated row id=${id}` +
        (origChanged ? " original_draft" : "") +
        (finalChanged ? " final_version" : ""),
    );
    updated++;
  }

  console.log(
    `[backfill-strip-draft-fences] done. updated=${updated} unchanged=${unchanged} failed=${failed}`,
  );
}

main().catch((err) => {
  console.error("[backfill-strip-draft-fences] fatal:", err);
  process.exit(1);
});
