import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  isObjectRecord,
  isVerifiedParcelZoningStatus,
  normalizeSiteAddress,
  type VerifiedParcelZoningStatus,
} from "@/lib/decks/zoning/parcel-records";

const OPTIONAL_TRIMMED_STRING = z.string().trim().optional().nullable();

const importRecordSchema = z
  .object({
    site_address: z.string(),
    company_id: z.string().uuid().optional().nullable(),
    jurisdiction_id: OPTIONAL_TRIMMED_STRING,
    parcel_zoning: z.unknown(),
    source_status: OPTIONAL_TRIMMED_STRING,
    provider: OPTIONAL_TRIMMED_STRING,
    source_url: z.string().trim().url().optional().nullable(),
    retrieved_at: z.string().datetime().optional().nullable(),
    expires_at: z.string().datetime().optional().nullable(),
  })
  .strict();

export interface DeckZoningParcelRecordImportRow {
  company_id: string | null;
  jurisdiction_id: string | null;
  normalized_site_address: string;
  parcel_zoning: Record<string, unknown>;
  source_status: VerifiedParcelZoningStatus;
  provider: string | null;
  source_url: string | null;
  retrieved_at: string;
  expires_at: string | null;
}

export interface PreparedVerifiedParcelRecord {
  index: number;
  companyId: string | null;
  jurisdictionId: string | null;
  normalizedSiteAddress: string;
  sourceStatus: VerifiedParcelZoningStatus;
  row: DeckZoningParcelRecordImportRow;
}

export interface RejectedVerifiedParcelRecord {
  index: number;
  reason: string;
}

export interface PreparedVerifiedParcelRecordImport {
  accepted: PreparedVerifiedParcelRecord[];
  rejected: RejectedVerifiedParcelRecord[];
}

export interface ImportVerifiedParcelRecordsResult {
  inserted: number;
  updated: number;
}

export function prepareVerifiedParcelRecordImport(
  records: unknown[]
): PreparedVerifiedParcelRecordImport {
  const accepted: PreparedVerifiedParcelRecord[] = [];
  const rejected: RejectedVerifiedParcelRecord[] = [];

  records.forEach((record, index) => {
    const parsed = importRecordSchema.safeParse(record);
    if (!parsed.success) {
      rejected.push({
        index,
        reason: formatRecordIssue(parsed.error.issues[0]),
      });
      return;
    }

    const siteAddress = parsed.data.site_address.trim();
    if (!siteAddress) {
      rejected.push({ index, reason: "site_address is required" });
      return;
    }

    const normalizedSiteAddress = normalizeSiteAddress(siteAddress);
    if (!normalizedSiteAddress) {
      rejected.push({ index, reason: "site_address is required" });
      return;
    }

    const parcelZoning = parsed.data.parcel_zoning;
    if (!isObjectRecord(parcelZoning)) {
      rejected.push({ index, reason: "parcel_zoning is required" });
      return;
    }

    if (!hasNonBlankString(parcelZoning.siteAddress)) {
      rejected.push({ index, reason: "parcel_zoning.siteAddress is required" });
      return;
    }

    const parcelStatus = parcelZoning.status;
    if (!isVerifiedParcelZoningStatus(parcelStatus)) {
      rejected.push({
        index,
        reason:
          "parcel_zoning.status must be available, partial, or userEntered",
      });
      return;
    }

    const explicitSourceStatus = normalizeOptionalString(
      parsed.data.source_status
    );
    let sourceStatus: VerifiedParcelZoningStatus = parcelStatus;
    if (explicitSourceStatus) {
      if (!isVerifiedParcelZoningStatus(explicitSourceStatus)) {
        rejected.push({
          index,
          reason: "source_status must be available, partial, or userEntered",
        });
        return;
      }
      if (explicitSourceStatus !== parcelStatus) {
        rejected.push({
          index,
          reason: "source_status must match parcel_zoning.status",
        });
        return;
      }
      sourceStatus = explicitSourceStatus;
    }

    if (
      parcelStatus !== "userEntered" &&
      !isObjectRecord(parcelZoning.parcel) &&
      !isObjectRecord(parcelZoning.criteria)
    ) {
      rejected.push({
        index,
        reason:
          "available or partial parcel_zoning must include parcel or criteria",
      });
      return;
    }

    const provider =
      normalizeOptionalString(parsed.data.provider) ??
      inferNestedString(parcelZoning, "source", "provider");
    if (parcelStatus !== "userEntered" && !provider) {
      rejected.push({
        index,
        reason: "provider is required for verified zoning",
      });
      return;
    }

    const jurisdictionId =
      normalizeOptionalString(parsed.data.jurisdiction_id) ??
      inferNestedString(parcelZoning, "source", "jurisdictionId") ??
      null;
    const sourceUrl =
      normalizeOptionalString(parsed.data.source_url) ??
      inferNestedString(parcelZoning, "source", "sourceURL") ??
      inferNestedString(parcelZoning, "source", "sourceUrl") ??
      null;
    const retrievedAt =
      normalizeOptionalString(parsed.data.retrieved_at) ??
      new Date().toISOString();
    const expiresAt = normalizeOptionalString(parsed.data.expires_at) ?? null;

    const row: DeckZoningParcelRecordImportRow = {
      company_id: parsed.data.company_id ?? null,
      jurisdiction_id: jurisdictionId,
      normalized_site_address: normalizedSiteAddress,
      parcel_zoning: parcelZoning,
      source_status: sourceStatus,
      provider: provider ?? null,
      source_url: sourceUrl,
      retrieved_at: retrievedAt,
      expires_at: expiresAt,
    };

    accepted.push({
      index,
      companyId: row.company_id,
      jurisdictionId,
      normalizedSiteAddress,
      sourceStatus,
      row,
    });
  });

  return { accepted, rejected };
}

