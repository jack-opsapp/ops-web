/**
 * OPS Web - QuickBooks Import Service (read-only pull → stage → match → review)
 *
 * Drives the A1 read-only pull, normalizes QB JSON into the qbo_staging_* tables
 * (qbo-normalize), proposes customer matches (qbo-match + pg_trgm RPC), and
 * builds the QboImportReview aggregate (qbo-reconcile). applyImport is A3.
 *
 * READ-ONLY: the only QB calls go through QuickBooksPullService (GET only); the
 * run records qb_write_calls and asserts it stays 0.
 *
 * Mirrors sync-orchestrator's service-role + AccountingTokenService usage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AccountingTokenService } from "./accounting-token-service";
import { QuickBooksPullService } from "./quickbooks-pull-service";
import {
  normalizeCustomer,
  normalizeInvoice,
  normalizeEstimate,
  splitPaymentLines,
} from "./qbo-normalize";
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
} from "@/lib/types/qbo-import";

const QB_ENVIRONMENT = (process.env.QB_ENVIRONMENT as "production" | "sandbox") ?? "production";
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

function cutoffISODate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - HISTORY_MONTHS);
  return d.toISOString().slice(0, 10);
}

async function getRun(supabase: SupabaseClient, runId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("qbo_import_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (error || !data) throw new Error(`Import run not found: ${runId}`);
  return data as Record<string, unknown>;
}

async function setRun(
  supabase: SupabaseClient,
  runId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await supabase.from("qbo_import_runs").update(patch).eq("id", runId);
}

export const QuickBooksImportService = {
  /** Create a pending run for the company. */
  async startImportRun(supabase: SupabaseClient, companyId: string): Promise<QboImportRun> {
    const { data, error } = await supabase
      .from("qbo_import_runs")
      .insert({
        company_id: companyId,
        provider: "quickbooks",
        status: "pending",
        history_cutoff: cutoffISODate(),
        qb_write_calls: 0,
        totals: {},
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(`Failed to start import run: ${error?.message}`);
    return mapRun(data as Record<string, unknown>);
  },

  /**
   * Pull from QB (GET only) and normalize into qbo_staging_*.
   * Idempotent on (run_id, qb_id) — staging UNIQUE constraints absorb retries
   * via upsert. Leaves the run in 'staged' (or 'error').
   */
  async pullAndStage(supabase: SupabaseClient, runId: string): Promise<void> {
    const runRow = await getRun(supabase, runId);
    const companyId = runRow.company_id as string;
    const cutoff = (runRow.history_cutoff as string) ?? cutoffISODate();

    // Resolve the connection + a valid token (refreshes if needed).
    const { data: conn, error: connErr } = await supabase
      .from("accounting_connections")
      .select("id, realm_id")
      .eq("company_id", companyId)
      .eq("provider", "quickbooks")
      .single();
    if (connErr || !conn) throw new Error(`No QuickBooks connection for company ${companyId}`);

    await setRun(supabase, runId, { status: "pulling" });

    try {
      const { accessToken, realmId } = await AccountingTokenService.getValidToken(
        supabase,
        conn.id as string
      );
      if (!realmId) throw new Error("QuickBooks realmId not found on connection");

      const pull = new QuickBooksPullService(realmId, accessToken, QB_ENVIRONMENT);
      const now = new Date();

      const [rawCustomers, rawInvoices, rawEstimates, rawPayments] = await Promise.all([
        pull.pullCustomers(),
        pull.pullInvoices(cutoff),
        pull.pullEstimates(cutoff),
        pull.pullPayments(cutoff),
      ]);

      // ── Customers ──────────────────────────────────────────────────────
      const customerRows = rawCustomers.map((c) => {
        const n = normalizeCustomer(c);
        return {
          run_id: runId,
          company_id: companyId,
          qb_id: n.qb_id,
          display_name: n.display_name,
          email: n.email,
          phone: n.phone,
          address: n.address,
          active: n.active,
          raw: n.raw,
        };
      });
      if (customerRows.length) {
        await supabase
          .from("qbo_staging_customers")
          .upsert(customerRows, { onConflict: "run_id,qb_id" });
      }

      // ── Estimates (+ their lines) ──────────────────────────────────────
      const estimateRows: Record<string, unknown>[] = [];
      const lineRows: Record<string, unknown>[] = [];
      for (const e of rawEstimates) {
        const norm = normalizeEstimate(e, now);
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
        await supabase
          .from("qbo_staging_estimates")
          .upsert(estimateRows, { onConflict: "run_id,qb_id" });
      }

      // ── Invoices (+ their lines; zero-total/void are staged but flagged) ─
      const invoiceRows: Record<string, unknown>[] = [];
      let skippedInvoiceCount = 0;
      for (const inv of rawInvoices) {
        const norm = normalizeInvoice(inv, now);
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
        await supabase
          .from("qbo_staging_invoices")
          .upsert(invoiceRows, { onConflict: "run_id,qb_id" });
      }
      if (lineRows.length) {
        // Line items have no UNIQUE on (run_id,qb_id); insert is fine because a
        // run is staged once. Re-running a run re-uses startImportRun → new run_id.
        await supabase.from("qbo_staging_line_items").insert(lineRows);
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
        await supabase
          .from("qbo_staging_payments")
          .upsert(paymentRows, { onConflict: "run_id,qb_id" });
      }

      // ── Read-only assertion: zero QB writes ────────────────────────────
      const qbWriteCalls = pull.qbWriteCalls ?? 0;
      if (qbWriteCalls !== 0) {
        throw new Error(`Read-only violation: QB write calls = ${qbWriteCalls}`);
      }

      await setRun(supabase, runId, {
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
      await setRun(supabase, runId, { status: "error", error: (err as Error).message });
      throw err;
    }
  },

  /**
   * Compute proposed customer matches for every staged customer in the run and
   * persist them to qbo_customer_matches. Reads existing clients (email/name)
   * and uses the pg_trgm RPC for the fuzzy step. Writes nothing to `clients`.
   */
  async computeCustomerMatches(supabase: SupabaseClient, runId: string): Promise<void> {
    const runRow = await getRun(supabase, runId);
    const companyId = runRow.company_id as string;

    const { data: staged } = await supabase
      .from("qbo_staging_customers")
      .select("qb_id, display_name, email, phone")
      .eq("run_id", runId);

    const { data: existing } = await supabase
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
      const email = (row.email as string) ?? null;

      // Pre-check email/name so we only hit the fuzzy RPC when needed.
      const hasEmailHit =
        !!email &&
        activeClients.some((c) => (c.email ?? "").trim().toLowerCase() === email.trim().toLowerCase());
      let fuzzy: FuzzyCandidate[] = [];
      if (!hasEmailHit && displayName) {
        const { data: candidates } = await supabase.rpc("qbo_match_customer_candidates", {
          p_company_id: companyId,
          p_name: displayName,
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
        { qb_id: row.qb_id as string, display_name: displayName, email, phone: (row.phone as string) ?? null },
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
      await supabase
        .from("qbo_customer_matches")
        .upsert(matchRows, { onConflict: "run_id,customer_qb_id" });
    }
  },

  /** Build the QboImportReview aggregate (run + matches + counts + reconciliation). */
  async getImportReview(supabase: SupabaseClient, runId: string): Promise<QboImportReview> {
    const runRow = await getRun(supabase, runId);
    const run = mapRun(runRow);

    const [
      { data: matchData },
      { data: invoiceData },
      { data: paymentData },
      { data: estimateData },
      { data: customerData },
      { data: lineData },
    ] = await Promise.all([
      supabase.from("qbo_customer_matches").select("*").eq("run_id", runId),
      supabase.from("qbo_staging_invoices").select("*").eq("run_id", runId),
      supabase.from("qbo_staging_payments").select("*").eq("run_id", runId),
      supabase.from("qbo_staging_estimates").select("qb_id").eq("run_id", runId),
      supabase.from("qbo_staging_customers").select("qb_id").eq("run_id", runId),
      supabase.from("qbo_staging_line_items").select("id").eq("run_id", runId),
    ]);

    const matches = (matchData ?? []) as unknown as QboCustomerMatch[];
    const invoices = (invoiceData ?? []) as unknown as QboStagedInvoice[];
    const payments = (paymentData ?? []) as unknown as QboStagedPayment[];
    const customerCount = (customerData ?? []).length;

    return {
      run,
      matches,
      matchCounts: buildMatchCounts(matches),
      stagedCounts: buildStagedCounts({
        customers: customerCount,
        estimates: (estimateData ?? []).length,
        invoices,
        lineItems: (lineData ?? []).length,
        payments,
      }),
      reconciliation: buildReconciliation(invoices, payments, customerCount),
    };
  },

  /** APPLY is implemented in phase A3. */
  async applyImport(
    _supabase: SupabaseClient,
    _runId: string,
    _decisions: QboApplyDecision[]
  ): Promise<{ applied: Record<string, number> }> {
    throw new Error("applyImport is implemented in phase A3");
  },
};

export type { QboStagedCustomer };
