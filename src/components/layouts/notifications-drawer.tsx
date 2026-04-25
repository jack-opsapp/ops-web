"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { BellOff, CheckCheck } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  useNotifications,
  useDismissNotification,
  useDismissAllNotifications,
} from "@/lib/hooks/use-notifications";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { useDuplicateReviewStore } from "@/stores/duplicate-review-store";
import {
  resolveTone,
  NOTIF_TYPE_META,
  type NotificationTone,
} from "@/lib/notifications/notification-meta";
import { NotificationRow } from "./notifications-row";
import {
  drawerVariants,
  drawerVariantsReduced,
  chipVariants,
} from "@/lib/utils/motion";
import { useDictionary } from "@/i18n/client";
import type { AppNotification } from "@/lib/api/services/notification-service";

type DrawerTone = "critical" | "attn" | "ambient";
const EDGE_TAB_ID = "notifications";

function bucketTone(n: AppNotification): DrawerTone {
  const raw = resolveTone(n.type);
  return raw === "critical" || raw === "attn" ? raw : "ambient";
}

export function NotificationsDrawer() {
  const { t } = useDictionary("notifications");
  const router = useRouter();
  const open = useEdgeTabStore((s) => s.activeTab === EDGE_TAB_ID);
  const close = useEdgeTabStore((s) => s.close);
  const { data: notifs = [], dataUpdatedAt } = useNotifications();
  const dismissMutation = useDismissNotification();
  const dismissAllMutation = useDismissAllNotifications();
  const openDuplicateSheet = useDuplicateReviewStore((s) => s.openSheet);
  const reducedMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);

  const [filter, setFilter] = useState<"all" | DrawerTone>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleFilterChange = (key: "all" | DrawerTone) => {
    setFilter(key);
    setExpandedId(null);
    if (typeof listRef.current?.scrollTo === "function") {
      listRef.current.scrollTo({ top: 0, behavior: "auto" });
    }
  };

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const focused = document.activeElement as HTMLElement | null;
    if (!focused || focused.getAttribute("role") !== "listitem") return;
    const rows = Array.from(
      listRef.current?.querySelectorAll('[role="listitem"]') ?? [],
    ) as HTMLElement[];
    const idx = rows.indexOf(focused);
    if (idx === -1) return;
    e.preventDefault();
    const next =
      e.key === "ArrowUp"
        ? rows[(idx - 1 + rows.length) % rows.length]
        : rows[(idx + 1) % rows.length];
    next?.focus();
  };

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(EDGE_TAB_ID);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  const counts = useMemo(() => {
    const c = { critical: 0, attn: 0, ambient: 0 };
    for (const n of notifs) c[bucketTone(n)]++;
    return c;
  }, [notifs]);

  const visible = useMemo(() => {
    if (filter === "all") return notifs;
    return notifs.filter((n) => bucketTone(n) === filter);
  }, [notifs, filter]);

  const hasDismissible = useMemo(
    () => notifs.some((n) => !n.persistent),
    [notifs],
  );

  const syncTime = useMemo(() => {
    if (!dataUpdatedAt) return "—:—";
    const d = new Date(dataUpdatedAt);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }, [dataUpdatedAt]);

  const handleRowClick = (n: AppNotification) => {
    setExpandedId((prev) => (prev === n.id ? null : n.id));
  };

  const handleAction = (n: AppNotification) => {
    if (n.type === "duplicates_found") {
      if (!n.persistent) dismissMutation.mutate(n.id);
      openDuplicateSheet();
      close(EDGE_TAB_ID);
      return;
    }
    if (n.actionUrl) {
      if (!n.persistent) dismissMutation.mutate(n.id);
      router.push(n.actionUrl);
      close(EDGE_TAB_ID);
    }
  };

  const handleDismiss = (id: string) => {
    dismissMutation.mutate(id);
    setExpandedId((prev) => (prev === id ? null : prev));
  };

  const handleViewAll = () => {
    setFilter("all");
    setExpandedId(null);
    if (typeof listRef.current?.scrollTo === "function") {
      listRef.current.scrollTo({
        top: 0,
        behavior: reducedMotion ? "auto" : "smooth",
      });
    }
  };

  const variants = reducedMotion ? drawerVariantsReduced : drawerVariants;

  const CHIPS = useMemo<Array<{
    key: "all" | DrawerTone;
    label: string;
    color: string;
    line: string;
    soft: string;
    count: number;
  }>>(
    () => [
      {
        key: "all",
        label: t("filters.all"),
        color: "var(--text)",
        line: "rgba(255,255,255,0.18)",
        soft: "rgba(255,255,255,0.08)",
        count: notifs.length,
      },
      {
        key: "critical",
        label: t("filters.critical"),
        color: "var(--rose)",
        line: "var(--rose-line)",
        soft: "var(--rose-soft)",
        count: counts.critical,
      },
      {
        key: "attn",
        label: t("filters.attn"),
        color: "var(--tan)",
        line: "var(--tan-line)",
        soft: "var(--tan-soft)",
        count: counts.attn,
      },
      {
        key: "ambient",
        label: t("filters.ambient"),
        color: "var(--text-3)",
        line: "rgba(255,255,255,0.12)",
        soft: "rgba(255,255,255,0.04)",
        count: counts.ambient,
      },
    ],
    [t, notifs.length, counts],
  );

  return (
    <AnimatePresence mode="wait">
      {open && (
        <motion.aside
          key="notifications-drawer"
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          role="complementary"
          aria-label={t("drawer.ariaLabel")}
          style={{
            position: "fixed",
            top: 72,
            right: 0,
            bottom: 16,
            width: "min(360px, calc(100vw - 36px))",
            display: "flex",
            flexDirection: "column",
            background: "var(--glass)",
            backdropFilter: "blur(28px) saturate(1.3)",
            WebkitBackdropFilter: "blur(28px) saturate(1.3)",
            border: "1px solid var(--glass-border)",
            borderRight: "none",
            zIndex: 1500,
            overflow: "hidden",
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "linear-gradient(180deg, rgba(255,255,255,0.04), transparent 40%)",
            }}
          />

          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 14px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              position: "relative",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-mute)",
                letterSpacing: "0.16em",
              }}
            >
              //
            </span>
            <span
              style={{
                fontFamily: "var(--font-cakemono)",
                fontWeight: 300,
                fontSize: 13,
                color: "var(--text)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginLeft: 6,
              }}
            >
              {t("drawer.title")}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-2)",
                marginLeft: 8,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {notifs.length}
            </span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              aria-label={t("drawer.muteAllAriaLabel")}
              style={drawerIconBtnStyle}
              title={t("row.snoozeTooltipComingSoon")}
              disabled
              aria-disabled
            >
              <BellOff size={12} />
            </button>
            <button
              type="button"
              aria-label={t("drawer.clearAllAriaLabel")}
              disabled={!hasDismissible || dismissAllMutation.isPending}
              onClick={() => dismissAllMutation.mutate()}
              style={{
                ...drawerIconBtnStyle,
                opacity: !hasDismissible ? 0.4 : 1,
                cursor: !hasDismissible ? "default" : "pointer",
              }}
            >
              <CheckCheck size={12} />
            </button>
          </div>

          {/* Filter chips */}
          <div
            role="tablist"
            aria-label={t("filters.ariaLabel")}
            style={{
              display: "flex",
              gap: 4,
              padding: "8px 14px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              flexWrap: "wrap",
            }}
          >
            {CHIPS.map((c) => {
              const active = filter === c.key;
              return (
                <motion.button
                  key={c.key}
                  role="tab"
                  aria-selected={active}
                  aria-controls="notifications-drawer-list"
                  onClick={() => handleFilterChange(c.key)}
                  variants={reducedMotion ? undefined : chipVariants}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    padding: "4px 8px",
                    borderRadius: 4,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: active ? c.soft : "rgba(255,255,255,0.02)",
                    border: `1px solid ${active ? c.line : "rgba(255,255,255,0.08)"}`,
                    color: active ? c.color : "var(--text-3)",
                    transition: reducedMotion
                      ? "none"
                      : "background 160ms var(--ease-smooth), border-color 160ms var(--ease-smooth), color 160ms var(--ease-smooth)",
                  }}
                >
                  {c.key !== "all" && (
                    <span
                      aria-hidden
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: 1,
                        background: c.color,
                        opacity: active ? 1 : 0.55,
                        transition: reducedMotion
                          ? "none"
                          : "opacity 160ms var(--ease-smooth)",
                      }}
                    />
                  )}
                  {c.label}
                  <span
                    style={{
                      color: active ? c.color : "var(--text-mute)",
                      opacity: active ? 0.85 : 1,
                      fontVariantNumeric: "tabular-nums",
                      transition: reducedMotion
                        ? "none"
                        : "color 160ms var(--ease-smooth), opacity 160ms var(--ease-smooth)",
                    }}
                  >
                    {c.count}
                  </span>
                </motion.button>
              );
            })}
          </div>

          {/* Scrollable list */}
          <div
            id="notifications-drawer-list"
            ref={listRef}
            role="list"
            onKeyDown={handleListKeyDown}
            className="hide-scrollbar"
            style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}
          >
            {visible.length === 0 && (
              <div style={{ padding: 28, textAlign: "center" }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-mute)",
                    letterSpacing: "0.16em",
                  }}
                >
                  {filter === "all"
                    ? t("empty.allClear")
                    : t("empty.noneInBucket").replace(
                        "{bucket}",
                        CHIPS.find((c) => c.key === filter)?.label ?? "",
                      )}
                </span>
              </div>
            )}
            {visible.map((n) => {
              const meta = NOTIF_TYPE_META[n.type] ?? {
                label: n.type.toUpperCase(),
                icon: "circle",
                tone: "accent" as NotificationTone,
              };
              const tone = bucketTone(n);
              return (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  meta={meta}
                  tone={tone}
                  expanded={expandedId === n.id}
                  onRowClick={() => handleRowClick(n)}
                  onAction={() => handleAction(n)}
                  onDismiss={handleDismiss}
                />
              );
            })}
            {visible.length > 0 && (
              <div style={{ padding: "10px 14px", textAlign: "center" }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    color: "var(--text-mute)",
                    letterSpacing: "0.18em",
                  }}
                >
                  {t("list.eofMarker")}
                </span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 14px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-mute)",
                letterSpacing: "0.14em",
              }}
            >
              {t("footer.lastSync").replace("{time}", syncTime)}
            </span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={handleViewAll}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.14em",
                color: "var(--text-3)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {t("footer.viewAll")}
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

const drawerIconBtnStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 2.5,
  border: "none",
  background: "transparent",
  color: "var(--text-3)",
  cursor: "pointer",
  marginLeft: 4,
};
