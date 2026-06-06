/**
 * OPS Web — QuickBooks Online Webhook Receiver (INBOUND ONLY)
 *
 * POST /api/integrations/quickbooks/webhook
 *
 * Intuit calls this endpoint UNAUTHENTICATED whenever a subscribed entity
 * changes in a connected QBO company. We:
 *   1. Read the RAW request body once and verify the `intuit-signature` header
 *      (base64 HMAC-SHA256 of the raw bytes, keyed by QB_WEBHOOK_VERIFIER_TOKEN)
 *      with a timing-safe compare. FAIL CLOSED: no verifier configured → 500;
 *      missing/mismatched signature → 401 and nothing is processed.
 *   2. Route each notification to the owning connection by the deterministic
 *      realm hash (realm_id is encrypted at rest and unqueryable).
 *   3. Fetch each changed entity READ-ONLY (GET) and upsert it into OPS using
 *      the exact same mapping as the manual import (QuickBooksWebhookApplyService).
 *   4. Log every processed entity to accounting_sync_log (direction 'pull').
 *
 * READ-ONLY / INBOUND: this route never calls any push* path and never writes to
 * QuickBooks. It reads from QB and writes only to the OPS Supabase database.
 *
 * It ALWAYS returns 200 quickly for a verified request, even if a per-entity
 * fetch/apply errored — Intuit retries on any non-2xx, and we do not want
 * infinite retries for a single bad record. The only non-200 outcomes are a
 * signature failure (401) and an unconfigured verifier (500).
 *
 * This path is public by design. The app-wide middleware matcher excludes
 * `/api/*`, so no auth gate blocks Intuit's unauthenticated POSTs.
 */

import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { realmIdLookup } from "@/lib/api/services/token-cipher";
import {
  getQuickBooksProviderEnvironment,
  getQuickBooksWebhookVerifierTokenForEnvironment,
} from "@/lib/api/services/quickbooks-config";
import { AccountingSyncAuditService } from "@/lib/api/services/accounting-sync-audit-service";
import type {
  AccountingSyncAuditInput,
  AccountingSyncEntityType,
  AccountingSyncOperation,
} from "@/lib/api/services/accounting-sync-queue-types";
import {
  QuickBooksWebhookApplyService,
  type ApplyEntityResult,
  type QboEntityName,
  type QboOperation,
} from "@/lib/api/services/quickbooks-webhook-apply-service";

const PROVIDER = "quickbooks";

// Entities we act on. Intuit may emit others (Item, Bill, Vendor, …) — ignored.
const HANDLED_ENTITIES = new Set<QboEntityName>([
  "Customer",
  "Invoice",
  "Payment",
  "Estimate",
]);

const NO_STORE = { "Cache-Control": "no-store" } as const;

interface IntuitEntity {
  name?: string;
  id?: string;
  operation?: string;
  lastUpdated?: string;
}

interface IntuitNotification {
  realmId?: string;
  dataChangeEvent?: { entities?: IntuitEntity[] };
}

interface IntuitWebhookPayload {
  eventNotifications?: IntuitNotification[];
}

/**
 * Constant-time compare of the received signature against the expected HMAC.
 * Guards equal byte-length first (timingSafeEqual throws on a length mismatch),
 * so a wrong-length signature returns false instead of throwing.
 */
