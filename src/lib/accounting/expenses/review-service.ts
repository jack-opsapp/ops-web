import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExpenseAccountingIssue,
  ExpenseAccountingIssuePage,
} from "@/lib/types/expense-accounting-issues";

type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 50;
function receiptDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

/** Display advice only. The locked retry RPC independently enforces every fence. */
export function expenseRecoveryAction(
  row: Row,
  event: Row | undefined,
  hasPosting: boolean,
  connection: Row
): ExpenseAccountingIssue["recovery"] {
  if (
    !event ||
    event.kind === "review" ||
    !["accrual", "purchase", "settlement", "reversal"].includes(
      String(event.kind)
    ) ||
    row.entity_type !== "expense" ||
    row.source_table !== "expense_accounting_events" ||
    row.operation !== "create" ||
    !["blocked", "needs_review", "failed"].includes(String(row.status)) ||
    hasPosting ||
    [
      row.external_id,
      row.provider_accepted_at,
      row.provider_request_id,
      row.idempotency_expires_at,
    ].some((value) => value !== null)
  )
    return "reconcile";
  const snapshot = object(row.payload_snapshot);
  const identity =
    row.provider === "quickbooks"
      ? connection.realm_id_lookup
      : connection.sage_business_id_lookup;
  if (
    !identity ||
    identity !== snapshot.providerIdentitySnapshot ||
    connection.provider_environment !== snapshot.providerEnvironment
  )
    return "reconcile";
  if (
    connection.is_connected !== true ||
    connection.sync_enabled !== true ||
    !["push_only", "bidirectional"].includes(String(connection.sync_direction))
  )
    return "connection";
  return "retry";
}

/** Classify stored diagnostics without returning provider payloads or internal IDs. */
export function expenseIssueReason(
  value: unknown
): ExpenseAccountingIssue["reason"] {
  const message = text(value)?.toLowerCase() ?? "";
  if (/tax/.test(message)) return "tax";
  if (/currency|currencies|country|region/.test(message)) return "currency";
  if (/employee/.test(message)) return "crew";
  if (/project/.test(message)) return "project";
  if (/receipt|expense (accounting )?(amount|total|date)/.test(message))
    return "details";
  if (/accounts?\b|repayment|mapping|settings/.test(message)) return "accounts";
  return "unknown";
}

export async function loadExpenseAccountingIssues(
  db: SupabaseClient,
  companyId: string,
  connectionId: string,
  offset: number
): Promise<ExpenseAccountingIssuePage> {
  const { data: connection, error: connectionError } = await db
    .from("accounting_connections")
    .select(
      "id,company_id,provider,provider_environment,is_connected,sync_enabled,sync_direction,realm_id_lookup,sage_business_id_lookup"
    )
    .eq("id", connectionId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection || !["quickbooks", "sage"].includes(connection.provider))
    throw new Error("expense_connection_unavailable");
  const { data: rows, error } = await db
    .from("accounting_sync_queue")
    .select(
      "id,company_id,connection_id,provider,entity_type,entity_id,operation,source_table,payload_snapshot,status,last_error,external_id,provider_accepted_at,provider_request_id,idempotency_expires_at,updated_at"
    )
    .eq("company_id", companyId)
    .eq("connection_id", connectionId)
    .eq("provider", connection.provider)
    .eq("entity_type", "expense")
    .in("status", ["blocked", "needs_review", "failed"])
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + PAGE_SIZE);
  if (error) throw error;
  const page = (rows ?? []).slice(0, PAGE_SIZE) as Row[];
  if (!page.length) return { connectionId, issues: [], nextOffset: null };
  const eventIds = page
    .map((row) => object(row.payload_snapshot).eventId)
    .filter((id): id is string => typeof id === "string" && UUID.test(id));
  const [events, postings] = await Promise.all([
    eventIds.length
      ? db
          .from("expense_accounting_events")
          .select("id,expense_id,kind,source_snapshot")
          .eq("company_id", companyId)
          .in("id", eventIds)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("expense_accounting_postings")
      .select("queue_id,event_id")
      .eq("company_id", companyId)
      .eq("connection_id", connectionId)
      .in(
        "queue_id",
        page.map((row) => String(row.id))
      ),
  ]);
  if (events.error) throw events.error;
  if (postings.error) throw postings.error;
  const issues = page.map((row): ExpenseAccountingIssue => {
    const event = (events.data ?? []).find(
      (item) =>
        item.id === object(row.payload_snapshot).eventId &&
        item.expense_id === row.entity_id
    );
    const source = object(event?.source_snapshot);
    const kind = ["accrual", "purchase", "settlement", "reversal"].includes(
      String(event?.kind)
    )
      ? (event!.kind as ExpenseAccountingIssue["kind"])
      : "review";
    return {
      queueId: String(row.id),
      provider: connection.provider as ExpenseAccountingIssue["provider"],
      kind,
      merchantName: text(source.merchant_name),
      amount: /^\d{1,10}(\.\d{1,2})?$/.test(String(source.amount))
        ? Number(source.amount)
        : null,
      currency: /^[A-Z]{3}$/.test(String(source.currency))
        ? String(source.currency)
        : null,
      expenseDate: receiptDate(source.expense_date),
      reason: expenseIssueReason(row.last_error),
      recovery: expenseRecoveryAction(
        row,
        event,
        (postings.data ?? []).some(
          (posting) =>
            posting.queue_id === row.id || posting.event_id === event?.id
        ),
        connection
      ),
    };
  });
  return {
    connectionId,
    issues,
    nextOffset: (rows ?? []).length > PAGE_SIZE ? offset + PAGE_SIZE : null,
  };
}
