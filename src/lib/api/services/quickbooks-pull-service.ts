// src/lib/api/services/quickbooks-pull-service.ts
/**
 * OPS Web - QuickBooks Read-Only Pull Service
 *
 * GET-ONLY QuickBooks Online client for the read-only import (Sub-project A).
 * Issues nothing but GET requests against the QBO query endpoint; a write
 * verb is a hard failure. Tracks `qbWriteCalls`, which MUST remain 0 — the
 * import run records it and a non-zero value fails the run (spec §6.5).
 *
 * All methods accept a pre-validated access token + realmId (resolve via
 * AccountingTokenService.getValidToken). Host is selected by QB_ENVIRONMENT.
 * No minorversion is sent. Pagination via STARTPOSITION/MAXRESULTS.
 */

import type { QboRawRecord, QboPullResult } from "@/lib/types/qbo-import";

const QBO_PRODUCTION_HOST = "https://quickbooks.api.intuit.com";
const QBO_SANDBOX_HOST = "https://sandbox-quickbooks.api.intuit.com";

const PAGE_SIZE = 1000;

// QBO TxnDate is a date; cutoff is interpolated into the query so it must be
// a bare YYYY-MM-DD with no quote/space characters that could break out.
const CUTOFF_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertCutoff(cutoff: string): string {
  if (!CUTOFF_DATE_RE.test(cutoff)) {
    throw new Error(`Invalid cutoff date (expected YYYY-MM-DD): ${cutoff}`);
  }
  return cutoff;
}

export class QuickBooksPullService {
  readonly realmId: string;
  private readonly accessToken: string;
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;
  private _qbWriteCalls = 0;

  /**
   * @param realmId      QBO company realm id.
   * @param accessToken  Valid OAuth access token (already refreshed).
   * @param environment  process.env.QB_ENVIRONMENT — 'production' selects the
   *                     production host; anything else (incl. unset/'sandbox')
   *                     selects the sandbox host (matches the existing OAuth
   *                     route default).
   * @param fetchImpl    Injectable fetch (defaults to global fetch) — tests
   *                     pass a spy to assert GET-only behavior.
   */
  constructor(
    realmId: string,
    accessToken: string,
    environment: string | undefined,
    fetchImpl: typeof fetch = fetch
  ) {
    this.realmId = realmId;
    this.accessToken = accessToken;
    this.host = environment?.trim() === "production" ? QBO_PRODUCTION_HOST : QBO_SANDBOX_HOST;
    this.fetchImpl = fetchImpl;
  }

  /** Read-only invariant: number of non-GET requests issued. MUST stay 0. */
  get qbWriteCalls(): number {
    return this._qbWriteCalls;
  }

  /** Effective company base, e.g. https://quickbooks.api.intuit.com/v3/company/{realmId}. */
  get baseUrl(): string {
    return `${this.host}/v3/company/${this.realmId}`;
  }

  /**
   * Issue a single read-only QBO query. GET ONLY. Returns the QueryResponse
   * object (entity arrays live under their type key, e.g. QueryResponse.Invoice).
   */
  private async qboQuery(sql: string): Promise<Record<string, unknown>> {
    const method = "GET";
    // Defensive: if this method is ever edited to a non-GET verb, count it so
    // the run fails loudly rather than silently writing to QuickBooks.
    if (method !== "GET") {
      this._qbWriteCalls += 1;
    }
    const url = `${this.baseUrl}/query?query=${encodeURIComponent(sql)}`;
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`QuickBooks pull error (${response.status}): ${errorText}`);
    }

    const body = (await response.json()) as { QueryResponse?: Record<string, unknown> };
    return body.QueryResponse ?? {};
  }

  /**
   * Page through one entity via STARTPOSITION/MAXRESULTS until a short page.
   * `baseSql` must NOT already contain STARTPOSITION/MAXRESULTS — they are
   * appended here. `entityKey` is the QueryResponse key (e.g. "Invoice").
   */
  private async paginate(baseSql: string, entityKey: string): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    let startPosition = 1; // QBO STARTPOSITION is 1-based
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const sql = `${baseSql} STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`;
      const qr = await this.qboQuery(sql);
      const rows = (qr[entityKey] as Array<Record<string, unknown>> | undefined) ?? [];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break;
      startPosition += PAGE_SIZE;
    }
    return out;
  }

  // ── Pull methods (implemented in A1.2) ───────────────────────────────────

  async pullCustomers(): Promise<QboRawRecord[]> {
    return this.paginate("SELECT * FROM Customer", "Customer");
  }

  async pullInvoices(cutoffISO: string): Promise<QboRawRecord[]> {
    const cutoff = assertCutoff(cutoffISO);
    // Window = (last 24mo by TxnDate) UNION (any still-open by Balance),
    // deduped by Id. QBO has no UNION, so issue two queries and merge.
    const recent = await this.paginate(
      `SELECT * FROM Invoice WHERE TxnDate >= '${cutoff}'`,
      "Invoice"
    );
    const open = await this.paginate(
      `SELECT * FROM Invoice WHERE Balance > '0'`,
      "Invoice"
    );
    return dedupeById([...recent, ...open]);
  }

  async pullEstimates(cutoffISO: string): Promise<QboRawRecord[]> {
    const cutoff = assertCutoff(cutoffISO);
    return this.paginate(`SELECT * FROM Estimate WHERE TxnDate >= '${cutoff}'`, "Estimate");
  }

  async pullPayments(cutoffISO: string): Promise<QboRawRecord[]> {
    const cutoff = assertCutoff(cutoffISO);
    return this.paginate(`SELECT * FROM Payment WHERE TxnDate >= '${cutoff}'`, "Payment");
  }

  async pullItems(): Promise<QboRawRecord[]> {
    return this.paginate("SELECT * FROM Item", "Item");
  }

  /**
   * Run a full read-only pull in dependency-neutral order and return every
   * entity array plus the GET-only write-call counter for the import run.
   */
  async pullAll(cutoffISO: string): Promise<QboPullResult> {
    const cutoff = assertCutoff(cutoffISO);
    const customers = await this.pullCustomers();
    const invoices = await this.pullInvoices(cutoff);
    const estimates = await this.pullEstimates(cutoff);
    const payments = await this.pullPayments(cutoff);
    const items = await this.pullItems();
    return { customers, invoices, estimates, payments, items, qbWriteCalls: this.qbWriteCalls };
  }
}

function dedupeById(records: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of records) {
    const id = r.Id as string | undefined;
    if (id === undefined) continue;
    if (!byId.has(id)) byId.set(id, r);
  }
  return Array.from(byId.values());
}
