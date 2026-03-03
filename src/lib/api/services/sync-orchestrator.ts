/**
 * OPS Web - Sync Orchestrator
 *
 * Core sync logic for pushing/pulling data to/from accounting providers.
 * Extracted from route.ts so it can be imported by both the API route and cron endpoint.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AccountingTokenService } from "./accounting-token-service";
import { QuickBooksSyncService } from "./quickbooks-sync-service";
import { SageSyncService } from "./sage-sync-service";

// ─── Types ────────────────────────────────────────────────────────────────────

type EntityType = "client" | "invoice" | "estimate" | "payment";
type SyncDirection = "push" | "pull";

interface SyncResult {
  entityType: EntityType;
  direction: SyncDirection;
  count: number;
  errors: string[];
}

// ─── QB Sync Logic ───────────────────────────────────────────────────────────

async function syncQuickBooks(
  supabase: SupabaseClient,
  companyId: string,
  connectionId: string,
  lastSyncAt: string | null
): Promise<SyncResult[]> {
  const { accessToken, realmId } = await AccountingTokenService.getValidToken(supabase, connectionId);
  if (!realmId) throw new Error("QuickBooks realmId not found on connection");

  const results: SyncResult[] = [];

  // ── Push Clients ────────────────────────────────────────────────────────
  {
    const errors: string[] = [];
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name, email, phone, address, qb_id")
      .eq("company_id", companyId)
      .or(lastSyncAt ? `updated_at.gte.${lastSyncAt}` : "id.not.is.null");

    let count = 0;
    for (const client of clients ?? []) {
      try {
        const { qbId } = await QuickBooksSyncService.pushClient(accessToken, realmId, {
          displayName: client.name,
          email: client.email ?? undefined,
          phone: client.phone ?? undefined,
          qbId: client.qb_id ?? undefined,
        });
        if (!client.qb_id) {
          await supabase.from("clients").update({ qb_id: qbId }).eq("id", client.id);
        }
        count++;
      } catch (err) {
        errors.push(`Client ${client.id}: ${(err as Error).message}`);
      }
    }
    results.push({ entityType: "client", direction: "push", count, errors });
  }

  // ── Push Invoices ───────────────────────────────────────────────────────
  {
    const errors: string[] = [];
    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, client_id, total, due_date, qb_id, clients!inner(qb_id)")
      .eq("company_id", companyId)
      .or(lastSyncAt ? `updated_at.gte.${lastSyncAt}` : "id.not.is.null");

    let count = 0;
    for (const inv of invoices ?? []) {
      const clientJoin = inv.clients as unknown as { qb_id: string | null } | Array<{ qb_id: string | null }>;
      const clientQbId = Array.isArray(clientJoin) ? clientJoin[0]?.qb_id : clientJoin?.qb_id;
      if (!clientQbId) continue;
      try {
        const { qbId } = await QuickBooksSyncService.pushInvoice(accessToken, realmId, {
          customerRef: clientQbId,
          lineItems: [{ description: "Invoice sync", amount: inv.total ?? 0 }],
          dueDate: inv.due_date ?? undefined,
          qbId: inv.qb_id ?? undefined,
        });
        if (!inv.qb_id) {
          await supabase.from("invoices").update({ qb_id: qbId }).eq("id", inv.id);
        }
        count++;
      } catch (err) {
        errors.push(`Invoice ${inv.id}: ${(err as Error).message}`);
      }
    }
    results.push({ entityType: "invoice", direction: "push", count, errors });
  }

  // ── Push Estimates ──────────────────────────────────────────────────────
  {
    const errors: string[] = [];
    const { data: estimates } = await supabase
      .from("estimates")
      .select("id, client_id, total, expiry_date, qb_id, clients!inner(qb_id)")
      .eq("company_id", companyId)
      .or(lastSyncAt ? `updated_at.gte.${lastSyncAt}` : "id.not.is.null");

    let count = 0;
    for (const est of estimates ?? []) {
      const clientJoin = est.clients as unknown as { qb_id: string | null } | Array<{ qb_id: string | null }>;
      const clientQbId = Array.isArray(clientJoin) ? clientJoin[0]?.qb_id : clientJoin?.qb_id;
      if (!clientQbId) continue;
      try {
        const { qbId } = await QuickBooksSyncService.pushEstimate(accessToken, realmId, {
          customerRef: clientQbId,
          lineItems: [{ description: "Estimate sync", amount: est.total ?? 0 }],
          expirationDate: est.expiry_date ?? undefined,
          qbId: est.qb_id ?? undefined,
        });
        if (!est.qb_id) {
          await supabase.from("estimates").update({ qb_id: qbId }).eq("id", est.id);
        }
        count++;
      } catch (err) {
        errors.push(`Estimate ${est.id}: ${(err as Error).message}`);
      }
    }
    results.push({ entityType: "estimate", direction: "push", count, errors });
  }

  // ── Push Payments ───────────────────────────────────────────────────────
  {
    const errors: string[] = [];
    const { data: payments } = await supabase
      .from("payments")
      .select("id, client_id, amount, payment_date, qb_id, invoice_id, clients!inner(qb_id), invoices(qb_id)")
      .eq("company_id", companyId)
      .or(lastSyncAt ? `updated_at.gte.${lastSyncAt}` : "id.not.is.null");

    let count = 0;
    for (const pmt of payments ?? []) {
      const clientJoin = pmt.clients as unknown as { qb_id: string | null } | Array<{ qb_id: string | null }>;
      const clientQbId = Array.isArray(clientJoin) ? clientJoin[0]?.qb_id : clientJoin?.qb_id;
      if (!clientQbId) continue;
      const invoiceJoin = pmt.invoices as unknown as { qb_id: string | null } | Array<{ qb_id: string | null }> | null;
      const invoiceQbId = invoiceJoin
        ? (Array.isArray(invoiceJoin) ? invoiceJoin[0]?.qb_id : invoiceJoin?.qb_id)
        : undefined;
      try {
        const { qbId } = await QuickBooksSyncService.pushPayment(accessToken, realmId, {
          customerRef: clientQbId,
          totalAmount: pmt.amount ?? 0,
          paymentDate: pmt.payment_date ?? undefined,
          invoiceRef: invoiceQbId ?? undefined,
          qbId: pmt.qb_id ?? undefined,
        });
        if (!pmt.qb_id) {
          await supabase.from("payments").update({ qb_id: qbId }).eq("id", pmt.id);
        }
        count++;
      } catch (err) {
        errors.push(`Payment ${pmt.id}: ${(err as Error).message}`);
      }
    }
    results.push({ entityType: "payment", direction: "push", count, errors });
  }

  // ── Pull Clients (upsert into local DB) ───────────────────────────────
  {
    const errors: string[] = [];
    try {
      const pulled = await QuickBooksSyncService.pullClients(accessToken, realmId, lastSyncAt ?? undefined);
      let count = 0;
      for (const c of pulled) {
        try {
          await supabase
            .from("clients")
            .upsert(
              { company_id: companyId, qb_id: c.qbId, name: c.displayName, email: c.email ?? null, phone: c.phone ?? null },
              { onConflict: "company_id,qb_id", ignoreDuplicates: false }
            );
          count++;
        } catch (err) {
          errors.push(`Pull upsert client ${c.qbId}: ${(err as Error).message}`);
        }
      }
      results.push({ entityType: "client", direction: "pull", count, errors });
    } catch (err) {
      errors.push(`Pull clients: ${(err as Error).message}`);
      results.push({ entityType: "client", direction: "pull", count: 0, errors });
    }
  }

  // ── Pull Invoices (upsert into local DB) ──────────────────────────────
  {
    const errors: string[] = [];
    try {
      const pulled = await QuickBooksSyncService.pullInvoices(accessToken, realmId, lastSyncAt ?? undefined);
      let count = 0;
      for (const inv of pulled) {
        try {
          const { data: localClient } = await supabase
            .from("clients")
            .select("id")
            .eq("company_id", companyId)
            .eq("qb_id", inv.customerRef)
            .maybeSingle();

          await supabase
            .from("invoices")
            .upsert(
              {
                company_id: companyId,
                qb_id: inv.qbId,
                client_id: localClient?.id ?? null,
                total: inv.totalAmount,
                due_date: inv.dueDate ?? null,
                status: inv.status ?? "open",
              },
              { onConflict: "company_id,qb_id", ignoreDuplicates: false }
            );
          count++;
        } catch (err) {
          errors.push(`Pull upsert invoice ${inv.qbId}: ${(err as Error).message}`);
        }
      }
      results.push({ entityType: "invoice", direction: "pull", count, errors });
    } catch (err) {
      errors.push(`Pull invoices: ${(err as Error).message}`);
      results.push({ entityType: "invoice", direction: "pull", count: 0, errors });
    }
  }

  return results;
}

// ─── Sage Sync Logic ─────────────────────────────────────────────────────────

async function syncSage(
  supabase: SupabaseClient,
  companyId: string,
  connectionId: string,
  lastSyncAt: string | null
): Promise<SyncResult[]> {
  const { accessToken } = await AccountingTokenService.getValidToken(supabase, connectionId);
  const results: SyncResult[] = [];

  // ── Push Clients ────────────────────────────────────────────────────────
  {
    const errors: string[] = [];
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name, email, phone, address, sage_id")
      .eq("company_id", companyId)
      .or(lastSyncAt ? `updated_at.gte.${lastSyncAt}` : "id.not.is.null");

    let count = 0;
    for (const client of clients ?? []) {
      try {
        const { sageId } = await SageSyncService.pushClient(accessToken, {
          name: client.name,
          email: client.email ?? undefined,
          phone: client.phone ?? undefined,
          sageId: client.sage_id ?? undefined,
        });
        if (!client.sage_id) {
          await supabase.from("clients").update({ sage_id: sageId }).eq("id", client.id);
        }
        count++;
      } catch (err) {
        errors.push(`Client ${client.id}: ${(err as Error).message}`);
      }
    }
    results.push({ entityType: "client", direction: "push", count, errors });
  }

  // ── Push Invoices ───────────────────────────────────────────────────────
  {
    const errors: string[] = [];
    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, client_id, total, due_date, sage_id, clients!inner(sage_id)")
      .eq("company_id", companyId)
      .or(lastSyncAt ? `updated_at.gte.${lastSyncAt}` : "id.not.is.null");

    let count = 0;
    for (const inv of invoices ?? []) {
      const clientJoin = inv.clients as unknown as { sage_id: string | null } | Array<{ sage_id: string | null }>;
      const clientSageId = Array.isArray(clientJoin) ? clientJoin[0]?.sage_id : clientJoin?.sage_id;
      if (!clientSageId) continue;
      try {
        const { sageId } = await SageSyncService.pushInvoice(accessToken, {
          contactId: clientSageId,
          lineItems: [{ description: "Invoice sync", quantity: 1, unitPrice: inv.total ?? 0 }],
          dueDate: inv.due_date ?? undefined,
          sageId: inv.sage_id ?? undefined,
        });
        if (!inv.sage_id) {
          await supabase.from("invoices").update({ sage_id: sageId }).eq("id", inv.id);
        }
        count++;
      } catch (err) {
        errors.push(`Invoice ${inv.id}: ${(err as Error).message}`);
      }
    }
    results.push({ entityType: "invoice", direction: "push", count, errors });
  }

  // ── Push Estimates ──────────────────────────────────────────────────────
  {
    const errors: string[] = [];
    const { data: estimates } = await supabase
      .from("estimates")
      .select("id, client_id, total, expiry_date, sage_id, clients!inner(sage_id)")
      .eq("company_id", companyId)
      .or(lastSyncAt ? `updated_at.gte.${lastSyncAt}` : "id.not.is.null");

    let count = 0;
    for (const est of estimates ?? []) {
      const clientJoin = est.clients as unknown as { sage_id: string | null } | Array<{ sage_id: string | null }>;
      const clientSageId = Array.isArray(clientJoin) ? clientJoin[0]?.sage_id : clientJoin?.sage_id;
      if (!clientSageId) continue;
      try {
        const { sageId } = await SageSyncService.pushEstimate(accessToken, {
          contactId: clientSageId,
          lineItems: [{ description: "Estimate sync", quantity: 1, unitPrice: est.total ?? 0 }],
          expiryDate: est.expiry_date ?? undefined,
          sageId: est.sage_id ?? undefined,
        });
        if (!est.sage_id) {
          await supabase.from("estimates").update({ sage_id: sageId }).eq("id", est.id);
        }
        count++;
      } catch (err) {
        errors.push(`Estimate ${est.id}: ${(err as Error).message}`);
      }
    }
    results.push({ entityType: "estimate", direction: "push", count, errors });
  }

  // ── Push Payments ───────────────────────────────────────────────────────
  {
    const errors: string[] = [];
    const { data: payments } = await supabase
      .from("payments")
      .select("id, client_id, amount, payment_date, sage_id, invoice_id, clients!inner(sage_id), invoices(sage_id)")
      .eq("company_id", companyId)
      .or(lastSyncAt ? `updated_at.gte.${lastSyncAt}` : "id.not.is.null");

    let count = 0;
    for (const pmt of payments ?? []) {
      const clientJoin = pmt.clients as unknown as { sage_id: string | null } | Array<{ sage_id: string | null }>;
      const clientSageId = Array.isArray(clientJoin) ? clientJoin[0]?.sage_id : clientJoin?.sage_id;
      if (!clientSageId) continue;
      const invoiceJoin = pmt.invoices as unknown as { sage_id: string | null } | Array<{ sage_id: string | null }> | null;
      const invoiceSageId = invoiceJoin
        ? (Array.isArray(invoiceJoin) ? invoiceJoin[0]?.sage_id : invoiceJoin?.sage_id)
        : undefined;
      try {
        const { sageId } = await SageSyncService.pushPayment(accessToken, {
          contactId: clientSageId,
          totalAmount: pmt.amount ?? 0,
          paymentDate: pmt.payment_date ?? undefined,
          invoiceId: invoiceSageId ?? undefined,
          sageId: pmt.sage_id ?? undefined,
        });
        if (!pmt.sage_id) {
          await supabase.from("payments").update({ sage_id: sageId }).eq("id", pmt.id);
        }
        count++;
      } catch (err) {
        errors.push(`Payment ${pmt.id}: ${(err as Error).message}`);
      }
    }
    results.push({ entityType: "payment", direction: "push", count, errors });
  }

  // ── Pull Clients (upsert into local DB) ───────────────────────────────
  {
    const errors: string[] = [];
    try {
      const pulled = await SageSyncService.pullClients(accessToken, lastSyncAt ?? undefined);
      let count = 0;
      for (const c of pulled) {
        try {
          await supabase
            .from("clients")
            .upsert(
              { company_id: companyId, sage_id: c.sageId, name: c.name, email: c.email ?? null, phone: c.phone ?? null },
              { onConflict: "company_id,sage_id", ignoreDuplicates: false }
            );
          count++;
        } catch (err) {
          errors.push(`Pull upsert client ${c.sageId}: ${(err as Error).message}`);
        }
      }
      results.push({ entityType: "client", direction: "pull", count, errors });
    } catch (err) {
      errors.push(`Pull clients: ${(err as Error).message}`);
      results.push({ entityType: "client", direction: "pull", count: 0, errors });
    }
  }

  // ── Pull Invoices (upsert into local DB) ──────────────────────────────
  {
    const errors: string[] = [];
    try {
      const pulled = await SageSyncService.pullInvoices(accessToken, lastSyncAt ?? undefined);
      let count = 0;
      for (const inv of pulled) {
        try {
          const { data: localClient } = await supabase
            .from("clients")
            .select("id")
            .eq("company_id", companyId)
            .eq("sage_id", inv.contactId)
            .maybeSingle();

          await supabase
            .from("invoices")
            .upsert(
              {
                company_id: companyId,
                sage_id: inv.sageId,
                client_id: localClient?.id ?? null,
                total: inv.totalAmount,
                due_date: inv.dueDate ?? null,
                status: inv.status ?? "open",
              },
              { onConflict: "company_id,sage_id", ignoreDuplicates: false }
            );
          count++;
        } catch (err) {
          errors.push(`Pull upsert invoice ${inv.sageId}: ${(err as Error).message}`);
        }
      }
      results.push({ entityType: "invoice", direction: "pull", count, errors });
    } catch (err) {
      errors.push(`Pull invoices: ${(err as Error).message}`);
      results.push({ entityType: "invoice", direction: "pull", count: 0, errors });
    }
  }

  return results;
}

// ─── Public: Run sync + log results + update last_sync_at ─────────────────────

export async function runSyncForConnection(
  supabase: SupabaseClient,
  companyId: string,
  provider: string,
  connectionId: string,
  lastSyncAt: string | null
): Promise<{ success: boolean; results: SyncResult[]; message: string }> {
  let results: SyncResult[];

  if (provider === "quickbooks") {
    results = await syncQuickBooks(supabase, companyId, connectionId, lastSyncAt);
  } else if (provider === "sage") {
    results = await syncSage(supabase, companyId, connectionId, lastSyncAt);
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  // Log each result
  const totalErrors = results.reduce((acc, r) => acc + r.errors.length, 0);

  for (const r of results) {
    await supabase.from("accounting_sync_log").insert({
      company_id: companyId,
      provider,
      direction: r.direction,
      entity_type: r.entityType,
      status: r.errors.length > 0 ? "partial" : "success",
      details: r.errors.length > 0
        ? `${r.count} synced, ${r.errors.length} errors: ${r.errors.slice(0, 3).join("; ")}`
        : `${r.count} synced`,
    });
  }

  // Update last_sync_at
  await supabase
    .from("accounting_connections")
    .update({
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);

  const totalSynced = results.reduce((acc, r) => acc + r.count, 0);

  return {
    success: true,
    results,
    message: `Sync complete: ${totalSynced} records synced${totalErrors > 0 ? `, ${totalErrors} errors` : ""}`,
  };
}

export type { SyncResult, EntityType, SyncDirection };
