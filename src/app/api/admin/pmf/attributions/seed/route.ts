/**
 * OPS Admin — PMF Trial Attribution Seed API
 *
 * POST /api/admin/pmf/attributions/seed
 *
 * Backfill / seed a `trial_attributions` row for an existing company.
 * Body: { company_id, first_touch?, trial_started_at? }
 *   - company_id            uuid, required
 *   - first_touch           optional UTM/click-id payload (utm_source,
 *                           utm_medium, utm_campaign, utm_content,
 *                           utm_term, gclid, fbclid, landing_url)
 *   - trial_started_at      ISO timestamp; defaults to now() when absent
 *
 * Note: `referrer` is intentionally NOT accepted on the body. The
 * trial_attributions table has no referrer column, so accepting the field
 * caused silent data loss. If we later want referrer to influence
 * attributed_channel, we'll add a column + bring the field back together.
 *
 * Behaviour:
 *   - 401 / 403 via the shared admin-auth helpers
 *   - 400 on schema-invalid bodies
 *   - 404 when the company does not exist
 *   - 409 on Postgres unique-violation (each company can have only one row)
 *   - 200 + { company_id, attributed_channel } on success
 *
 * The attributed_channel is derived from the first_touch payload via
 * deriveAttributionChannel — keeps the dashboard's channel logic in one place.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { deriveAttributionChannel } from "@/lib/pmf/attribution";

// ─── Body schema ─────────────────────────────────────────────────────────────

const FirstTouchSchema = z
  .object({
    utm_source: z.string().max(200).optional(),
    utm_medium: z.string().max(200).optional(),
    utm_campaign: z.string().max(200).optional(),
    utm_content: z.string().max(200).optional(),
    utm_term: z.string().max(200).optional(),
    gclid: z.string().max(500).optional(),
    fbclid: z.string().max(500).optional(),
    landing_url: z.string().url().optional(),
  })
  .strict();

const SeedBodySchema = z.object({
  company_id: z.string().uuid(),
  first_touch: FirstTouchSchema.optional(),
  trial_started_at: z.string().datetime().optional(),
});

// ─── POST ────────────────────────────────────────────────────────────────────

export const POST = withAdmin(async (req) => {
  await requireAdmin(req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SeedBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { company_id, first_touch, trial_started_at } = parsed.data;
  const touch = first_touch ?? {};
  const db = getAdminSupabase();

  // Verify the company exists. trial_attributions has a FK to companies, but
  // catching the missing-company case here gives a better error than a
  // generic 23503 from Postgres.
  const { data: company, error: companyError } = await db
    .from("companies")
    .select("id")
    .eq("id", company_id)
    .maybeSingle();

  if (companyError) {
    return NextResponse.json(
      { error: companyError.message },
      { status: 500 }
    );
  }
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  // Referrer is intentionally omitted — see header comment + FirstTouchSchema.
  // deriveAttributionChannel handles undefined referrer (treats it as missing).
  const attributed_channel = deriveAttributionChannel({
    utm_source: touch.utm_source,
    utm_medium: touch.utm_medium,
    utm_campaign: touch.utm_campaign,
    gclid: touch.gclid,
    fbclid: touch.fbclid,
    landing_url: touch.landing_url,
  });

  const { error: insertError } = await db.from("trial_attributions").insert({
    company_id,
    utm_source: touch.utm_source ?? null,
    utm_medium: touch.utm_medium ?? null,
    utm_campaign: touch.utm_campaign ?? null,
    utm_content: touch.utm_content ?? null,
    utm_term: touch.utm_term ?? null,
    gclid: touch.gclid ?? null,
    fbclid: touch.fbclid ?? null,
    landing_url: touch.landing_url ?? null,
    trial_started_at: trial_started_at ?? new Date().toISOString(),
    attributed_channel,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "Attribution already exists for this company" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ company_id, attributed_channel });
});
