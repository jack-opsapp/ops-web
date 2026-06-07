/**
 * OPS Web - QuickBooks Import Service (read-only pull → stage → match → review → apply)
 *
 * Drives the A1 read-only pull, normalizes QB JSON into the qbo_staging_* tables
 * (qbo-normalize), proposes customer matches (qbo-match + pg_trgm RPC), builds
 * the QboImportReview aggregate (qbo-reconcile), and (A3) applies a staged run
 * into live clients/estimates/invoices/line_items/payments.
 *
 * READ-ONLY: the only QB calls go through QuickBooksPullService (GET only); the
 * run records qb_write_calls and asserts it stays 0. The apply phase issues ZERO
 * QB calls — it operates entirely on already-staged rows.
 *
 * The service is service-role only: the constructor takes an injectable
 * service-role SupabaseClient (defaulting to getServiceRoleClient()), so routes
 * use `new QuickBooksImportService()` and tests inject an in-memory double.
 *
 * Mirrors sync-orchestrator's service-role + AccountingTokenService usage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { AccountingTokenService } from "./accounting-token-service";
import { QuickBooksPullService } from "./quickbooks-pull-service";
import {
  normalizeCustomer,
  normalizeInvoice,
  normalizeEstimate,
  splitPaymentLines,
  deriveInvoiceStatus,
  mapEstimateStatus,
  buildItemTypeMap,
  clientFieldsFromCustomer,
  subClientFieldsFromCustomer,
  type CustomerShape,
} from "./qbo-normalize";
import {
  getQuickBooksProviderEnvironment,
  type QuickBooksEnvironment,
} from "./quickbooks-config";
import {
  resolveCustomerMatch,
  type ExistingClient,
  type FuzzyCandidate,
} from "./qbo-match";
import {
  buildReconciliation,
  buildMatchCounts,
  buildStagedCounts,
} from "./qbo-reconcile";
import type {
  QboImportRun,
  QboImportReview,
  QboStagedInvoice,
  QboStagedPayment,
  QboCustomerMatch,
  QboStagedCustomer,
  QboApplyDecision,
  QboApplyResult,
} from "@/lib/types/qbo-import";

const FUZZY_THRESHOLD = 0.6;
const HISTORY_MONTHS = 24;

// ─── Run-row mapping ────────────────────────────────────────────────────────

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapRun(row: Record<string, unknown>): QboImportRun {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    provider: row.provider as string,
    providerEnvironment:
      (row.provider_environment as QuickBooksEnvironment | null) ?? "production",
    status: row.status as QboImportRun["status"],
    historyCutoff: (row.history_cutoff as string) ?? null,
    qbWriteCalls: (row.qb_write_calls as number) ?? 0,
    totals: (row.totals as Record<string, unknown>) ?? {},
    error: (row.error as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    createdAt: toDate(row.created_at),
    finishedAt: toDate(row.finished_at),
  };
}

/**
 * Map a raw qbo_customer_matches row (snake_case) to the camelCase
 * QboCustomerMatch the review UI consumes, joining the QB customer's
 * display_name (the matches table doesn't carry it) and normalizing the
 * candidates jsonb (stored as client_id/similarity) to clientId/score.
 */
function mapCustomerMatch(
  r: Record<string, unknown>,
  stagingByQbId: Map<string, Record<string, unknown>>
): QboCustomerMatch {
  const rawCandidates = (r.candidates as Record<string, unknown>[] | null) ?? [];
  const staging = stagingByQbId.get(r.customer_qb_id as string);
  const companyName = (staging?.company_name as string | null) ?? null;
  const contactName = (staging?.contact_name as string | null) ?? null;
  return {
    id: r.id as string,
    runId: r.run_id as string,
    companyId: r.company_id as string,
    customerQbId: r.customer_qb_id as string,
    // Prefer the company name as the review label; fall back to display name.
    displayName: companyName ?? (staging?.display_name as string | null) ?? null,
    companyName,
    contactName,
    proposedAction: r.proposed_action as QboCustomerMatch["proposedAction"],
    matchedClientId: (r.matched_client_id as string | null) ?? null,
    matchBasis: (r.match_basis as QboCustomerMatch["matchBasis"]) ?? null,
    confidence: (r.confidence as QboCustomerMatch["confidence"]) ?? null,
    candidates: rawCandidates.map((c) => ({
      clientId: (c.client_id ?? c.clientId) as string,
      name: (c.name as string | null) ?? null,
      basis: (c.basis ??
        r.match_basis ??
        "none") as QboCustomerMatch["candidates"][number]["basis"],
      score: Number(c.score ?? c.similarity ?? 0),
    })),
    decidedAction: (r.decided_action as QboCustomerMatch["decidedAction"]) ?? null,
    decidedClientId: (r.decided_client_id as string | null) ?? null,
  };
}

function cutoffISODate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - HISTORY_MONTHS);
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * True if a thrown pull error indicates an HTTP 401 / unauthorized. The pull
 * service throws `Error("QuickBooks pull error (401): …")`; we also tolerate a
 * `.status` field or a plain "unauthorized" message.
 */
function isUnauthorizedError(err: unknown): boolean {
  if (!err) return false;
  const status = (err as { status?: number }).status;
  if (status === 401) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /\(401\)/.test(msg) || /unauthorized/i.test(msg);
}

/**
 * Throw on a Supabase write error. The apply path previously did
 * `await sb.from(...).upsert(...)` without inspecting the result, so a failed
 * write (e.g. 42P10 against a partial-only ON CONFLICT arbiter) was swallowed
 * and the run still reported `applied` with inflated totals — silent data loss.
 * Every apply write now routes through this so a failure aborts the run loudly.
 */
