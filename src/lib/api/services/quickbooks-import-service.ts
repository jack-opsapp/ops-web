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
  QboApplyResult,
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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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

  /** Create a pending run for the company. */
  async startImportRun(companyId: string): Promise<QboImportRun> {
    const { data, error } = await this.supabase
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
    const cutoff = (runRow.history_cutoff as string) ?? cutoffISODate();

    // Resolve the connection + a valid token (refreshes if needed).
    const { data: conn, error: connErr } = await sb
      .from("accounting_connections")
      .select("id, realm_id")
      .eq("company_id", companyId)
      .eq("provider", "quickbooks")
      .single();
    if (connErr || !conn) throw new Error(`No QuickBooks connection for company ${companyId}`);

    await this.setRun(runId, { status: "pulling" });

    try {
      const { accessToken, realmId } = await AccountingTokenService.getValidToken(
        sb,
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
        await sb
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
        await sb
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
        await sb
          .from("qbo_staging_invoices")
          .upsert(invoiceRows, { onConflict: "run_id,qb_id" });
      }
      if (lineRows.length) {
        // Line items have no UNIQUE on (run_id,qb_id); insert is fine because a
        // run is staged once. Re-running a run re-uses startImportRun → new run_id.
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
      .select("qb_id, display_name, email, phone")
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
      const email = (row.email as string) ?? null;

      // Pre-check email/name so we only hit the fuzzy RPC when needed.
      const hasEmailHit =
        !!email &&
        activeClients.some((c) => (c.email ?? "").trim().toLowerCase() === email.trim().toLowerCase());
      let fuzzy: FuzzyCandidate[] = [];
      if (!hasEmailHit && displayName) {
        const { data: candidates } = await sb.rpc("qbo_match_customer_candidates", {
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
      sb.from("qbo_staging_customers").select("qb_id").eq("run_id", runId),
      sb.from("qbo_staging_line_items").select("id").eq("run_id", runId),
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
  }

  /**
   * Derive OPS invoice status from QB Balance / Total / DueDate.
   * Voided / zero-total invoices are filtered upstream (never staged as live).
   */
  private deriveInvoiceStatus(total: number, balance: number, dueDate: string | null): string {
    if (balance <= 0) return "paid";
    if (balance < total) return "partially_paid";
    if (dueDate) {
      const today = new Date().toISOString().slice(0, 10);
      if (dueDate < today) return "past_due";
    }
    return "awaiting_payment";
  }

  private mapEstimateStatus(txnStatus: string | null, expirationDate: string | null): string {
    const today = new Date().toISOString().slice(0, 10);
    switch (txnStatus) {
      case "Accepted": return "approved";
      case "Closed":   return "converted";
      case "Rejected": return "declined";
      case "Pending":
      default:
        if (expirationDate && expirationDate < today) return "expired";
        return "sent";
    }
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
      clientsLinked: 0, clientsCreated: 0, clientsSkipped: 0,
      estimatesUpserted: 0, invoicesUpserted: 0, lineItemsInserted: 0,
      paymentsUpserted: 0, invoicesReconciled: 0, qb_write_calls: 0,
    };

    const decisionByQbId = new Map(decisions.map((d) => [d.customer_qb_id, d]));
    // customer_qb_id → resolved OPS client_id (null === skipped)
    const clientIdByCustomerQbId = new Map<string, string | null>();

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
        // Link writes ONLY qb_id — never overwrite name/email/phone/address.
        await sb.from("clients").update({ qb_id: cust.qb_id }).eq("id", clientId);
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

      const newId = crypto.randomUUID();
      await sb.from("clients").upsert(
        {
          id: newId,
          company_id: companyId,
          qb_id: cust.qb_id,
          name: cust.display_name ?? "QuickBooks customer",
          email: cust.email ?? null,
          phone_number: cust.phone ?? null,
          address: cust.address ?? null,
        },
        { onConflict: "company_id,qb_id" }
      );
      const { data: created } = await sb
        .from("clients").select("id")
        .eq("company_id", companyId).eq("qb_id", cust.qb_id).maybeSingle();
      clientIdByCustomerQbId.set(cust.qb_id as string, (created?.id as string) ?? newId);
      result.clientsCreated++;
    }

    // ── STEP 2: Estimate + invoice HEADERS (QB-authoritative totals) ────────
    const estimateIdByQbId = new Map<string, string>();
    for (const est of stagedEstimates ?? []) {
      const clientId = clientIdByCustomerQbId.get(est.customer_qb_id as string);
      if (!clientId) continue; // customer skipped → drop estimate

      const status = this.mapEstimateStatus(
        est.txn_status as string | null,
        est.expiration_date as string | null
      );
      const estId = crypto.randomUUID();
      await sb.from("estimates").upsert(
        {
          id: estId,
          company_id: companyId,
          qb_id: est.qb_id,
          client_id: clientId,
          estimate_number: est.doc_number ?? null,
          subtotal: est.subtotal ?? null,
          tax_rate: est.tax_rate ?? null,
          tax_amount: est.tax_amount ?? null,
          total: est.total ?? null,
          status,
          issue_date: est.txn_date ?? null,
          expiration_date: est.expiration_date ?? null,
        },
        { onConflict: "company_id,qb_id" }
      );
      const { data: row } = await sb
        .from("estimates").select("id")
        .eq("company_id", companyId).eq("qb_id", est.qb_id).maybeSingle();
      const resolved = (row?.id as string) ?? estId;
      estimateIdByQbId.set(est.qb_id as string, resolved);
      result.estimatesUpserted++;
    }

    const invoiceIdByQbId = new Map<string, string>();
    for (const inv of stagedInvoices ?? []) {
      const clientId = clientIdByCustomerQbId.get(inv.customer_qb_id as string);
      if (!clientId) continue; // customer skipped → drop invoice

      const total = Number(inv.total ?? 0);
      const balance = Number(inv.balance ?? 0);
      const status = this.deriveInvoiceStatus(total, balance, inv.due_date as string | null);
      const estimateId = inv.estimate_qb_id
        ? estimateIdByQbId.get(inv.estimate_qb_id as string) ?? null
        : null;

      const invId = crypto.randomUUID();
      await sb.from("invoices").upsert(
        {
          id: invId,
          company_id: companyId,
          qb_id: inv.qb_id,
          client_id: clientId,
          estimate_id: estimateId,
          invoice_number: inv.doc_number ?? null,
          subtotal: inv.subtotal ?? null,
          tax_rate: inv.tax_rate ?? null,
          tax_amount: inv.tax_amount ?? null,
          total: inv.total ?? null,
          status, // provisional; reconciled in STEP 5
          issue_date: inv.txn_date ?? null,
          due_date: inv.due_date ?? null,
        },
        { onConflict: "company_id,qb_id" }
      );
      const { data: row } = await sb
        .from("invoices").select("id")
        .eq("company_id", companyId).eq("qb_id", inv.qb_id).maybeSingle();
      const resolved = (row?.id as string) ?? invId;
      invoiceIdByQbId.set(inv.qb_id as string, resolved);
      result.invoicesUpserted++;
    }

    // ── STEP 3: Line items (delete-by-parent then reinsert) ────────────────
    // line_total is GENERATED — never inserted. No triggers — purely additive.
    const appliedInvoiceIds = [...invoiceIdByQbId.values()];
    const appliedEstimateIds = [...estimateIdByQbId.values()];
    if (appliedInvoiceIds.length) {
      await sb.from("line_items").delete().in("invoice_id", appliedInvoiceIds);
    }
    if (appliedEstimateIds.length) {
      await sb.from("line_items").delete().in("estimate_id", appliedEstimateIds);
    }

    for (const line of stagedLines ?? []) {
      let parentInvoiceId: string | null = null;
      let parentEstimateId: string | null = null;
      if (line.parent_type === "invoice") {
        parentInvoiceId = invoiceIdByQbId.get(line.parent_qb_id as string) ?? null;
        if (!parentInvoiceId) continue; // parent dropped (skipped customer)
      } else {
        parentEstimateId = estimateIdByQbId.get(line.parent_qb_id as string) ?? null;
        if (!parentEstimateId) continue;
      }

      const itemType = line.qb_item_type as string | null;
      const opsType =
        itemType === "Inventory" || itemType === "NonInventory" ? "MATERIAL" : "OTHER";

      await sb.from("line_items").insert({
        company_id: companyId,
        estimate_id: parentEstimateId,
        invoice_id: parentInvoiceId,
        product_id: null,
        name: line.name ?? "Line item",
        description: line.description ?? null,
        quantity: line.quantity ?? 1,
        unit: null,
        unit_price: line.unit_price ?? 0,
        // line_total intentionally omitted — GENERATED column.
        is_taxable: line.is_taxable ?? false,
        sort_order: line.sort_order ?? 0,
        type: opsType,
      });
      result.lineItemsInserted++;
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
        const compositeQbId = `${pmt.qb_id}:${l.invoice_qb_id}`;
        await sb.from("payments").upsert(
          {
            company_id: companyId,
            qb_id: compositeQbId,
            invoice_id: invoiceId,
            client_id: clientId,
            amount: l.amount,
            payment_date: pmt.txn_date ?? null,
            reference_number: l.reference_number ?? null,
            payment_method: null,
          },
          { onConflict: "company_id,qb_id" }
        );
        result.paymentsUpserted++;
      }
    }

    // ── STEP 5: Reconcile invoices to QB-authoritative Balance ─────────────
    for (const inv of stagedInvoices ?? []) {
      const invoiceId = invoiceIdByQbId.get(inv.qb_id as string);
      if (!invoiceId) continue;
      const total = Number(inv.total ?? 0);
      const balance = Number(inv.balance ?? 0);
      const amountPaid = round2(total - balance);
      const status = this.deriveInvoiceStatus(total, balance, inv.due_date as string | null);
      await sb.from("invoices").update({
        amount_paid: amountPaid,
        balance_due: balance,
        status,
        paid_at: balance <= 0 ? new Date().toISOString() : null,
      }).eq("id", invoiceId);
      result.invoicesReconciled++;
    }

    await sb.from("qbo_import_runs").update({
      status: "applied",
      totals: result as unknown as Record<string, number>,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);

    return result;
  }
}

export type { QboStagedCustomer };
