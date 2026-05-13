/**
 * OPS Web - Project File Service
 *
 * Aggregates the documents associated with a client across the OPS data
 * model and surfaces them in a single shape that the inbox right-rail
 * Files tab (and any future "all client documents" surface) can render
 * without needing to know about the originating tables.
 *
 * "Documents" today means the PDFs OPS itself has produced for this
 * client — estimates and invoices. Both tables carry `client_id` and a
 * `pdf_storage_path`, so they're cheap to surface together.
 *
 * Email attachments are NOT yet a source: `activities.attachments` is
 * declared but the sync engine doesn't currently populate it (every row
 * we sampled returned `[]` despite `has_attachments=true`). When that
 * upstream gap closes, this service is the right place to fan in those
 * rows behind the same wire shape.
 */

import { requireSupabase, parseDateRequired } from "@/lib/supabase/helpers";

/**
 * Inbox-rail-friendly representation of a client document. The
 * `sourceType`/`sourceId` pair lets the UI deep-link to the originating
 * record (e.g. /estimates/{id}) without the rail needing to construct
 * URLs from raw database fields.
 *
 * `email_attachment` is the per-thread variant: it represents a non-image
 * file (PDF, CSV, etc.) attached to a message on the currently-open thread.
 * Email attachments are not persisted to OPS storage — `pdfStoragePath`
 * holds a same-origin proxy URL that streams the bytes from Gmail/M365 on
 * demand. See `/api/inbox/threads/[id]/attachments`.
 */
export interface ProjectDocument {
  id: string;
  /** Human-readable filename — e.g. "Estimate #1042.pdf". */
  filename: string;
  /** Originating record type. Drives the navigation target on click. */
  sourceType: "estimate" | "invoice" | "email_attachment";
  /** Originating record id. Pair with sourceType to build a route. */
  sourceId: string;
  /** Status of the source record (e.g. "draft", "sent", "paid"). Surfaced
   *  alongside the filename so the operator can see "is this paid?" at a
   *  glance without opening the doc. Always null for `email_attachment`. */
  status: string | null;
  /** Storage path of the rendered PDF when present; null when the PDF
   *  hasn't been generated yet (drafts can predate the render step).
   *  For `email_attachment` this is a same-origin proxy URL that streams
   *  the live bytes from the provider via cookie-authed GET. */
  pdfStoragePath: string | null;
  /** ISO-8601. Drives the "MAR 14" timestamp in the rail. */
  updatedAt: string;
  /** Monetary value in dollars — the canonical `total` column on the
   *  underlying estimates/invoices row (both store as `numeric` dollars,
   *  not cents — confirmed via information_schema 2026-05-10). Null when
   *  the source row hasn't filled in a total yet (e.g. a fresh draft),
   *  and always null for `email_attachment`.
   *  Drives the ACCOUNTING tab totals strip without re-querying. */
  value: number | null;
}

interface EstimateRow {
  id: string;
  estimate_number: string | null;
  status: string | null;
  pdf_storage_path: string | null;
  updated_at: string;
  total: number | null;
}

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  status: string | null;
  pdf_storage_path: string | null;
  updated_at: string;
  total: number | null;
}

function safeFilename(prefix: string, number: string | null, id: string): string {
  // Fall back to a short id slice when the number is missing — better than
  // an empty string, and consistent with how the estimate/invoice list
  // pages render headerless rows.
  const trimmed = (number ?? "").trim();
  if (trimmed) return `${prefix} ${trimmed}.pdf`;
  return `${prefix} ${id.slice(0, 8)}.pdf`;
}

function coerceMoney(value: number | string | null | undefined): number | null {
  // Supabase returns `numeric` as either number (in range) or string
  // (high-precision values). Normalize both into a finite number, with
  // null fallback so callers can branch on "no value" without parsing.
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export const ProjectFileService = {
  /**
   * All documents associated with a client. Returns the rows merged and
   * sorted newest-first so the rail can render "most recent activity"
   * order without re-sorting client-side.
   *
   * Bounded at 50 — the rail is a peek surface, not a full document
   * archive. Heavy hitters (clients with hundreds of invoices) deep-link
   * to the dedicated client profile page for the exhaustive view.
   */
  async listClientDocuments(
    clientId: string,
    companyId: string,
    limit = 50,
  ): Promise<ProjectDocument[]> {
    if (!clientId || !companyId) return [];
    const supabase = requireSupabase();

    // Two parallel queries — one each for estimates and invoices. Cheaper
    // than a UNION ALL view (and side-steps the schema's project_id type
    // mismatch between the two tables).
    const [estimatesRes, invoicesRes] = await Promise.all([
      supabase
        .from("estimates")
        .select("id, estimate_number, status, pdf_storage_path, updated_at, total")
        .eq("company_id", companyId)
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(limit),
      supabase
        .from("invoices")
        .select("id, invoice_number, status, pdf_storage_path, updated_at, total")
        .eq("company_id", companyId)
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(limit),
    ]);

    if (estimatesRes.error) {
      console.error(
        "[project-file-service] estimates fetch failed:",
        estimatesRes.error.message,
      );
    }
    if (invoicesRes.error) {
      console.error(
        "[project-file-service] invoices fetch failed:",
        invoicesRes.error.message,
      );
    }

    // Both estimates.total and invoices.total are `numeric` (dollars, not
    // cents) per information_schema — no conversion needed. The Supabase
    // client returns `numeric` columns as JS numbers when in range; we
    // coerce defensively to handle the string fallback path and treat
    // unparseable values as null so the totals strip just drops the row.
    const estimates: ProjectDocument[] = ((estimatesRes.data ?? []) as EstimateRow[]).map(
      (r) => ({
        id: `estimate:${r.id}`,
        filename: safeFilename("Estimate", r.estimate_number, r.id),
        sourceType: "estimate",
        sourceId: r.id,
        status: r.status,
        pdfStoragePath: r.pdf_storage_path,
        updatedAt: parseDateRequired(r.updated_at).toISOString(),
        value: coerceMoney(r.total),
      }),
    );

    const invoices: ProjectDocument[] = ((invoicesRes.data ?? []) as InvoiceRow[]).map(
      (r) => ({
        id: `invoice:${r.id}`,
        filename: safeFilename("Invoice", r.invoice_number, r.id),
        sourceType: "invoice",
        sourceId: r.id,
        status: r.status,
        pdfStoragePath: r.pdf_storage_path,
        updatedAt: parseDateRequired(r.updated_at).toISOString(),
        value: coerceMoney(r.total),
      }),
    );

    // Merge + sort. The id prefixes (`estimate:` / `invoice:`) keep the
    // composed list keyable in React without collision risk between
    // tables that happen to share a UUID (none today, but defensive).
    return [...estimates, ...invoices]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  },
};