function assertNoWriteError(
  res: { error: { message?: string; code?: string } | null },
  ctx: string
): void {
  if (res.error) {
    const e = res.error;
    throw new Error(
      `QBO apply write failed [${ctx}]${e.code ? ` (${e.code})` : ""}: ${e.message ?? JSON.stringify(e)}`
    );
  }
}

type QboMappedTable = "clients" | "sub_clients" | "estimates" | "invoices" | "payments";

type SupabaseWriteError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function withoutId(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  delete next.id;
  return next;
}

function isUniqueConstraintError(error: SupabaseWriteError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const message = error.message?.toLowerCase() ?? "";
  return message.includes("duplicate key") || message.includes("unique constraint");
}

function qboPaymentCompositeId(paymentQbId: string, invoiceQbId: string): string {
  return `${paymentQbId}:${invoiceQbId}`;
}

export class QuickBooksImportService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = getServiceRoleClient()) {
    this.supabase = supabase;
  }

  private async getRun(runId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase
      .from("qbo_import_runs")
      .select("*")
      .eq("id", runId)
      .single();
    if (error || !data) throw new Error(`Import run not found: ${runId}`);
    return data as Record<string, unknown>;
  }

  private async setRun(runId: string, patch: Record<string, unknown>): Promise<void> {
    await this.supabase.from("qbo_import_runs").update(patch).eq("id", runId);
  }

  private async suppressAccountingSync(
    companyId: string,
    entityType: "customer" | "invoice" | "estimate" | "payment",
    entityId: string
  ): Promise<void> {
    const { error } = await this.supabase.rpc("suppress_accounting_sync", {
      p_company_id: companyId,
      p_provider: "quickbooks",
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_source: "quickbooks",
      p_ttl_seconds: 600,
    });
    if (error) {
      throw new Error(`Failed to suppress QuickBooks accounting sync: ${error.message}`);
    }
  }

  private async resolveQboMappedRowId(
    table: QboMappedTable,
    companyId: string,
    qbId: string
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from(table)
      .select("id")
      .eq("company_id", companyId)
      .eq("qb_id", qbId)
      .maybeSingle();
    if (error) {
      throw new Error(`QBO apply lookup failed [${table}.lookup]: ${error.message}`);
    }
    return typeof data?.id === "string" ? data.id : null;
  }

  private async persistQboMappedRow(args: {
    table: QboMappedTable;
    row: Record<string, unknown>;
    existingId: string | null;
    syncEntityType: "customer" | "invoice" | "estimate" | "payment";
    context: string;
  }): Promise<string> {
    const companyId = String(args.row.company_id ?? "");
    const qbId = String(args.row.qb_id ?? "");
    const generatedId = String(args.row.id ?? "");
    if (!companyId || !qbId || !generatedId) {
      throw new Error(`QBO apply write failed [${args.context}]: missing row identity`);
    }

    const patch = withoutId(args.row);
    if (args.existingId) {
      await this.suppressAccountingSync(companyId, args.syncEntityType, args.existingId);
      assertNoWriteError(
        await this.supabase
          .from(args.table)
          .update(patch)
          .eq("company_id", companyId)
          .eq("qb_id", qbId),
        args.context
      );
      return args.existingId;
    }

    await this.suppressAccountingSync(companyId, args.syncEntityType, generatedId);
    const insertResult = await this.supabase.from(args.table).insert(args.row);
    if (!insertResult.error) return generatedId;
    if (!isUniqueConstraintError(insertResult.error as SupabaseWriteError)) {
      assertNoWriteError(insertResult, args.context);
    }

    const raceWinnerId = await this.resolveQboMappedRowId(args.table, companyId, qbId);
    if (!raceWinnerId) {
      throw new Error(`QBO apply write failed [${args.context}]: duplicate row id was not resolved`);
    }

    await this.suppressAccountingSync(companyId, args.syncEntityType, raceWinnerId);
    assertNoWriteError(
      await this.supabase
        .from(args.table)
        .update(patch)
        .eq("company_id", companyId)
        .eq("qb_id", qbId),
      args.context
    );
    return raceWinnerId;
  }

  private async findExistingPaymentLine(
    companyId: string,
    rawPaymentQbId: string,
    invoiceQbId: string,
    invoiceId: string
  ): Promise<{ id: string; qb_id: string | null } | null> {
    const compositeQbId = qboPaymentCompositeId(rawPaymentQbId, invoiceQbId);
    const { data: composite, error: compositeError } = await this.supabase
      .from("payments")
      .select("id, qb_id")
      .eq("company_id", companyId)
      .eq("qb_id", compositeQbId)
      .maybeSingle();
    if (compositeError) {
      throw new Error(`QBO apply lookup failed [payments.lookup]: ${compositeError.message}`);
    }
    if (composite?.id) {
      return { id: composite.id as string, qb_id: (composite.qb_id as string | null) ?? null };
    }

    const { data: legacy, error: legacyError } = await this.supabase
      .from("payments")
      .select("id, qb_id")
      .eq("company_id", companyId)
      .eq("invoice_id", invoiceId)
      .eq("qb_id", rawPaymentQbId)
      .maybeSingle();
    if (legacyError) {
      throw new Error(`QBO apply lookup failed [payments.legacy_lookup]: ${legacyError.message}`);
    }
    if (!legacy?.id) return null;
    return { id: legacy.id as string, qb_id: (legacy.qb_id as string | null) ?? null };
  }

  private async persistPaymentLine(args: {
    companyId: string;
    rawPaymentQbId: string;
    invoiceQbId: string;
    row: Record<string, unknown>;
  }): Promise<string> {
    const compositeQbId = qboPaymentCompositeId(args.rawPaymentQbId, args.invoiceQbId);
    const existing = await this.findExistingPaymentLine(
      args.companyId,
      args.rawPaymentQbId,
      args.invoiceQbId,
      String(args.row.invoice_id)
    );
    const row: Record<string, unknown> = { ...args.row, qb_id: compositeQbId };
    const patch = withoutId(row);

    if (existing) {
      await this.suppressAccountingSync(args.companyId, "payment", existing.id);
      assertNoWriteError(
        await this.supabase
          .from("payments")
          .update(patch)
          .eq("id", existing.id)
          .eq("company_id", args.companyId),
        "payments.upsert"
      );
      return existing.id;
    }

    await this.suppressAccountingSync(args.companyId, "payment", String(row.id));
    const insertResult = await this.supabase.from("payments").insert(row);
    if (!insertResult.error) return String(row.id);
    if (!isUniqueConstraintError(insertResult.error as SupabaseWriteError)) {
      assertNoWriteError(insertResult, "payments.upsert");
    }

    const raceWinner = await this.findExistingPaymentLine(
      args.companyId,
      args.rawPaymentQbId,
      args.invoiceQbId,
      String(args.row.invoice_id)
    );
    if (!raceWinner) {
      throw new Error("QBO apply write failed [payments.upsert]: duplicate row id was not resolved");
    }

    await this.suppressAccountingSync(args.companyId, "payment", raceWinner.id);
    assertNoWriteError(
      await this.supabase
        .from("payments")
        .update(patch)
        .eq("id", raceWinner.id)
        .eq("company_id", args.companyId),
      "payments.upsert"
    );
    return raceWinner.id;
  }

  private async replaceImportLineItems(
    companyId: string,
    parent: { invoiceId?: string; estimateId?: string },
    lines: Array<Record<string, unknown>>
  ): Promise<number> {
    if (parent.invoiceId) {
      await this.suppressAccountingSync(companyId, "invoice", parent.invoiceId);
    } else if (parent.estimateId) {
      await this.suppressAccountingSync(companyId, "estimate", parent.estimateId);
    } else {
      throw new Error("QBO apply write failed [line_items.replace]: parent missing");
    }

    const pLines = lines.map((line) => {
      const itemType = line.qb_item_type as string | null;
      const opsType =
        itemType === "Inventory" || itemType === "NonInventory"
          ? "MATERIAL"
          : itemType === "Service" || (!itemType && Boolean(parent.estimateId))
            ? "LABOR"
            : "OTHER";
      return {
        name: line.name ?? "Line item",
        description: line.description ?? null,
        quantity: line.quantity ?? 1,
        unit_price: line.unit_price ?? 0,
        is_taxable: line.is_taxable ?? false,
        sort_order: line.sort_order ?? 0,
        type: opsType,
      };
    });

    assertNoWriteError(
      await this.supabase.rpc("replace_qbo_line_items_locked", {
        p_company_id: companyId,
        p_invoice_id: parent.invoiceId ?? null,
        p_estimate_id: parent.estimateId ?? null,
        p_lines: pLines,
      }),
      "line_items.replace"
    );
    return pLines.length;
  }

  /** Create a pending run for the company. */
  async startImportRun(companyId: string): Promise<QboImportRun> {
    const providerEnvironment = getQuickBooksProviderEnvironment();
    const { data, error } = await this.supabase
      .from("qbo_import_runs")
      .insert({
        company_id: companyId,
        provider: "quickbooks",
        provider_environment: providerEnvironment,
        status: "pending",
        history_cutoff: cutoffISODate(),
        qb_write_calls: 0,
        totals: {},
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(`Failed to start import run: ${error?.message}`);
    return mapRun(data as Record<string, unknown>);
  }

  /**
   * Pull from QB (GET only) and normalize into qbo_staging_*.
   * Idempotent on (run_id, qb_id) — staging UNIQUE constraints absorb retries
   * via upsert. Leaves the run in 'staged' (or 'error').
   */
  async pullAndStage(runId: string): Promise<void> {
    const sb = this.supabase;
    const runRow = await this.getRun(runId);
    const companyId = runRow.company_id as string;
    const providerEnvironment =
      runRow.provider_environment === "sandbox" ? "sandbox" : "production";
    const cutoff = (runRow.history_cutoff as string) ?? cutoffISODate();

    // Resolve the connection + a valid token (refreshes if needed).
    const { data: conn, error: connErr } = await sb
      .from("accounting_connections")
      .select("id, realm_id")
      .eq("company_id", companyId)
      .eq("provider", "quickbooks")
      .eq("provider_environment", providerEnvironment)
      .single();
    if (connErr || !conn) throw new Error(`No QuickBooks connection for company ${companyId}`);

    await this.setRun(runId, { status: "pulling" });

    try {
      const connId = conn.id as string;

      // Build a pull service from a freshly-resolved token. Used for the
      // initial attempt and (on a 401) the single re-auth retry below.
      const buildPull = async (): Promise<QuickBooksPullService> => {
        const { accessToken, realmId, providerEnvironment: tokenEnvironment } = await AccountingTokenService.getValidToken(
          sb,
          connId
        );
        if (!realmId) throw new Error("QuickBooks realmId not found on connection");
        return new QuickBooksPullService(
          realmId,
          accessToken,
          tokenEnvironment
        );
      };

      // Run every pull against a pull service. Extracted so a 401 mid-pull can
      // re-run the whole batch once with a refreshed token (the access token
      // may have expired between getValidToken and the request).
      const runPulls = (svc: QuickBooksPullService) =>
        Promise.all([
          svc.pullCustomers(),
          svc.pullInvoices(cutoff),
          svc.pullEstimates(cutoff),
          svc.pullPayments(cutoff),
          svc.pullItems(),
        ]);

      let pull = await buildPull();
      const now = new Date();

      let pulled: Awaited<ReturnType<typeof runPulls>>;
      try {
        pulled = await runPulls(pull);
      } catch (pullErr) {
        // Refresh-and-retry ONCE on a 401: force a fresh token, rebuild the
        // pull service against it, and re-run the batch. Any non-401 (or a
        // second 401) propagates and fails the run.
        if (!isUnauthorizedError(pullErr)) throw pullErr;
        // Expire the stored token so getValidToken performs a real refresh on
        // the retry — a 401 means the current access token is no longer valid
        // even though it had not yet reached its recorded expiry.
        await sb
          .from("accounting_connections")
          .update({ token_expires_at: new Date(0).toISOString() })
          .eq("id", connId);
        pull = await buildPull();
        pulled = await runPulls(pull);
      }
      const [rawCustomers, rawInvoices, rawEstimates, rawPayments, rawItems] = pulled;

      // Item.Id → Item.Type catalog. Resolves each sales line's ItemRef.value
      // so applyImport can classify the line (Inventory/NonInventory → MATERIAL,
      // every other type → OTHER). Without this map, qb_item_type stays null and
      // every line lands as OTHER — the locked MATERIAL decision would be dead.
      const itemTypes = buildItemTypeMap(rawItems);

      // ── Customers ──────────────────────────────────────────────────────
      const customerRows = rawCustomers.map((c) => {
        const n = normalizeCustomer(c);
        return {
          run_id: runId,
          company_id: companyId,
          qb_id: n.qb_id,
          display_name: n.display_name,
          company_name: n.company_name,
          contact_name: n.contact_name,
          contact_title: n.contact_title,
          parent_qb_id: n.parent_qb_id,
          is_job: n.is_job,
          email: n.email,
          phone: n.phone,
          address: n.address,
          active: n.active,
          raw: n.raw,
        };
      });
      if (customerRows.length) {
        await sb
          .from("qbo_staging_customers")
          .upsert(customerRows, { onConflict: "run_id,qb_id" });
      }

      // ── Estimates (+ their lines) ──────────────────────────────────────
      const estimateRows: Record<string, unknown>[] = [];
      const lineRows: Record<string, unknown>[] = [];
      for (const e of rawEstimates) {
        const norm = normalizeEstimate(e, now, itemTypes);
        estimateRows.push({
          run_id: runId,
          company_id: companyId,
          qb_id: norm.staging.qb_id,
          doc_number: norm.staging.doc_number,
          customer_qb_id: norm.staging.customer_qb_id,
          txn_date: norm.staging.txn_date,
          expiration_date: norm.staging.expiration_date,
          txn_status: norm.staging.txn_status,
          subtotal: norm.staging.subtotal,
          tax_amount: norm.staging.tax_amount,
          tax_rate: norm.staging.tax_rate,
          total: norm.staging.total,
          raw: norm.staging.raw,
        });
        for (const l of norm.lines) {
          lineRows.push({
            run_id: runId,
            company_id: companyId,
            parent_type: l.parent_type,
            parent_qb_id: l.parent_qb_id,
            qb_line_id: l.qb_line_id,
            name: l.name,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            amount: l.amount,
            is_taxable: l.is_taxable,
            qb_item_type: l.qb_item_type,
            sort_order: l.sort_order,
          });
        }
      }
      if (estimateRows.length) {
        await sb
          .from("qbo_staging_estimates")
          .upsert(estimateRows, { onConflict: "run_id,qb_id" });
      }

      // ── Invoices (+ their lines; zero-total/void are staged but flagged) ─
      const invoiceRows: Record<string, unknown>[] = [];
      let skippedInvoiceCount = 0;
      for (const inv of rawInvoices) {
        const norm = normalizeInvoice(inv, now, itemTypes);
        if (norm.skipped) skippedInvoiceCount += 1;
        invoiceRows.push({
          run_id: runId,
          company_id: companyId,
          qb_id: norm.staging.qb_id,
          doc_number: norm.staging.doc_number,
          customer_qb_id: norm.staging.customer_qb_id,
          estimate_qb_id: norm.staging.estimate_qb_id,
          txn_date: norm.staging.txn_date,
          due_date: norm.staging.due_date,
          subtotal: norm.staging.subtotal,
          tax_amount: norm.staging.tax_amount,
          tax_rate: norm.staging.tax_rate,
          total: norm.staging.total,
          balance: norm.staging.balance,
          derived_status: norm.staging.derived_status,
          raw: norm.staging.raw,
        });
        for (const l of norm.lines) {
          lineRows.push({
            run_id: runId,
            company_id: companyId,
            parent_type: l.parent_type,
            parent_qb_id: l.parent_qb_id,
            qb_line_id: l.qb_line_id,
            name: l.name,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            amount: l.amount,
            is_taxable: l.is_taxable,
            qb_item_type: l.qb_item_type,
            sort_order: l.sort_order,
          });
        }
      }
      if (invoiceRows.length) {
        await sb
          .from("qbo_staging_invoices")
          .upsert(invoiceRows, { onConflict: "run_id,qb_id" });
      }
      await sb.from("qbo_staging_line_items").delete().eq("run_id", runId);
      if (lineRows.length) {
        // Line items have no UNIQUE on (run_id,qb_id), so clear this run's
        // previous staged lines before inserting. Retries must not double lines.
        await sb.from("qbo_staging_line_items").insert(lineRows);
      }

      // ── Payments (one row per payment; applied_lines holds the split) ──
      const paymentRows: Record<string, unknown>[] = [];
      for (const p of rawPayments) {
        const split = splitPaymentLines(p);
        paymentRows.push({
          run_id: runId,
          company_id: companyId,
          qb_id: split.qb_id,
          customer_qb_id: split.customer_qb_id,
          txn_date: split.txn_date,
          total_amt: split.total_amt,
          unapplied_amt: split.unappliedAmt,
          applied_lines: split.applied,
          raw: p,
        });
      }
      if (paymentRows.length) {
        await sb
          .from("qbo_staging_payments")
          .upsert(paymentRows, { onConflict: "run_id,qb_id" });
      }

      // ── Read-only assertion: zero QB writes ────────────────────────────
      const qbWriteCalls = pull.qbWriteCalls ?? 0;
      if (qbWriteCalls !== 0) {
        throw new Error(`Read-only violation: QB write calls = ${qbWriteCalls}`);
      }

      await this.setRun(runId, {
        status: "staged",
        qb_write_calls: qbWriteCalls,
        totals: {
          customers: customerRows.length,
          estimates: estimateRows.length,
          invoices: invoiceRows.length,
          lineItems: lineRows.length,
          payments: paymentRows.length,
          skippedInvoices: skippedInvoiceCount,
        },
      });
    } catch (err) {
      await this.setRun(runId, { status: "error", error: (err as Error).message });
      throw err;
    }
  }

  /**
   * Compute proposed customer matches for every staged customer in the run and
   * persist them to qbo_customer_matches. Reads existing clients (email/name)
   * and uses the pg_trgm RPC for the fuzzy step. Writes nothing to `clients`.
   */
  async computeCustomerMatches(runId: string): Promise<void> {
    const sb = this.supabase;
    const runRow = await this.getRun(runId);
    const companyId = runRow.company_id as string;

    const { data: staged } = await sb
      .from("qbo_staging_customers")
      .select("qb_id, display_name, company_name, email, phone")
      .eq("run_id", runId);

    const { data: existing } = await sb
      .from("clients")
      .select("id, name, email, phone_number, deleted_at, merged_into_client_id")
      .eq("company_id", companyId);

    const activeClients: ExistingClient[] = ((existing ?? []) as Record<string, unknown>[])
      .filter((c) => !c.deleted_at && !c.merged_into_client_id)
      .map((c) => ({
        id: c.id as string,
        name: c.name as string,
        email: (c.email as string) ?? null,
        phone_number: (c.phone_number as string) ?? null,
      }));

    const matchRows: Record<string, unknown>[] = [];
    for (const row of (staged ?? []) as Record<string, unknown>[]) {
      const displayName = (row.display_name as string) ?? null;
      const companyName = (row.company_name as string) ?? null;
      // Match on the company name for company-type customers (so they attach to
      // existing company clients); fall back to the display name for individuals.
      const matchName = companyName ?? displayName;
      const email = (row.email as string) ?? null;

      // Pre-check email/name so we only hit the fuzzy RPC when needed.
      const hasEmailHit =
        !!email &&
        activeClients.some((c) => (c.email ?? "").trim().toLowerCase() === email.trim().toLowerCase());
      let fuzzy: FuzzyCandidate[] = [];
      if (!hasEmailHit && matchName) {
        const { data: candidates } = await sb.rpc("qbo_match_customer_candidates", {
          p_company_id: companyId,
          p_name: matchName,
          p_threshold: FUZZY_THRESHOLD,
        });
        fuzzy = ((candidates as FuzzyCandidate[]) ?? []).map((c) => ({
          client_id: c.client_id,
          name: c.name,
          email: c.email ?? null,
          phone_number: c.phone_number ?? null,
          similarity: Number(c.similarity),
        }));
      }

      const result = resolveCustomerMatch(
        { qb_id: row.qb_id as string, display_name: matchName, email, phone: (row.phone as string) ?? null },
        activeClients,
        fuzzy
      );

      matchRows.push({
        run_id: runId,
        company_id: companyId,
        customer_qb_id: result.customer_qb_id,
        proposed_action: result.proposed_action,
        matched_client_id: result.matched_client_id,
        match_basis: result.match_basis,
        confidence: result.confidence,
        candidates: result.candidates,
      });
    }

    if (matchRows.length) {
      await sb
        .from("qbo_customer_matches")
        .upsert(matchRows, { onConflict: "run_id,customer_qb_id" });
    }
  }

  /** Build the QboImportReview aggregate (run + matches + counts + reconciliation). */
  async getImportReview(runId: string): Promise<QboImportReview> {
    const sb = this.supabase;
    const runRow = await this.getRun(runId);
    const run = mapRun(runRow);

    const [
      { data: matchData },
      { data: invoiceData },
      { data: paymentData },
      { data: estimateData },
      { data: customerData },
      { data: lineData },
    ] = await Promise.all([
      sb.from("qbo_customer_matches").select("*").eq("run_id", runId),
      sb.from("qbo_staging_invoices").select("*").eq("run_id", runId),
      sb.from("qbo_staging_payments").select("*").eq("run_id", runId),
      sb.from("qbo_staging_estimates").select("qb_id").eq("run_id", runId),
      sb.from("qbo_staging_customers")
        .select("qb_id, display_name, company_name, contact_name, is_job")
        .eq("run_id", runId),
      sb.from("qbo_staging_line_items").select("id").eq("run_id", runId),
    ]);

    const rawMatches = (matchData ?? []) as Record<string, unknown>[];
    const invoices = (invoiceData ?? []) as unknown as QboStagedInvoice[];
    const payments = (paymentData ?? []) as unknown as QboStagedPayment[];
    const customerRows = (customerData ?? []) as Record<string, unknown>[];
    const customerCount = customerRows.length;

    // Join each match to its full staged QB customer row (for the company/contact
    // label + the displayName preference) and map snake_case -> camelCase for the
    // UI. buildMatchCounts reads the raw snake rows, so it is fed rawMatches.
    const stagingByQbId = new Map<string, Record<string, unknown>>(
      customerRows.map((c) => [c.qb_id as string, c])
    );
    const matches: QboCustomerMatch[] = rawMatches.map((r) =>
      mapCustomerMatch(r, stagingByQbId)
    );

    return {
      run,
      matches,
      matchCounts: buildMatchCounts(rawMatches as unknown as QboCustomerMatch[]),
      stagedCounts: buildStagedCounts({
        customers: customerCount,
        estimates: (estimateData ?? []).length,
        invoices,
        lineItems: (lineData ?? []).length,
        payments,
        customerRows,
      }),
      reconciliation: buildReconciliation(invoices, payments, customerCount),
    };
  }

  /**
   * Apply a staged import run into live tables, in the locked transactional
   * order (contract §8). Idempotent on (company_id, qb_id). Issues ZERO calls
   * to QuickBooks — operates entirely on staged rows.
   */
  async applyImport(runId: string, decisions: QboApplyDecision[]): Promise<QboApplyResult> {
    const sb = this.supabase;

    const { data: run } = await sb
      .from("qbo_import_runs")
      .select("id, company_id")
      .eq("id", runId)
      .single();
    if (!run) throw new Error(`Import run not found: ${runId}`);
    const companyId = run.company_id as string;

    await sb.from("qbo_import_runs").update({ status: "applying" }).eq("id", runId);

    try {
      return await this.applyStagedRows(sb, runId, companyId, decisions);
    } catch (err) {
      // A write failed mid-apply — mark the run errored. Never leave it stuck
      // in 'applying', and never let a failed write masquerade as 'applied'.
      const msg = err instanceof Error ? err.message : String(err);
      await sb
        .from("qbo_import_runs")
        .update({ status: "error", error: msg, finished_at: new Date().toISOString() })
        .eq("id", runId);
      throw err;
    }
  }

  /**
   * Apply a staged run's rows into the live tables (STEP 1–5). Split out of
   * applyImport so the latter can wrap it in a run-level error guard. Every
   * write is checked via assertNoWriteError, so a failed upsert/insert/update
   * aborts the run loudly instead of being swallowed and reported as success.
   */
  private async applyStagedRows(
    sb: SupabaseClient,
    runId: string,
    companyId: string,
    decisions: QboApplyDecision[]
  ): Promise<QboApplyResult> {
    // ── Load all staged rows for this run ──────────────────────────────────
    const { data: stagedCustomers } = await sb
      .from("qbo_staging_customers").select("*").eq("run_id", runId);
    const { data: stagedEstimates } = await sb
      .from("qbo_staging_estimates").select("*").eq("run_id", runId);
    const { data: stagedInvoices } = await sb
      .from("qbo_staging_invoices").select("*").eq("run_id", runId);
    const { data: stagedLines } = await sb
      .from("qbo_staging_line_items").select("*").eq("run_id", runId);
    const { data: stagedPayments } = await sb
      .from("qbo_staging_payments").select("*").eq("run_id", runId);

    const result: QboApplyResult = {
      clientsLinked: 0, clientsCreated: 0, clientsSkipped: 0, subClientsCreated: 0,
      estimatesUpserted: 0, invoicesUpserted: 0, lineItemsInserted: 0,
      paymentsUpserted: 0, invoicesReconciled: 0, qb_write_calls: 0,
    };

    // Single `now` for all date-derived status (canonical fns take a Date).
    const now = new Date();
    // Non-fatal warnings (I8 subtotal divergence, C4 cross-tenant link, etc.)
    // surfaced on the run's totals.error summary without blocking the apply.
    const warnings: string[] = [];

    const decisionByQbId = new Map(decisions.map((d) => [d.customer_qb_id, d]));
    // customer_qb_id → resolved OPS client_id (null === skipped)
    const clientIdByCustomerQbId = new Map<string, string | null>();

    // Staged row (snake) → CustomerShape for the shared field-shaping helpers
    // (clientFieldsFromCustomer / subClientFieldsFromCustomer) — the SAME helpers
    // the webhook applyCustomer uses, so both apply paths emit identical rows.
    const toShape = (cust: Record<string, unknown>): CustomerShape => ({
      company_name: (cust.company_name as string) ?? null,
      contact_name: (cust.contact_name as string) ?? null,
      display_name: (cust.display_name as string) ?? null,
      email: (cust.email as string) ?? null,
      phone: (cust.phone as string) ?? null,
      address: (cust.address as string) ?? null,
      is_job: (cust.is_job as boolean) ?? null,
    });

    // ── STEP 1: Clients (link / create / skip) ─────────────────────────────
    for (const cust of stagedCustomers ?? []) {
      const decision = decisionByQbId.get(cust.qb_id as string);
      const action = decision?.action ?? "skip";

      if (action === "skip" || action === "needs_review") {
        clientIdByCustomerQbId.set(cust.qb_id as string, null);
        result.clientsSkipped++;
        continue;
      }

      if (action === "link") {
        const clientId = decision?.client_id;
        if (!clientId) {
          clientIdByCustomerQbId.set(cust.qb_id as string, null);
          result.clientsSkipped++;
          continue;
        }
        // C4: the link target MUST belong to this company. Verify ownership
        // before writing — a decision referencing another tenant's client id
        // is treated as a skip and recorded as an error on the run.
        const { data: target } = await sb
          .from("clients")
          .select("id")
          .eq("id", clientId)
          .eq("company_id", companyId)
          .maybeSingle();
        if (!target?.id) {
          warnings.push(
            `Link rejected for customer ${cust.qb_id}: client ${clientId} does not belong to company ${companyId}`
          );
          clientIdByCustomerQbId.set(cust.qb_id as string, null);
          result.clientsSkipped++;
          continue;
        }
        // Link writes ONLY qb_id — never overwrite name/email/phone/address.
        // Company-scoped (C4): never touch a row outside the caller's tenant.
        await this.suppressAccountingSync(companyId, "customer", clientId);
        assertNoWriteError(
          await sb
            .from("clients")
            .update({ qb_id: cust.qb_id })
            .eq("id", clientId)
            .eq("company_id", companyId),
          "clients.link"
        );
        clientIdByCustomerQbId.set(cust.qb_id as string, clientId);
        result.clientsLinked++;
        continue;
      }

      // action === "create" — idempotent on (company_id, qb_id)
      const { data: existing } = await sb
        .from("clients")
        .select("id")
        .eq("company_id", companyId)
        .eq("qb_id", cust.qb_id)
        .maybeSingle();

      if (existing?.id) {
        clientIdByCustomerQbId.set(cust.qb_id as string, existing.id as string);
        result.clientsCreated++; // counts as an applied create even on re-run
        continue;
      }

      // Company-aware field shaping — SAME helper the webhook path uses (Task 6B).
      const newId = crypto.randomUUID();
      const clientId = await this.persistQboMappedRow({
        table: "clients",
        existingId: null,
        syncEntityType: "customer",
        context: "clients.create",
        row: {
          id: newId,
          company_id: companyId,
          qb_id: cust.qb_id,
          ...clientFieldsFromCustomer(toShape(cust)),
        },
      });
      clientIdByCustomerQbId.set(cust.qb_id as string, clientId);
      result.clientsCreated++;
    }

    // ── STEP 1b: Contact sub-clients for company-type customers ────────────
    // One sub_client per QB customer with a CompanyName + a contact person.
    // Keyed (company_id, qb_id) so re-import upserts in place. Runs for both
    // linked and created parents; skipped/needs_review customers have a null
    // clientId and are ignored. subClientFieldsFromCustomer returns null for
    // individuals, contact-less companies, and QB Jobs (Decision 3).
    for (const cust of stagedCustomers ?? []) {
      const clientId = clientIdByCustomerQbId.get(cust.qb_id as string);
      const fields = subClientFieldsFromCustomer(toShape(cust));
      if (!clientId || !fields) continue;
      const { data: existingSubClient } = await sb
        .from("sub_clients")
        .select("id")
        .eq("company_id", companyId)
        .eq("qb_id", cust.qb_id)
        .maybeSingle();
      const subClientId = (existingSubClient?.id as string | undefined) ?? crypto.randomUUID();
      await this.persistQboMappedRow({
        table: "sub_clients",
        existingId: (existingSubClient?.id as string | undefined) ?? null,
        syncEntityType: "customer",
        context: "sub_clients.upsert",
        row: { id: subClientId, company_id: companyId, client_id: clientId, qb_id: cust.qb_id, ...fields },
      });
      result.subClientsCreated++;
    }

    // ── STEP 2: Estimate + invoice HEADERS (QB-authoritative totals) ────────
    // Sum of staged line `amount` per parent qb_id, for the I8 divergence guard.
    const lineAmountByParent = new Map<string, number>();
    for (const line of stagedLines ?? []) {
      const key = `${line.parent_type}:${line.parent_qb_id}`;
      lineAmountByParent.set(key, (lineAmountByParent.get(key) ?? 0) + Number(line.amount ?? 0));
    }

    const estimateIdByQbId = new Map<string, string>();
    for (const est of stagedEstimates ?? []) {
      const clientId = clientIdByCustomerQbId.get(est.customer_qb_id as string);
      if (!clientId) continue; // customer skipped → drop estimate

      const status = mapEstimateStatus(
        est.txn_status as string | null,
        est.expiration_date as string | null,
        now
      );
      // C3: estimate_number/subtotal/tax_amount/total are NOT NULL.
      const estimateNumber = (est.doc_number as string | null) ?? `QB-${est.qb_id}`;
      const subtotal = Number(est.subtotal ?? 0);
      // I8: warn (non-fatal) if Σ line amounts diverge from the header subtotal.
      const lineSum = round2(lineAmountByParent.get(`estimate:${est.qb_id}`) ?? 0);
      if (round2(subtotal) !== lineSum) {
        warnings.push(
          `Estimate ${est.qb_id} subtotal divergence: Σ lines ${lineSum} ≠ subtotal ${round2(subtotal)}`
        );
      }
      const { data: existingEstimate } = await sb
        .from("estimates")
        .select("id")
        .eq("company_id", companyId)
        .eq("qb_id", est.qb_id)
        .maybeSingle();
      const estId = (existingEstimate?.id as string | undefined) ?? crypto.randomUUID();
      const estimateRow: Record<string, unknown> = {
        id: estId,
        company_id: companyId,
        qb_id: est.qb_id,
        client_id: clientId,
        estimate_number: estimateNumber,
        subtotal,
        tax_rate: est.tax_rate ?? null,
        tax_amount: Number(est.tax_amount ?? 0),
        total: Number(est.total ?? 0),
        status,
        expiration_date: est.expiration_date ?? null,
      };
      // issue_date is NOT NULL DEFAULT CURRENT_DATE: send the QB txn_date, or
      // omit the key entirely so the default applies — never send null (C3).
      if (est.txn_date) estimateRow.issue_date = est.txn_date;
      const resolved = await this.persistQboMappedRow({
        table: "estimates",
        existingId: (existingEstimate?.id as string | undefined) ?? null,
        syncEntityType: "estimate",
        context: "estimates.upsert",
        row: estimateRow,
      });
      estimateIdByQbId.set(est.qb_id as string, resolved);
      result.estimatesUpserted++;
    }

    const invoiceIdByQbId = new Map<string, string>();
    for (const inv of stagedInvoices ?? []) {
      // C2: voided / zero-total invoices were staged for the review report but
      // are NEVER applied — skip header upsert, line items, and reconcile.
      if (inv.derived_status === "skipped") continue;

      const clientId = clientIdByCustomerQbId.get(inv.customer_qb_id as string);
      if (!clientId) continue; // customer skipped → drop invoice

      const total = Number(inv.total ?? 0);
      const balance = Number(inv.balance ?? 0);
      // Canonical signature is (balance, total, dueDate, now). due_date is
      // NOT NULL in OPS — fall back to the issue date when QB omits it (C3).
      const dueDate = (inv.due_date as string | null) ?? (inv.txn_date as string | null);
      const status = deriveInvoiceStatus(balance, total, dueDate, now);
      const estimateId = inv.estimate_qb_id
        ? estimateIdByQbId.get(inv.estimate_qb_id as string) ?? null
        : null;

      // C3: invoice_number/due_date/subtotal/tax_amount/total are NOT NULL.
      const invoiceNumber = (inv.doc_number as string | null) ?? `QB-${inv.qb_id}`;
      const subtotal = Number(inv.subtotal ?? 0);
      // I8: warn (non-fatal) if Σ line amounts diverge from the header subtotal.
      const lineSum = round2(lineAmountByParent.get(`invoice:${inv.qb_id}`) ?? 0);
      if (round2(subtotal) !== lineSum) {
        warnings.push(
          `Invoice ${inv.qb_id} subtotal divergence: Σ lines ${lineSum} ≠ subtotal ${round2(subtotal)}`
        );
      }

      const { data: existingInvoice } = await sb
        .from("invoices")
        .select("id")
        .eq("company_id", companyId)
        .eq("qb_id", inv.qb_id)
        .maybeSingle();
      const invId = (existingInvoice?.id as string | undefined) ?? crypto.randomUUID();
      const invoiceRow: Record<string, unknown> = {
        id: invId,
        company_id: companyId,
        qb_id: inv.qb_id,
        client_id: clientId,
        estimate_id: estimateId,
        invoice_number: invoiceNumber,
        subtotal,
        tax_rate: inv.tax_rate ?? null,
        tax_amount: Number(inv.tax_amount ?? 0),
        total,
        status, // provisional; reconciled in STEP 5
        due_date: dueDate, // never null (C3)
      };
      // issue_date is NOT NULL DEFAULT CURRENT_DATE: send the QB txn_date, or
      // omit the key entirely so the default applies — never send null (C3).
      if (inv.txn_date) invoiceRow.issue_date = inv.txn_date;
      const resolved = await this.persistQboMappedRow({
        table: "invoices",
        existingId: (existingInvoice?.id as string | undefined) ?? null,
        syncEntityType: "invoice",
        context: "invoices.upsert",
        row: invoiceRow,
      });
      invoiceIdByQbId.set(inv.qb_id as string, resolved);
      result.invoicesUpserted++;
    }

    // ── STEP 3: Line items (locked delete-by-parent then reinsert) ──────────
    // line_total is GENERATED — never inserted. The replacement RPC serializes
    // duplicate applies/webhooks per invoice or estimate parent.
    for (const [invoiceQbId, invoiceId] of invoiceIdByQbId) {
      const lines = (stagedLines ?? []).filter(
        (line) => line.parent_type === "invoice" && line.parent_qb_id === invoiceQbId
      ) as Array<Record<string, unknown>>;
      result.lineItemsInserted += await this.replaceImportLineItems(companyId, { invoiceId }, lines);
    }
    for (const [estimateQbId, estimateId] of estimateIdByQbId) {
      const lines = (stagedLines ?? []).filter(
        (line) => line.parent_type === "estimate" && line.parent_qb_id === estimateQbId
      ) as Array<Record<string, unknown>>;
      result.lineItemsInserted += await this.replaceImportLineItems(companyId, { estimateId }, lines);
    }

    // ── STEP 4: Payments (one OPS row per linked invoice line) ─────────────
    // Each insert fires trg_payment_balance -> update_invoice_balance(),
    // recomputing amount_paid/balance_due/status from in-window payments.
    for (const pmt of stagedPayments ?? []) {
      const clientId = clientIdByCustomerQbId.get(pmt.customer_qb_id as string) ?? null;
      const lines = (pmt.applied_lines as Array<{
        invoice_qb_id: string; amount: number; reference_number?: string;
      }>) ?? [];

      for (const l of lines) {
        const invoiceId = invoiceIdByQbId.get(l.invoice_qb_id) ?? null;
        if (!invoiceId) continue; // payment line references a dropped/absent invoice
        await this.suppressAccountingSync(companyId, "invoice", invoiceId);
        await this.persistPaymentLine({
          companyId,
          rawPaymentQbId: pmt.qb_id as string,
          invoiceQbId: l.invoice_qb_id,
          row: {
            id: crypto.randomUUID(),
            company_id: companyId,
            invoice_id: invoiceId,
            client_id: clientId,
            amount: l.amount,
            payment_date: pmt.txn_date ?? null,
            reference_number: l.reference_number ?? null,
            payment_method: null,
          },
        });
        result.paymentsUpserted++;
      }
    }

    // ── STEP 5: Reconcile invoices to QB-authoritative Balance ─────────────
    for (const inv of stagedInvoices ?? []) {
      // C2: never reconcile a skipped (voided/zero-total) invoice — and they
      // were never upserted, so they have no invoiceIdByQbId entry anyway.
      if (inv.derived_status === "skipped") continue;
      const invoiceId = invoiceIdByQbId.get(inv.qb_id as string);
      if (!invoiceId) continue;
      const total = Number(inv.total ?? 0);
      const balance = Number(inv.balance ?? 0);
      const amountPaid = round2(total - balance);
      const dueDate = (inv.due_date as string | null) ?? (inv.txn_date as string | null);
      const status = deriveInvoiceStatus(balance, total, dueDate, now);
      await this.suppressAccountingSync(companyId, "invoice", invoiceId);
      assertNoWriteError(
        await sb.from("invoices").update({
          amount_paid: amountPaid,
          balance_due: balance,
          status,
          paid_at: balance <= 0 ? new Date().toISOString() : null,
        }).eq("id", invoiceId),
        "invoices.reconcile"
      );
      result.invoicesReconciled++;
    }

    await sb.from("qbo_import_runs").update({
      status: "applied",
      totals: result as unknown as Record<string, number>,
      // I8/C4: non-fatal warnings (subtotal divergence, rejected links) are
      // surfaced on the run's error summary without failing the apply.
      error: warnings.length ? warnings.join("; ") : null,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);

    return result;
  }
}

export type { QboStagedCustomer };
