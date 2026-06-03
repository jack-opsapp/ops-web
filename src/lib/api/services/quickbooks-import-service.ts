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
} from "./qbo-normalize";
import { getQuickBooksEnvironment } from "./quickbooks-config";
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

      // I3: getQuickBooksEnvironment() is the single source for prod-vs-sandbox
      // (fail-safe to sandbox unless QB_ENVIRONMENT === 'production'). The pull
      // service derives the same host (getQuickBooksApiBaseHost()) from this
      // value, so there is exactly one decision point — no inline env read here.
      const pull = new QuickBooksPullService(
        realmId,
        accessToken,
        getQuickBooksEnvironment()
      );
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

    // Single `now` for all date-derived status (canonical fns take a Date).
    const now = new Date();
    // Non-fatal warnings (I8 subtotal divergence, C4 cross-tenant link, etc.)
    // surfaced on the run's totals.error summary without blocking the apply.
    const warnings: string[] = [];

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
        await sb
          .from("clients")
          .update({ qb_id: cust.qb_id })
          .eq("id", clientId)
          .eq("company_id", companyId);
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
      const estId = crypto.randomUUID();
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
      await sb.from("estimates").upsert(estimateRow, { onConflict: "company_id,qb_id" });
      const { data: row } = await sb
        .from("estimates").select("id")
        .eq("company_id", companyId).eq("qb_id", est.qb_id).maybeSingle();
      const resolved = (row?.id as string) ?? estId;
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

      const invId = crypto.randomUUID();
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
      await sb.from("invoices").upsert(invoiceRow, { onConflict: "company_id,qb_id" });
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
      // I8/C4: non-fatal warnings (subtotal divergence, rejected links) are
      // surfaced on the run's error summary without failing the apply.
      error: warnings.length ? warnings.join("; ") : null,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);

    return result;
  }
}

export type { QboStagedCustomer };
