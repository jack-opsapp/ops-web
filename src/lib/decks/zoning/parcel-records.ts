import type { SupabaseClient } from "@supabase/supabase-js";

const ZONING_STATUSES_FROM_VERIFIED_SOURCES = new Set([
  "available",
  "partial",
  "userEntered",
]);

export interface ResolveVerifiedParcelRecordInput {
  db: SupabaseClient;
  companyId: string;
  siteAddress: string;
  jurisdictionId?: string;
}

export interface VerifiedParcelRecordResolution {
  parcelZoning: Record<string, unknown>;
}

interface DeckZoningParcelRecordRow {
  parcel_zoning: unknown;
}

export function normalizeSiteAddress(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

export async function resolveVerifiedParcelRecord({
  db,
  companyId,
  siteAddress,
  jurisdictionId,
}: ResolveVerifiedParcelRecordInput): Promise<VerifiedParcelRecordResolution | null> {
  const normalizedSiteAddress = normalizeSiteAddress(siteAddress);
  if (!normalizedSiteAddress) return null;

  const companyRecord = await findRecord({
    db,
    companyId,
    normalizedSiteAddress,
    jurisdictionId,
  });
  if (companyRecord) return companyRecord;

  return findRecord({
    db,
    companyId: null,
    normalizedSiteAddress,
    jurisdictionId,
  });
}

async function findRecord({
  db,
  companyId,
  normalizedSiteAddress,
  jurisdictionId,
}: {
  db: SupabaseClient;
  companyId: string | null;
  normalizedSiteAddress: string;
  jurisdictionId?: string;
}): Promise<VerifiedParcelRecordResolution | null> {
  let query = db
    .from("deck_zoning_parcel_records")
    .select("parcel_zoning")
    .eq("normalized_site_address", normalizedSiteAddress)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  query =
    companyId === null
      ? query.is("company_id", null)
      : query.eq("company_id", companyId);

  if (jurisdictionId) {
    query = query.eq("jurisdiction_id", jurisdictionId);
  }

  const { data, error } = await query.maybeSingle<DeckZoningParcelRecordRow>();
  if (error) {
    throw new Error(`Failed to resolve zoning parcel record: ${error.message}`);
  }

  return toVerifiedResolution(data);
}

function toVerifiedResolution(
  row: DeckZoningParcelRecordRow | null
): VerifiedParcelRecordResolution | null {
  if (!row || !isObjectRecord(row.parcel_zoning)) return null;

  const status = row.parcel_zoning.status;
  if (
    typeof status !== "string" ||
    !ZONING_STATUSES_FROM_VERIFIED_SOURCES.has(status)
  ) {
    return null;
  }

  return { parcelZoning: row.parcel_zoning };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
