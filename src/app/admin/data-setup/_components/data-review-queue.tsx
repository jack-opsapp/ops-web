"use client";

/**
 * // DATA REVIEW QUEUE — admin panel (Surface 2, lead-lifecycle).
 *
 * Surfaces the genuinely-actionable residual of the P1 DW2 link-reconciliation
 * pass — split provider threads + terminal/live cache rows — as a tactical
 * hairline table with expand-to-inspect and three triage actions (open / link /
 * quarantine). The 2,198 passive de-aggregated activities appear ONLY as a
 * muted, non-actionable count. Complements (does not duplicate) the P3
 * destructive rail notifications.
 *
 * Desktop OPS-Web (mouse-driven). Every value traces to a design-system token:
 * glass-surface panel, hairline borders, zero box-shadow, accent #6F94B0 only
 * on the single CONFIRM-LINK CTA, JetBrains Mono numbers, Cake Mono Light
 * uppercase display, one motion curve (EASE_SMOOTH) honoring reduced-motion.
 */

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import {
  useDataReviewQueue,
  useResolveLink,
  useQuarantineItem,
  type DataReviewItem,
  type ReviewItemKind,
} from "@/lib/hooks/use-data-review";

type FilterKey = "all" | "split" | "terminal";

function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/** Localized relative-date formatter. `t` resolves the data-review namespace. */
function relativeDate(
  iso: string | null,
  t: (key: string, fallback?: string) => string
): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const day = 86_400_000;
  const days = Math.floor(diff / day);
  if (days <= 0) return t("queue.relative.today", "today");
  if (days === 1) return t("queue.relative.dayAgo", "1d ago");
  if (days < 30)
    return t("queue.relative.daysAgo", "{count}d ago").replace(
      "{count}",
      String(days)
    );
  const months = Math.floor(days / 30);
  if (months < 12)
    return t("queue.relative.monthsAgo", "{count}mo ago").replace(
      "{count}",
      String(months)
    );
  return t("queue.relative.yearsAgo", "{count}y ago").replace(
    "{count}",
    String(Math.floor(months / 12))
  );
}

