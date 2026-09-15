"use client";

import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { toast } from "@/components/ui/toast";
import { useDictionary, useLocale } from "@/i18n/client";
import { queryKeys } from "@/lib/api/query-client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { ExpenseAccountingIssuePage } from "@/lib/types/expense-accounting-issues";

async function fetchIssues(
  connectionId: string,
  offset: number
): Promise<ExpenseAccountingIssuePage> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const token = await getIdToken();
  const params = new URLSearchParams({ connectionId, offset: String(offset) });
  const response = await fetch(
    `/api/integrations/accounting/expense-issues?${params}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }
  );
  if (!response.ok) throw new Error("expense_issues_unavailable");
  const data = await response.json();
  if (data.connectionId !== connectionId || !Array.isArray(data.issues))
    throw new Error("expense_issues_connection_mismatch");
  return data;
}

function IssueList({
  companyId,
  connectionId,
}: {
  companyId: string;
  connectionId: string;
}) {
  const { t } = useDictionary("settings");
  const { locale } = useLocale();
  const can = usePermissionStore((state) => state.can);
  const client = useQueryClient();
  const queryKey = [
    ...queryKeys.accounting.connections(companyId),
    "expenseIssues",
    connectionId,
  ];
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchIssues(connectionId, pageParam),
    getNextPageParam: (page) => page.nextOffset,
    retry: false,
  });
  const active = useRef(new Set<string>());
  const [pending, setPending] = useState(new Set<string>());
  const [failed, setFailed] = useState(new Set<string>());
  const [queued, setQueued] = useState(
    new Map<string, "pending" | "cancelled">()
  );
  useEffect(() => {
    if (query.isSuccess) setQueued(new Map());
  }, [query.dataUpdatedAt, query.isSuccess]);
  const issues = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.issues) ?? []).map((issue) => [
        issue.queueId,
        issue,
      ])
    ).values(),
  ];

  async function retry(queueId: string) {
    if (
      active.current.has(queueId) ||
      !can("accounting.manage_connections") ||
      !can("expenses.approve")
    )
      return;
    active.current.add(queueId);
    setPending(new Set(active.current));
    setFailed((ids) => {
      const next = new Set(ids);
      next.delete(queueId);
      return next;
    });
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const token = await getIdToken();
      const response = await fetch(
        "/api/integrations/accounting/expense-issues",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ queueId }),
        }
      );
      const data = await response.json();
      if (response.status === 409 && data.code === "EXPENSE_ACCOUNTING_PAUSED") {
        // A stale Retry button must adopt the server's current hold, not claim queueing.
        await client.resetQueries({ queryKey });
        return;
      }
      if (
        !response.ok ||
        data.queueId !== queueId ||
        !["pending", "cancelled"].includes(data.status)
      )
        throw new Error("expense_retry_unconfirmed");
      setQueued((ids) => new Map(ids).set(queueId, data.status));
      toast.success(
        t(
          data.status === "pending"
            ? "accounting.expenseIssues.queued"
            : "accounting.expenseIssues.updated"
        )
      );
      // Reset pagination after removing a row so offset pages cannot skip work.
      await client.resetQueries({ queryKey });
    } catch {
      setFailed((ids) => new Set(ids).add(queueId));
    } finally {
      active.current.delete(queueId);
      setPending(new Set(active.current));
    }
  }

  return (
    <section
      className="space-y-1.5 border-t border-border pt-3"
      aria-label={t("accounting.expenseIssues.title")}
    >
      <div className="flex items-center justify-between gap-1.5">
        <h3 className="font-mohave text-body text-text">
          {t("accounting.expenseIssues.title")}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void client.resetQueries({ queryKey })}
        >
          {t("accounting.expenseIssues.refresh")}
        </Button>
      </div>
      {query.isPending && (
        <p role="status" className="font-mohave text-body-sm text-text-3">
          {t("integrations.loading")}
        </p>
      )}
      {query.isError && (
        <p role="alert" className="font-mohave text-body-sm text-rose">
          {t("accounting.expenseIssues.loadFailed")}
        </p>
      )}
      {!query.isPending && !query.isError && issues.length === 0 && (
        <p className="font-mohave text-body-sm text-text-3">
          {t("accounting.expenseIssues.empty")}
        </p>
      )}
      {issues.map((issue) => (
        <div
          key={issue.queueId}
          className="space-y-1.5 rounded-panel border border-border p-1.5"
        >
          <div className="flex items-start justify-between gap-1.5">
            <div className="min-w-0">
              <p className="break-words font-mohave text-body text-text">
                {issue.merchantName ?? t("accounting.expenseIssues.expense")}
              </p>
              <p className="font-mohave text-body-sm text-text-3">
                {t(`accounting.expenseIssues.kind.${issue.kind}`)}
              </p>
              {issue.expenseDate && (
                <time
                  dateTime={issue.expenseDate}
                  className="font-mono text-micro text-text-3"
                >
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  }).format(new Date(`${issue.expenseDate}T00:00:00Z`))}
                </time>
              )}
            </div>
            <span className="shrink-0 font-mono text-body-sm text-text-2">
              {issue.amount !== null && issue.currency
                ? new Intl.NumberFormat(locale, {
                    style: "currency",
                    currency: issue.currency,
                  }).format(issue.amount)
                : "—"}
            </span>
          </div>
          <Tag
            variant={
              issue.recovery === "paused"
                ? "neutral"
                : issue.recovery === "reconcile"
                  ? "tan"
                  : "rose"
            }
          >
            {t(
              issue.recovery === "paused"
                ? "accounting.expenseIssues.paused"
                : issue.recovery === "reconcile"
                  ? "accounting.expenseIssues.reconcile"
                  : "accounting.issueNeedsReview"
            )}
          </Tag>
          {issue.recovery !== "paused" && (
            <p className="font-mohave text-body-sm text-text-2">
              {t(`accounting.expenseIssues.reason.${issue.reason}`)}
            </p>
          )}
          <p className="font-mohave text-body-sm text-text-3">
            {t(`accounting.expenseIssues.help.${issue.recovery}`)}
          </p>
          {failed.has(issue.queueId) && (
            <p role="alert" className="font-mohave text-body-sm text-rose">
              {t("accounting.expenseIssues.retryFailed")}
            </p>
          )}
          {issue.recovery === "retry" && (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending.has(issue.queueId) || queued.has(issue.queueId)}
              onClick={() => void retry(issue.queueId)}
            >
              {t(
                queued.get(issue.queueId) === "cancelled"
                  ? "accounting.expenseIssues.updatedShort"
                  : queued.has(issue.queueId)
                    ? "accounting.expenseIssues.queuedShort"
                    : pending.has(issue.queueId)
                      ? "accounting.expenseIssues.retrying"
                      : "accounting.expenseIssues.retry"
              )}
            </Button>
          )}
        </div>
      ))}
      {query.hasNextPage && (
        <Button
          variant="ghost"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("accounting.expenseIssues.more")}
        </Button>
      )}
    </section>
  );
}

export function ExpenseAccountingIssues(props: {
  companyId: string;
  connectionId: string;
}) {
  const allowed = usePermissionStore(
    (state) =>
      state.can("accounting.manage_connections") &&
      state.can("expenses.approve")
  );
  return allowed ? <IssueList {...props} /> : null;
}
