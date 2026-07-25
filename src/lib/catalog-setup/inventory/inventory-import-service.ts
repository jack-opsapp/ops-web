import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedSheet } from "@/lib/catalog-setup/csv-parse";
import { getAccessTokenClient } from "@/lib/supabase/accessToken-client";
import {
  buildLiveCatalogSnapshot,
} from "@/lib/catalog-setup/phase-c/live-catalog-context";
import { loadCompanyCatalogRowSets } from "@/lib/catalog-setup/phase-c/session-service";
import { mapInventorySheet } from "./inventory-import-mapper";

interface StageInventoryImportParams {
  token: string;
  companyId: string;
  operatorId: string;
  setupSessionId?: string | null;
  sourceName: string;
  sourceMimeType?: string | null;
  sheet: ParsedSheet;
  defaultLocation: string;
  client?: SupabaseClient;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function id(value: unknown, label: string): string {
  const resolved = record(value).id;
  if (typeof resolved !== "string" || !resolved) {
    throw new Error(`${label} did not return an id`);
  }
  return resolved;
}

export async function stageInventoryImport({
  token,
  companyId,
  operatorId,
  setupSessionId,
  sourceName,
  sourceMimeType,
  sheet,
  defaultLocation,
  client: injectedClient,
}: StageInventoryImportParams) {
  const client = injectedClient ?? getAccessTokenClient(token);
  if (setupSessionId) {
    const session = await client
      .from("catalog_guided_setup_sessions")
      .select("id, status")
      .eq("id", setupSessionId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (session.error) {
      throw new Error(`Could not check catalog setup: ${session.error.message}`);
    }
    if (!session.data || record(session.data).status !== "complete") {
      throw new Error("Finish catalog setup before adding opening inventory");
    }
  }

  const rowSets = await loadCompanyCatalogRowSets(
    client as unknown as Parameters<typeof loadCompanyCatalogRowSets>[0],
    companyId,
  );
  const snapshot = buildLiveCatalogSnapshot(companyId, rowSets);
  const mappedRows = mapInventorySheet(
    sheet,
    snapshot,
    defaultLocation,
  );
  const sourceHash = createHash("sha256")
    .update(
      JSON.stringify({
        sourceName,
        headers: sheet.headers,
        rows: sheet.rows,
      }),
    )
    .digest("hex");

  const existing = await client
    .from("catalog_inventory_imports")
    .select("*")
    .eq("company_id", companyId)
    .eq("source_hash", sourceHash)
    .maybeSingle();
  if (existing.error) {
    throw new Error(`Could not check inventory import: ${existing.error.message}`);
  }
  if (existing.data && record(existing.data).status === "complete") {
    return {
      importId: id(existing.data, "Inventory import"),
      status: "complete" as const,
      replayed: true,
      summary: record(existing.data).summary,
      rows: [],
    };
  }

  const matched = mappedRows.filter((row) => row.status === "matched").length;
  const needsInput = mappedRows.length - matched;
  const summary = {
    rows: mappedRows.length,
    matched,
    needsInput,
    defaultLocation,
  };
  const importRow = {
    ...(existing.data ? { id: id(existing.data, "Inventory import") } : {}),
    company_id: companyId,
    operator_id: operatorId,
    setup_session_id: setupSessionId ?? null,
    status: "review",
    source_name: sourceName,
    source_mime_type: sourceMimeType ?? null,
    source_hash: sourceHash,
    mapping: {
      headers: sheet.headers,
      mode: "deterministic_variant_match",
    },
    summary,
    validation_issues: mappedRows.flatMap((row) =>
      row.issues.map((issue) => ({
        rowNumber: row.rowNumber,
        ...issue,
      })),
    ),
    error: null,
  };
  const savedImport = await client
    .from("catalog_inventory_imports")
    .upsert(importRow, { onConflict: "company_id,source_hash" })
    .select("id")
    .single();
  if (savedImport.error) {
    throw new Error(`Could not stage inventory import: ${savedImport.error.message}`);
  }
  const importId = id(savedImport.data, "Inventory import");

  if (mappedRows.length > 0) {
    const savedRows = await client
      .from("catalog_inventory_import_rows")
      .upsert(
        mappedRows.map((row) => ({
          company_id: companyId,
          import_id: importId,
          row_number: row.rowNumber,
          row_fingerprint: row.fingerprint,
          status: row.status,
          raw_data: row.rawData,
          normalized_data: row.normalizedData,
          matched_variant_id: row.matchedVariantId,
          proposed_stock_unit: row.proposedStockUnit,
          validation_issues: row.issues,
          error: null,
        })),
        { onConflict: "import_id,row_number" },
      );
    if (savedRows.error) {
      throw new Error(`Could not stage inventory rows: ${savedRows.error.message}`);
    }
  }

  return {
    importId,
    status: "review" as const,
    replayed: false,
    summary,
    rows: mappedRows.map((row) => ({
      rowNumber: row.rowNumber,
      status: row.status,
      normalizedData: row.normalizedData,
      proposedStockUnit: row.proposedStockUnit,
      issues: row.issues,
    })),
  };
}