export function DataReviewQueue() {
  const { t } = useDictionary("data-review");
  const reduced = useReducedMotion();
  const { data, isLoading, isError, error, refetch, isFetching } =
    useDataReviewQueue();
  const [filter, setFilter] = useState<FilterKey>("all");

  const allItems = useMemo(() => {
    if (!data) return [];
    return [...data.split, ...data.terminalLive];
  }, [data]);

  const filtered = useMemo(() => {
    if (filter === "split") return data?.split ?? [];
    if (filter === "terminal") return data?.terminalLive ?? [];
    return allItems;
  }, [filter, data, allItems]);

  const splitCount = data?.split.length ?? 0;
  const terminalCount = data?.terminalLive.length ?? 0;
  const quarantinedCount = data?.quarantinedCount ?? 0;

  return (
    <section className="glass-surface rounded-panel border border-line">
      {/* Panel header */}
      <header className="flex flex-col gap-4 border-b border-line px-[30px] py-[16px] md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-cakemono font-light uppercase text-[15px] tracking-[0.08em] text-text">
            {t("queue.heading", "DATA REVIEW")}
          </h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
            {t("queue.title", "// DATA REVIEW QUEUE")}
          </span>
        </div>

        {/* Segmented filter — monochrome, no accent */}
        <div
          role="group"
          aria-label={t("queue.heading", "DATA REVIEW")}
          className="flex items-center gap-1"
        >
          {(
            [
              { key: "all", label: t("queue.filter.all", "ALL") },
              { key: "split", label: t("queue.filter.split", "SPLIT THREADS") },
              {
                key: "terminal",
                label: t("queue.filter.terminal", "TERMINAL/LIVE"),
              },
            ] as Array<{ key: FilterKey; label: string }>
          ).map((seg) => {
            const active = filter === seg.key;
            return (
              <button
                key={seg.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(seg.key)}
                className={
                  "font-mono text-[11px] uppercase tracking-[0.12em] " +
                  "min-h-[36px] px-3 rounded-chip border transition-colors duration-150 " +
                  (active
                    ? "bg-surface-active text-text border-border-medium"
                    : "border-line text-text-3 hover:text-text-2 hover:border-border-medium")
                }
              >
                {seg.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Stat strip — mono, tabular */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-b border-line px-[30px] py-[14px]">
        <Stat label={t("queue.stat.split", "SPLIT THREADS")} value={splitCount} />
        <Stat
          label={t("queue.stat.terminal", "TERMINAL/LIVE")}
          value={terminalCount}
        />
        <div className="flex items-baseline gap-2 text-text-mute">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
            {t("queue.stat.quarantined", "QUARANTINED")}
          </span>
          <span className="font-mono text-[13px] tabular-nums tracking-tight">
            {fmtInt(quarantinedCount)}
          </span>
          <span className="font-mono text-[11px] tracking-[0.04em]">
            {t("queue.stat.quarantinedNote", "[quarantined · no action]")}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-[30px] py-[18px]">
        {isLoading ? (
          <LoadingState label={t("queue.loading", "SYS :: LOADING QUEUE")} />
        ) : isError ? (
          <ErrorState
            label={`${t("queue.error", "// ERROR — QUEUE UNAVAILABLE")}${
              error?.message ? ` · ${error.message}` : ""
            }`}
            retryLabel={t("queue.retry", "RETRY")}
            onRetry={() => refetch()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            label={t(
              "queue.empty",
              "No items need review. Link integrity is clean."
            )}
          />
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <Th>{t("queue.col.type", "TYPE")}</Th>
                <Th>{t("queue.col.subject", "SUBJECT")}</Th>
                <Th>{t("queue.col.spread", "SPREAD")}</Th>
                <Th>{t("queue.col.client", "CLIENT")}</Th>
                <Th>{t("queue.col.lastActivity", "LAST ACTIVITY")}</Th>
                <Th>{t("queue.col.reason", "REASON")}</Th>
                <Th align="right">{t("queue.col.actions", "ACTIONS")}</Th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {filtered.map((item, index) => (
                  <QueueRow
                    key={`${item.kind}:${item.id}`}
                    item={item}
                    index={index}
                    reduced={!!reduced}
                  />
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        )}
        {isFetching && !isLoading ? (
          <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-mute">
            {t("queue.loading", "SYS :: LOADING QUEUE")}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function QueueRow({
  item,
  index,
  reduced,
}: {
  item: DataReviewItem;
  index: number;
  reduced: boolean;
}) {
  const { t } = useDictionary("data-review");
  const [expanded, setExpanded] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const resolveLink = useResolveLink();
  const quarantine = useQuarantineItem();
  const inFlight = resolveLink.isPending || quarantine.isPending;
  const actionError = resolveLink.error?.message || quarantine.error?.message || null;

  const oppLabel =
    item.oppCount === 1
      ? t("queue.spread.oppsOne", "1 opp")
      : t("queue.spread.opps", "{count} opps").replace(
          "{count}",
          String(item.oppCount)
        );
  const termLabel = t("queue.spread.terminal", "{count} terminal").replace(
    "{count}",
    String(item.terminalCount)
  );

  const openTarget = item.owners[0]?.opportunityId ?? item.linkCandidates[0]?.opportunityId;
  const canLink = item.linkCandidates.length > 0;

  const rowMotion = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, height: 0 },
        transition: {
          duration: 0.3,
          delay: Math.min(index * 0.05, 0.4),
          ease: EASE_SMOOTH,
        },
      };

  return (
    <>
      <motion.tr
        {...rowMotion}
        className={
          "border-b border-line align-top transition-colors duration-150 " +
          (inFlight ? "opacity-40 " : "hover:bg-surface-hover-subtle ") +
          "cursor-pointer"
        }
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <td className="py-3 pr-3">
          <TypeTag kind={item.kind} t={t} />
        </td>
        <td className="py-3 pr-3">
          <span className="font-mohave text-[14px] text-text-2 line-clamp-1">
            {item.subject || "—"}
          </span>
        </td>
        <td className="py-3 pr-3">
          <span className="font-mono text-[13px] tabular-nums text-text-2">
            {oppLabel}
            {item.terminalCount > 0 ? ` · ${termLabel}` : ""}
          </span>
        </td>
        <td className="py-3 pr-3">
          <span className="font-mohave text-[13px] text-text-3 line-clamp-1">
            {item.clientName || "—"}
          </span>
        </td>
        <td className="py-3 pr-3">
          <span className="font-mono text-[11px] tabular-nums text-text-3">
            {relativeDate(item.lastActivityAt, t)}
          </span>
        </td>
        <td className="py-3 pr-3 max-w-[280px]">
          <span
            className="font-mono text-[11px] text-text-3 line-clamp-1"
            title={item.reason}
          >
            {item.reason}
          </span>
        </td>
        <td className="py-3 text-right">
          <div
            className="flex items-center justify-end gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            {openTarget ? (
              <a
                href={`/dashboard?openProject=${openTarget}&mode=view`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] uppercase tracking-[0.1em] min-h-[36px] inline-flex items-center px-3 rounded-[5px] border border-line text-text-3 hover:text-text-2 hover:border-border-medium transition-colors duration-150"
              >
                {t("queue.action.open", "OPEN OPPORTUNITY")}
              </a>
            ) : null}
            {canLink ? (
              <button
                type="button"
                disabled={inFlight}
                onClick={() => setLinkOpen((v) => !v)}
                className="font-mono text-[11px] uppercase tracking-[0.1em] min-h-[36px] inline-flex items-center px-3 rounded-[5px] border border-line text-text-2 hover:border-border-medium transition-colors duration-150 disabled:opacity-40"
              >
                {resolveLink.isPending
                  ? t("queue.linking", "LINKING")
                  : t("queue.action.linkTo", "LINK TO…")}
              </button>
            ) : null}
            <button
              type="button"
              disabled={inFlight}
              onClick={() =>
                quarantine.mutate({
                  providerThreadId: item.providerThreadId,
                  kind: item.kind,
                })
              }
              title={t("queue.quarantineHint", "mark reviewed · stays quarantined")}
              className="font-mono text-[11px] uppercase tracking-[0.1em] min-h-[36px] inline-flex items-center px-3 rounded-[5px] border border-line text-text-3 hover:text-text-2 hover:border-border-medium transition-colors duration-150 disabled:opacity-40"
            >
              {quarantine.isPending
                ? t("queue.quarantining", "QUARANTINING")
                : t("queue.action.quarantine", "QUARANTINE")}
            </button>
          </div>
        </td>
      </motion.tr>

      {/* LINK-TO picker row */}
      {linkOpen && canLink ? (
        <tr className="border-b border-line">
          <td colSpan={7} className="px-0 pb-4 pt-1">
            <LinkPicker
              item={item}
              busy={resolveLink.isPending}
              onCancel={() => setLinkOpen(false)}
              onConfirm={(targetOpportunityId) =>
                resolveLink.mutate(
                  {
                    providerThreadId: item.providerThreadId,
                    targetOpportunityId,
                    kind: item.kind,
                  },
                  { onSuccess: () => setLinkOpen(false) }
                )
              }
            />
          </td>
        </tr>
      ) : null}

      {/* Expanded owner detail */}
      {expanded ? (
        <tr className="border-b border-line">
          <td colSpan={7} className="px-0 pb-4 pt-1">
            <OwnerDetail item={item} />
          </td>
        </tr>
      ) : null}

      {actionError ? (
        <tr className="border-b border-line">
          <td colSpan={7} className="py-2">
            <span className="font-mono text-[11px] text-rose">
              {t("queue.actionError", "// ACTION FAILED")} · {actionError}
            </span>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ─── Link picker (glass-dense candidate selector) ──────────────────────────────

function LinkPicker({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  item: DataReviewItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (targetOpportunityId: string) => void;
}) {
  const { t } = useDictionary("data-review");
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="glass-dense rounded-panel border border-border-medium p-4">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
        {t("queue.detail.linkPrompt", "// SELECT THE CANONICAL OWNER")}
      </div>
      <div className="flex flex-col gap-2">
        {item.linkCandidates.map((c) => {
          const isSel = selected === c.opportunityId;
          return (
            <button
              key={c.opportunityId}
              type="button"
              role="radio"
              aria-checked={isSel}
              onClick={() => setSelected(c.opportunityId)}
              className={
                "flex items-center justify-between gap-3 rounded-[5px] border px-3 py-2 text-left transition-colors duration-150 " +
                (isSel
                  ? "border-border-medium bg-surface-active"
                  : "border-line bg-surface-input hover:border-border-medium hover:bg-surface-hover")
              }
            >
              <span className="font-mohave text-[13px] text-text-2 line-clamp-1">
                {c.title || c.opportunityId}
              </span>
              <span className="flex items-center gap-2">
                {c.stage ? (
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-3">
                    {c.stage}
                  </span>
                ) : null}
                {c.terminal ? (
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-rose">
                    {t("queue.detail.terminalFlag", "TERMINAL")}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] text-text-mute">
          {t("queue.linkHint", "re-point every activity onto the chosen owner")}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="font-mono text-[11px] uppercase tracking-[0.1em] min-h-[36px] px-3 rounded-[5px] border border-line bg-surface-hover text-text-3 hover:text-text-2 transition-colors duration-150 disabled:opacity-40"
          >
            {t("queue.action.cancel", "// CANCEL")}
          </button>
          {/* The single accent CTA — appears only at the committing moment */}
          <button
            type="button"
            disabled={!selected || busy}
            onClick={() => selected && onConfirm(selected)}
            className="font-cakemono font-light uppercase text-[13px] tracking-[0.06em] min-h-[36px] px-4 rounded-[5px] border border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black transition-colors duration-150 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ops-accent"
          >
            {busy
              ? t("queue.linking", "LINKING")
              : t("queue.action.confirmLink", "// CONFIRM LINK")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Owner detail accordion ────────────────────────────────────────────────────

function OwnerDetail({ item }: { item: DataReviewItem }) {
  const { t } = useDictionary("data-review");
  return (
    <div className="rounded-panel border border-line bg-surface-hover-subtle p-4">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
        {t("queue.detail.owners", "// OWNING OPPORTUNITIES")}
      </div>
      <div className="flex flex-col gap-2">
        {item.owners.map((o) => (
          <div
            key={o.opportunityId}
            className="flex items-center justify-between gap-3 border-t border-line pt-2 first:border-t-0 first:pt-0"
          >
            <span className="font-mohave text-[13px] text-text-2 line-clamp-1">
              {o.title || o.opportunityId}
            </span>
            <div className="flex items-center gap-4">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-3">
                {t("queue.detail.stage", "STAGE")} {o.stage || "—"}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-text-3">
                {t("queue.detail.activities", "ACTIVITIES")} {o.activityCount}
              </span>
              {o.terminal ? (
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-rose">
                  {t("queue.detail.terminalFlag", "TERMINAL")}
                </span>
              ) : null}
              {o.archived || o.deleted ? (
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-mute">
                  {t("queue.detail.hiddenFlag", "HIDDEN")}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Primitives ────────────────────────────────────────────────────────────────

function TypeTag({
  kind,
  t,
}: {
  kind: ReviewItemKind;
  t: (key: string, fallback?: string) => string;
}) {
  if (kind === "split") {
    return (
      <span className="inline-flex items-center rounded-chip border border-tan-line bg-tan-soft px-2 py-[3px] font-mono text-[11px] uppercase tracking-[0.12em] text-tan">
        {t("queue.tag.split", "SPLIT")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-chip border border-rose-line bg-rose-soft px-2 py-[3px] font-mono text-[11px] uppercase tracking-[0.12em] text-rose">
      {t("queue.tag.terminal", "TERMINAL")}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
        {label}
      </span>
      <span className="font-mono text-[13px] tabular-nums tracking-tight text-text">
        {fmtInt(value)}
      </span>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={
        "pb-2 pr-3 font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-text-mute " +
        (align === "right" ? "text-right" : "text-left")
      }
    >
      {children}
    </th>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3 py-6">
      <span className="font-mono text-[13px] uppercase tracking-[0.12em] text-text-3">
        {label}
      </span>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-[40px] rounded-[5px] bg-fill-neutral-dim motion-safe:animate-pulse"
        />
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-10">
      <span className="font-mohave text-[13px] text-text-3">{label}</span>
    </div>
  );
}

function ErrorState({
  label,
  retryLabel,
  onRetry,
}: {
  label: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 py-6">
      <span className="font-mono text-[11px] text-rose">{label}</span>
      <button
        type="button"
        onClick={onRetry}
        className="self-start font-mono text-[11px] uppercase tracking-[0.1em] min-h-[36px] px-3 rounded-[5px] border border-line bg-surface-hover text-text-3 hover:text-text-2 hover:border-border-medium transition-colors duration-150"
      >
        {retryLabel}
      </button>
    </div>
  );
}
