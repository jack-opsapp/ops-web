"use client";

/**
 * Batch list — the master column of the Books expense console.
 *
 * Renders the active lifecycle bucket:
 *   review — grouped by crew member (oldest outstanding period leads),
 *            hover APPROVE on clean rows + APPROVE n on the person header
 *   pay    — grouped by crew member (largest owed leads), hover MARK PAID
 *   paid   — chronological, month subheaders, payout dates
 *   crew   — FILLING section (auto-send foresight) then RETURNED section
 *
 * Rows are scan surfaces: one line, mono numbers, verbs appear on hover only.
 */

import Image from "next/image";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import { RegisterEmpty } from "@/components/ui/register-table";
import {
  ExpenseBatchStatus,
  formatPeriodDisplay,
  getBatchDisplayName,
  type ExpenseBatch,
  type ExpenseBatchUser,
} from "@/lib/types/expense-approval";
import type {
  ExpenseBucket,
  PersonGroup,
  MonthGroup,
  BatchLineStats,
} from "@/lib/utils/expense-buckets";

// ─── Formatting ───────────────────────────────────────────────────────────────

function fmtMoney(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
  }).format(value);
}

/** Parse a plain DATE string without UTC drift. */
function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** "JUN 1–7" / "JUN 28 – JUL 4" period label from the envelope's date range. */
function formatPeriodRange(
  periodStart: string | null,
  periodEnd: string | null,
  locale: string
): string {
  if (!periodStart) return "—";
  const start = parseDateOnly(periodStart);
  const month = (d: Date) =>
    new Intl.DateTimeFormat(locale, { month: "short" }).format(d).toUpperCase();
  if (!periodEnd || periodEnd === periodStart) {
    return `${month(start)} ${start.getDate()}`;
  }
  const end = parseDateOnly(periodEnd);
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${month(start)} ${start.getDate()}–${end.getDate()}`;
  }
  return `${month(start)} ${start.getDate()} – ${month(end)} ${end.getDate()}`;
}

/** "JUL 15" short date from an ISO timestamp or date string. */
function formatShortDate(value: string, locale: string): string {
  const d = value.includes("T") ? new Date(value) : parseDateOnly(value);
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" })
    .format(d)
    .toUpperCase();
}

/** periodEnd + graceDays → the sweep's auto-send day. */
function autoSendDate(periodEnd: string | null, graceDays: number): Date | null {
  if (!periodEnd) return null;
  const d = parseDateOnly(periodEnd);
  d.setDate(d.getDate() + graceDays);
  return d;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function initialsOf(user: ExpenseBatchUser | null | undefined, name: string): string {
  const first = user?.firstName?.trim()?.[0] ?? "";
  const last = user?.lastName?.trim()?.[0] ?? "";
  if (first || last) return `${first}${last}`.toUpperCase();
  return name.trim()[0]?.toUpperCase() ?? "?";
}

export function SubmitterAvatar({
  user,
  name,
  size = 20,
}: {
  user: ExpenseBatchUser | null | undefined;
  name: string;
  size?: number;
}) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-active"
      style={{ width: size, height: size }}
    >
      {user?.profileImageUrl ? (
        <Image
          src={user.profileImageUrl}
          alt={name}
          fill
          sizes={`${size}px`}
          className="object-cover"
        />
      ) : (
        <span className="font-mono text-micro-sm text-text-2 select-none">
          {initialsOf(user, name)}
        </span>
      )}
    </span>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

function SectionHeader({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-[6px]">
      <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
        <span aria-hidden className="text-text-mute">{"// "}</span>
        {children}
      </span>
      {right}
    </div>
  );
}

/** Hover-reveal 28px workbar-tier action on rows and person headers. */
function HoverAction({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "inline-flex h-3 shrink-0 items-center rounded-chip border border-border px-1",
        "font-mono text-micro font-medium uppercase tracking-[0.12em] text-text-2",
        "opacity-0 transition-all duration-150 ease-smooth group-hover:opacity-100 focus-visible:opacity-100",
        "hover:border-border-medium hover:bg-surface-hover hover:text-text",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
        "disabled:pointer-events-none disabled:opacity-0"
      )}
    >
      {label}
    </button>
  );
}

function StatusTag({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip border px-1 py-[1px]",
        "font-mono text-micro font-medium uppercase tracking-[0.12em]",
        tone
      )}
    >
      {children}
    </span>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

interface BatchRowProps {
  batch: ExpenseBatch;
  bucket: ExpenseBucket;
  stats?: BatchLineStats;
  isSelected: boolean;
  showPerson: boolean;
  personName?: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  meta?: React.ReactNode;
  amount: number;
  onSelect: () => void;
  locale: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function BatchRow({
  batch,
  stats,
  isSelected,
  showPerson,
  personName,
  action,
  meta,
  amount,
  onSelect,
  locale,
  t,
}: BatchRowProps) {
  const items = stats?.count;
  const flagged = stats?.flagged ?? 0;

  return (
    <div
      role="button"
      tabIndex={0}
      data-batch-row={batch.id}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group relative flex w-full cursor-pointer items-center gap-2 border-b border-line px-3 py-2 text-left",
        "transition-colors duration-150 ease-smooth",
        isSelected ? "bg-surface-active" : "hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent focus-visible:ring-inset"
      )}
    >
      {/* Selected indicator — 2px bar, text-2 (nav-active pattern, no accent) */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-[6px] left-0 w-[2px] rounded-bar bg-text-2 transition-opacity duration-150",
          isSelected ? "opacity-100" : "opacity-0"
        )}
      />

      {showPerson && (
        <span className="flex min-w-0 items-center gap-1.5">
          <SubmitterAvatar user={batch.submitter} name={personName ?? ""} size={20} />
          <span className="truncate font-mohave text-body-sm text-text">
            {personName}
          </span>
        </span>
      )}

      {/* Period */}
      <span
        className="shrink-0 font-mono text-caption-sm text-text-2"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {formatPeriodRange(batch.periodStart, batch.periodEnd, locale)}
      </span>

      {/* Items */}
      {items != null && (
        <span
          className="shrink-0 font-mono text-micro uppercase tracking-wider text-text-3"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {t(items === 1 ? "expenses.row.itemsOne" : "expenses.row.items", { n: items })}
        </span>
      )}

      {/* Flags */}
      {flagged > 0 && (
        <span className="inline-flex shrink-0 items-center gap-[3px] rounded-chip border border-tan-line bg-tan-soft px-1 py-[1px] font-mono text-micro font-medium uppercase tracking-[0.12em] text-tan">
          <Flag aria-hidden className="h-[9px] w-[9px]" />
          {t("expenses.row.flagged", { n: flagged })}
        </span>
      )}

      <span className="min-w-0 flex-1" />

      {/* Bucket-contextual meta (status pill / dates) */}
      {meta}

      {/* Amount */}
      <span
        className="shrink-0 font-mono text-data-sm text-text"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {fmtMoney(amount, locale)}
      </span>

      {/* Hover quick action */}
      {action && (
        <HoverAction label={action.label} onClick={action.onClick} disabled={action.disabled} />
      )}
    </div>
  );
}

// ─── Person group header ──────────────────────────────────────────────────────

function PersonHeader({
  group,
  action,
  locale,
  t,
}: {
  group: PersonGroup;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  locale: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <div className="group flex items-center gap-2 border-b border-line bg-surface-input px-3 py-[6px]">
      <SubmitterAvatar user={group.submitter} name={group.name} size={20} />
      <span className="truncate font-mohave text-body-sm text-text">{group.name}</span>
      <span
        className="font-mono text-micro uppercase tracking-wider text-text-3"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {t(
          group.batches.length === 1 ? "expenses.group.batchesOne" : "expenses.group.batches",
          { n: group.batches.length, total: fmtMoney(group.total, locale) }
        )}
      </span>
      <span className="min-w-0 flex-1" />
      {action && (
        <HoverAction label={action.label} onClick={action.onClick} disabled={action.disabled} />
      )}
    </div>
  );
}

// ─── List ─────────────────────────────────────────────────────────────────────

export interface BatchListActions {
  onApproveBatch: (batch: ExpenseBatch) => void;
  onMarkPaid: (batch: ExpenseBatch) => void;
  onApprovePerson: (group: PersonGroup) => void;
  onPayPerson: (group: PersonGroup) => void;
}

export function BatchList({
  bucket,
  reviewGroups,
  payGroups,
  paidMonths,
  crewBatches,
  lineStats,
  selectedId,
  onSelect,
  actions,
  canReview,
  busyIds,
  fillingCount,
  graceDays,
}: {
  bucket: ExpenseBucket;
  reviewGroups: PersonGroup[];
  payGroups: PersonGroup[];
  paidMonths: MonthGroup[];
  crewBatches: ExpenseBatch[];
  lineStats: Map<string, BatchLineStats>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  actions: BatchListActions;
  canReview: boolean;
  /** Batches with an in-flight mutation — their actions disable. */
  busyIds: Set<string>;
  /** Filling envelope count — surfaces in the review empty state. */
  fillingCount: number;
  /** Company auto-submit grace days — powers the auto-send foresight line. */
  graceDays: number;
}) {
  const { t } = useDictionary("books");
  const { locale } = useLocale();
  const numLocale = getDateLocale(locale);

  // ── TO REVIEW ──────────────────────────────────────────────────────────────
  if (bucket === "review") {
    if (reviewGroups.length === 0) {
      return (
        <RegisterEmpty
          noun={t("expenses.empty.review")}
          hint={
            fillingCount > 0
              ? t(
                  fillingCount === 1
                    ? "expenses.empty.review.hintOne"
                    : "expenses.empty.review.hint",
                  { n: fillingCount }
                )
              : undefined
          }
        />
      );
    }
    return (
      <div>
        {reviewGroups.map((group) => {
          const clean = group.batches.filter(
            (b) => (lineStats.get(b.id)?.flagged ?? 0) === 0
          );
          return (
            <div key={group.userId}>
              <PersonHeader
                group={group}
                locale={numLocale}
                t={t}
                action={
                  canReview && clean.length > 0
                    ? {
                        label: t("expenses.group.approve", { n: clean.length }),
                        onClick: () => actions.onApprovePerson(group),
                        disabled: clean.some((b) => busyIds.has(b.id)),
                      }
                    : undefined
                }
              />
              {group.batches.map((batch) => {
                const stats = lineStats.get(batch.id);
                const flagged = (stats?.flagged ?? 0) > 0;
                return (
                  <BatchRow
                    key={batch.id}
                    batch={batch}
                    bucket={bucket}
                    stats={stats}
                    isSelected={selectedId === batch.id}
                    showPerson={false}
                    amount={batch.totalAmount ?? 0}
                    onSelect={() => onSelect(batch.id)}
                    locale={numLocale}
                    t={t}
                    action={
                      canReview && !flagged
                        ? {
                            label: t("expenses.row.approve"),
                            onClick: () => actions.onApproveBatch(batch),
                            disabled: busyIds.has(batch.id),
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  // ── TO PAY ─────────────────────────────────────────────────────────────────
  if (bucket === "pay") {
    if (payGroups.length === 0) {
      return <RegisterEmpty noun={t("expenses.empty.pay")} />;
    }
    return (
      <div>
        {payGroups.map((group) => (
          <div key={group.userId}>
            <PersonHeader
              group={group}
              locale={numLocale}
              t={t}
              action={
                canReview
                  ? {
                      label: t("expenses.group.pay", { n: group.batches.length }),
                      onClick: () => actions.onPayPerson(group),
                      disabled: group.batches.some((b) => busyIds.has(b.id)),
                    }
                  : undefined
              }
            />
            {group.batches.map((batch) => (
              <BatchRow
                key={batch.id}
                batch={batch}
                bucket={bucket}
                stats={lineStats.get(batch.id)}
                isSelected={selectedId === batch.id}
                showPerson={false}
                amount={batch.approvedAmount ?? batch.totalAmount ?? 0}
                onSelect={() => onSelect(batch.id)}
                locale={numLocale}
                t={t}
                meta={
                  batch.status === ExpenseBatchStatus.AutoApproved ? (
                    <StatusTag tone="text-text-3 bg-surface-input border-line">
                      {t("expenses.row.autoApproved")}
                    </StatusTag>
                  ) : batch.status === ExpenseBatchStatus.PartiallyApproved ? (
                    <StatusTag tone="text-tan bg-tan-soft border-tan-line">
                      {t("expenses.row.partial")}
                    </StatusTag>
                  ) : undefined
                }
                action={
                  canReview
                    ? {
                        label: t("expenses.row.markPaid"),
                        onClick: () => actions.onMarkPaid(batch),
                        disabled: busyIds.has(batch.id),
                      }
                    : undefined
                }
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  // ── PAID ───────────────────────────────────────────────────────────────────
  if (bucket === "paid") {
    if (paidMonths.length === 0) {
      return <RegisterEmpty noun={t("expenses.empty.paid")} />;
    }
    return (
      <div>
        {paidMonths.map((month) => (
          <div key={month.key}>
            <SectionHeader
              right={
                <span
                  className="font-mono text-micro text-text-3"
                  style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                >
                  {fmtMoney(month.total, numLocale)}
                </span>
              }
            >
              {formatPeriodDisplay(month.key)}
            </SectionHeader>
            {month.batches.map((batch) => (
              <BatchRow
                key={batch.id}
                batch={batch}
                bucket={bucket}
                stats={lineStats.get(batch.id)}
                isSelected={selectedId === batch.id}
                showPerson
                personName={personNameOf(batch)}
                amount={batch.approvedAmount ?? batch.totalAmount ?? 0}
                onSelect={() => onSelect(batch.id)}
                locale={numLocale}
                t={t}
                meta={
                  batch.paidAt ? (
                    <span className="shrink-0 font-mono text-micro uppercase tracking-wider text-olive">
                      {t("expenses.row.paidOn", {
                        date: formatShortDate(batch.paidAt, numLocale),
                      })}
                    </span>
                  ) : undefined
                }
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  // ── WITH CREW ──────────────────────────────────────────────────────────────
  const filling = crewBatches.filter((b) => b.status === ExpenseBatchStatus.Open);
  const returned = crewBatches.filter((b) => b.status !== ExpenseBatchStatus.Open);

  if (crewBatches.length === 0) {
    return <RegisterEmpty noun={t("expenses.empty.crew")} />;
  }

  return (
    <div>
      {filling.length > 0 && (
        <>
          <SectionHeader>{t("expenses.section.filling")}</SectionHeader>
          {filling.map((batch) => {
            const sendDate = autoSendDate(batch.periodEnd, graceDays);
            return (
              <BatchRow
                key={batch.id}
                batch={batch}
                bucket={bucket}
                stats={lineStats.get(batch.id)}
                isSelected={selectedId === batch.id}
                showPerson
                personName={personNameOf(batch)}
                amount={batch.totalAmount ?? 0}
                onSelect={() => onSelect(batch.id)}
                locale={numLocale}
                t={t}
                meta={
                  sendDate ? (
                    <span className="shrink-0 font-mono text-micro uppercase tracking-wider text-text-3">
                      {t("expenses.row.autoSends", {
                        date: formatShortDate(sendDate.toISOString(), numLocale),
                      })}
                    </span>
                  ) : (
                    <StatusTag tone="text-text-3 bg-surface-input border-line">
                      {t("expenses.row.filling")}
                    </StatusTag>
                  )
                }
              />
            );
          })}
        </>
      )}

      {returned.length > 0 && (
        <>
          <SectionHeader>{t("expenses.section.returned")}</SectionHeader>
          {returned.map((batch) => (
            <BatchRow
              key={batch.id}
              batch={batch}
              bucket={bucket}
              stats={lineStats.get(batch.id)}
              isSelected={selectedId === batch.id}
              showPerson
              personName={personNameOf(batch)}
              amount={batch.totalAmount ?? 0}
              onSelect={() => onSelect(batch.id)}
              locale={numLocale}
              t={t}
              meta={
                <StatusTag tone="text-rose bg-rose-soft border-rose-line">
                  {batch.reviewedAt
                    ? t("expenses.detail.returnedOn", {
                        date: formatShortDate(batch.reviewedAt, numLocale),
                      })
                    : t("expenses.row.returned")}
                </StatusTag>
              }
            />
          ))}
        </>
      )}
    </div>
  );
}

function personNameOf(batch: ExpenseBatch): string {
  return getBatchDisplayName(batch);
}