export async function importVerifiedParcelRecords({
  db,
  records,
}: {
  db: SupabaseClient;
  records: PreparedVerifiedParcelRecord[];
}): Promise<ImportVerifiedParcelRecordsResult> {
  let inserted = 0;
  let updated = 0;

  for (const record of records) {
    const existingId = await findExistingRecordId({ db, record });
    if (existingId) {
      const { error } = await db
        .from("deck_zoning_parcel_records")
        .update(record.row)
        .eq("id", existingId);

      if (error) {
        throw new Error(
          `Failed to update zoning parcel record: ${error.message}`
        );
      }

      updated += 1;
      continue;
    }

    const { error } = await db
      .from("deck_zoning_parcel_records")
      .insert(record.row);

    if (error) {
      throw new Error(
        `Failed to insert zoning parcel record: ${error.message}`
      );
    }

    inserted += 1;
  }

  return { inserted, updated };
}

async function findExistingRecordId({
  db,
  record,
}: {
  db: SupabaseClient;
  record: PreparedVerifiedParcelRecord;
}): Promise<string | null> {
  let query = db
    .from("deck_zoning_parcel_records")
    .select("id")
    .eq("normalized_site_address", record.normalizedSiteAddress)
    .is("deleted_at", null)
    .limit(1);

  query =
    record.companyId === null
      ? query.is("company_id", null)
      : query.eq("company_id", record.companyId);

  query =
    record.jurisdictionId === null
      ? query.is("jurisdiction_id", null)
      : query.eq("jurisdiction_id", record.jurisdictionId);

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`Failed to check zoning parcel record: ${error.message}`);
  }

  const id = data && isObjectRecord(data) ? data.id : null;
  return typeof id === "string" ? id : null;
}

function inferNestedString(
  record: Record<string, unknown>,
  parentKey: string,
  childKey: string
): string | undefined {
  const parent = record[parentKey];
  if (!isObjectRecord(parent)) return undefined;
  return normalizeOptionalString(parent[childKey]);
}

function hasNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function formatRecordIssue(issue: z.ZodIssue | undefined): string {
  const field = issue?.path[0];
  if (field === "site_address") return "site_address is required";
  if (field === "company_id") return "company_id must be a UUID";
  if (field === "jurisdiction_id") return "jurisdiction_id must be a string";
  if (field === "parcel_zoning") return "parcel_zoning is required";
  if (field === "source_url") return "source_url must be a valid URL";
  if (field === "retrieved_at") return "retrieved_at must be an ISO timestamp";
  if (field === "expires_at") return "expires_at must be an ISO timestamp";
  return "record shape is invalid";
}