function signatureMatches(rawBody: string, header: string, verifier: string): boolean {
  const expected = createHmac("sha256", verifier).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function entityTypeFor(entity: QboEntityName): AccountingSyncEntityType {
  switch (entity) {
    case "Customer":
      return "customer";
    case "Invoice":
      return "invoice";
    case "Payment":
      return "payment";
    case "Estimate":
      return "estimate";
  }
}

function operationFor(operation: QboOperation): AccountingSyncOperation {
  switch (operation) {
    case "Create":
      return "create";
    case "Delete":
      return "delete_soft";
    case "Void":
      return "void";
    case "Update":
    case "Emailed":
    case "Merge":
      return "update";
  }
}

function safeText(input: unknown): string | null {
  const raw =
    input instanceof Error
      ? input.message
      : typeof input === "string"
        ? input
        : input === null || input === undefined
          ? null
          : String(input);
  if (!raw) return null;

  return raw
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/authorization:\s*[^,\n\r]+/gi, "authorization: [redacted]")
    .replace(/access[_-]?token["'\s:=]+[^"',\s}]+/gi, "access_token=[redacted]")
    .replace(/refresh[_-]?token["'\s:=]+[^"',\s}]+/gi, "refresh_token=[redacted]")
    .slice(0, 500);
}

async function recordAuditBestEffort(
  audit: AccountingSyncAuditService,
  input: AccountingSyncAuditInput
): Promise<void> {
  try {
    await audit.record(input);
  } catch (err) {
    console.error(`[qbo-webhook] accounting sync audit failed: ${safeText(err) ?? "unknown error"}`);
  }
}

function auditStatusFor(result: ApplyEntityResult): AccountingSyncAuditInput["status"] {
  switch (result.status) {
    case "success":
      return "succeeded";
    case "skipped":
      return "skipped";
    case "needs_review":
      return "needs_review";
    case "error":
      return "failed";
  }
}

function auditDecisionFor(result: ApplyEntityResult): AccountingSyncAuditInput["decision"] {
  switch (result.status) {
    case "success":
      return "qb_won";
    case "skipped":
      return "skipped";
    case "needs_review":
    case "error":
      return "needs_review";
  }
}

function legacySyncStatusFor(result: ApplyEntityResult): "success" | "error" | "skipped" {
  if (result.status === "success") return "success";
  if (result.status === "skipped") return "skipped";
  return "error";
}

/** Write a per-entity audit row to accounting_sync_log. Never throws. */
async function logSync(
  supabase: ReturnType<typeof getServiceRoleClient>,
  row: {
    company_id: string;
    entity_type: "client" | "estimate" | "invoice" | "payment";
    entity_id: string | null;
    external_id: string | null;
    status: "success" | "error" | "skipped";
    details: string | null;
  }
): Promise<void> {
  try {
    await supabase.from("accounting_sync_log").insert({
      company_id: row.company_id,
      provider: PROVIDER,
      direction: "pull",
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      external_id: row.external_id,
      status: row.status,
      details: row.details,
    });
  } catch {
    // Audit-log failure must never break webhook processing.
  }
}

export async function POST(request: Request): Promise<Response> {
  // ── 1. Read the RAW body ONCE — sign/verify against these exact bytes ───────
  const raw = await request.text();

  // ── 2. Verify the verifier is configured (FAIL CLOSED) ──────────────────────
  const providerEnvironment = getQuickBooksProviderEnvironment();
  let verifier: string | null;
  try {
    verifier = getQuickBooksWebhookVerifierTokenForEnvironment(providerEnvironment);
  } catch (err) {
    console.error(
      `[qbo-webhook] QuickBooks config unavailable: ${safeText(err) ?? "unknown error"}`
    );
    return NextResponse.json(
      { error: "Webhook verifier not configured" },
      { status: 500, headers: NO_STORE }
    );
  }
  if (!verifier || verifier.trim() === "") {
    console.error("[qbo-webhook] webhook verifier not configured");
    return NextResponse.json(
      { error: "Webhook verifier not configured" },
      { status: 500, headers: NO_STORE }
    );
  }

  // ── 3. Verify the signature ─────────────────────────────────────────────────
  const signature = request.headers.get("intuit-signature");
  if (!signature || !signatureMatches(raw, signature, verifier)) {
    // Unverified request: process NOTHING.
    return NextResponse.json({ error: "Invalid signature" }, { status: 401, headers: NO_STORE });
  }

  // ── 4. Parse the (verified) payload ─────────────────────────────────────────
  let payload: IntuitWebhookPayload;
  try {
    payload = JSON.parse(raw) as IntuitWebhookPayload;
  } catch {
    // Verified but unparseable — ack 200 so Intuit does not retry forever.
    return NextResponse.json({ received: true, processed: 0 }, { status: 200, headers: NO_STORE });
  }

  const notifications = Array.isArray(payload.eventNotifications)
    ? payload.eventNotifications
    : [];

  const supabase = getServiceRoleClient();
  const applyService = new QuickBooksWebhookApplyService(supabase);
  const audit = new AccountingSyncAuditService(supabase);
  let processed = 0;

  for (const notification of notifications) {
    const realmId = notification.realmId;
    if (!realmId) continue;

    // Route by the deterministic realm hash (realm_id is encrypted/unqueryable).
    const { data: connection } = await supabase
      .from("accounting_connections")
      .select("id, company_id")
      .eq("realm_id_lookup", realmIdLookup(realmId))
      .eq("provider", PROVIDER)
      .eq("provider_environment", providerEnvironment)
      .eq("is_connected", true)
      .eq("sync_enabled", true)
      .maybeSingle();

    if (!connection) {
      // No connected company for this realm — skip this notification (still 200).
      continue;
    }
    const conn = { id: connection.id as string, company_id: connection.company_id as string };

    const entities = notification.dataChangeEvent?.entities ?? [];
    for (const entity of entities) {
      const name = entity.name as QboEntityName | undefined;
      const id = entity.id;
      const operation = (entity.operation as QboOperation | undefined) ?? "Update";
      if (!name || !id || !HANDLED_ENTITIES.has(name)) continue; // ignore other types

      try {
        const result = await applyService.applyEntity(conn, name, id, operation);
        processed += 1;
        const status = auditStatusFor(result);
        await recordAuditBestEffort(audit, {
          companyId: conn.company_id,
          connectionId: conn.id,
          provider: PROVIDER,
          direction: "qb_to_ops",
          entityType: entityTypeFor(name),
          entityId: result.entityId ?? null,
          externalId: result.qbId,
          operation: operationFor(operation),
          status,
          source: "webhook",
          decision: auditDecisionFor(result),
          qbUpdatedAt: entity.lastUpdated ?? result.qbUpdatedAt ?? null,
          afterSnapshot: {
            operation,
            status: result.status,
            detail: safeText(result.detail),
            ...(result.afterSnapshot ?? {}),
          },
          error:
            result.status === "error" || result.status === "needs_review"
              ? safeText(result.detail)
              : null,
        });
        await logSync(supabase, {
          company_id: conn.company_id,
          entity_type: result.logEntityType,
          entity_id: result.entityId ?? null,
          external_id: result.qbId,
          status: legacySyncStatusFor(result),
          details: result.detail,
        });
      } catch (err) {
        // A single bad record must NOT fail the whole request (Intuit retries on
        // non-2xx → infinite retries for one poison record). Log + continue.
        console.error(
          `[qbo-webhook] apply failed for ${name} ${id} (${operation}): ${
            safeText(err) ?? "unknown error"
          }`
        );
        await recordAuditBestEffort(audit, {
          companyId: conn.company_id,
          connectionId: conn.id,
          provider: PROVIDER,
          direction: "qb_to_ops",
          entityType: entityTypeFor(name),
          entityId: null,
          externalId: id,
          operation: operationFor(operation),
          status: "failed",
          source: "webhook",
          decision: "needs_review",
          qbUpdatedAt: entity.lastUpdated ?? null,
          afterSnapshot: {
            operation,
            status: "failed",
          },
          error: safeText(err) ?? "apply threw",
        });
        await logSync(supabase, {
          company_id: conn.company_id,
          entity_type:
            name === "Customer"
              ? "client"
              : name === "Invoice"
                ? "invoice"
                : name === "Payment"
                  ? "payment"
                  : "estimate",
          entity_id: null,
          external_id: id,
          status: "error",
          details: "apply threw",
        });
      }
    }
  }

  // Verified request always acks 200 (even if a per-entity apply errored).
  return NextResponse.json({ received: true, processed }, { status: 200, headers: NO_STORE });
}
