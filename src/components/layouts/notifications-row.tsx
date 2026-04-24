"use client";

import { useState, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { lucideIconFromName } from "@/lib/notifications/notification-meta";
import { rowVariants, rowVariantsReduced } from "@/lib/utils/motion";
import type { AppNotification } from "@/lib/api/services/notification-service";
import type { NotificationMeta } from "@/lib/notifications/notification-meta";

interface NotificationRowProps {
  notification: AppNotification;
  meta: NotificationMeta;
  tone: "critical" | "attn" | "ambient";
  expanded: boolean;
  onRowClick: () => void;
  onAction: () => void;
  onDismiss: (id: string) => void;
}

const TONE_SURFACE: Record<
  "critical" | "attn" | "ambient",
  { color: string; line: string; soft: string }
> = {
  critical: { color: "var(--rose)", line: "var(--rose-line)", soft: "var(--rose-soft)" },
  attn: { color: "var(--tan)", line: "var(--tan-line)", soft: "var(--tan-soft)" },
  ambient: { color: "var(--text-3)", line: "rgba(255,255,255,0.08)", soft: "rgba(255,255,255,0.04)" },
};

function translateNotifCopy(
  raw: string | null | undefined,
  t: (k: string) => string,
): string | null {
  if (!raw) return null;
  const looksLikeKey = /^[a-z][a-zA-Z0-9._-]*$/.test(raw) && raw.includes(".");
  if (!looksLikeKey) return raw;
  return t(raw);
}

function formatRel(min: number): string {
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

export function NotificationRow({
  notification,
  meta,
  tone,
  expanded,
  onRowClick,
  onAction,
  onDismiss,
}: NotificationRowProps) {
  const { t: tCommon } = useDictionary("common");
  const { t } = useDictionary("notifications");
  const [hover, setHover] = useState(false);
  const reducedMotion = useReducedMotion();
  const toneSurface = TONE_SURFACE[tone];
  const showAccent = tone === "critical" || tone === "attn";

  const displayTitle = translateNotifCopy(notification.title, tCommon) ?? notification.title;
  const displayBody = translateNotifCopy(notification.body, tCommon);
  const displayActionLabel = translateNotifCopy(notification.actionLabel, tCommon);

  const minutesAgo = useMemo(() => {
    return Math.max(0, Math.floor((Date.now() - notification.createdAt.getTime()) / 60_000));
  }, [notification.createdAt]);

  const Icon = lucideIconFromName(meta.icon);
  const variants = reducedMotion ? rowVariantsReduced : rowVariants;
  const hasAction =
    Boolean(notification.actionUrl) || notification.type === "duplicates_found";

  return (
    <motion.div
      layout="position"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      role="listitem"
      tabIndex={0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onRowClick}
      style={{
        position: "relative",
        padding: "9px 14px",
        cursor: "pointer",
        background: hover || expanded ? "rgba(255,255,255,0.03)" : "transparent",
        borderTop: "1px solid rgba(255,255,255,0.04)",
        transition: reducedMotion ? "none" : "background 120ms cubic-bezier(0.22,1,0.36,1)",
        outline: "none",
      }}
    >
      {showAccent && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 10,
            bottom: 10,
            width: notification.persistent ? 2 : 1,
            background: toneSurface.color,
            opacity: notification.persistent ? 0.85 : 0.45,
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
        <div
          aria-hidden
          style={{
            width: 20,
            height: 20,
            borderRadius: 2.5,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: showAccent ? toneSurface.soft : "rgba(255,255,255,0.04)",
            border: `1px solid ${showAccent ? toneSurface.line : "rgba(255,255,255,0.06)"}`,
            color: showAccent ? toneSurface.color : "var(--text-3)",
          }}
        >
          <Icon size={12} strokeWidth={1.5} />
        </div>
        <span
          style={{
            fontFamily: "var(--font-mohave)",
            fontSize: 13.5,
            color: "var(--text)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {displayTitle}
        </span>
        {displayActionLabel && !expanded && !hover && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.14em",
              color: showAccent ? toneSurface.color : "var(--text-3)",
              opacity: 0.75,
              flexShrink: 0,
            }}
          >
            {displayActionLabel}
          </span>
        )}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-mute)",
            flexShrink: 0,
            minWidth: 24,
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatRel(minutesAgo)}
        </span>
      </div>

      <motion.div
        initial={false}
        animate={{ maxHeight: expanded ? 160 : 0 }}
        transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        style={{ overflow: "hidden", paddingLeft: 28 }}
      >
        {expanded && (
          <>
            {displayBody && (
              <div
                style={{
                  fontFamily: "var(--font-mohave)",
                  fontSize: 12,
                  color: "var(--text-3)",
                  lineHeight: 1.45,
                  marginTop: 6,
                }}
              >
                {displayBody}
              </div>
            )}
            <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
              {hasAction && displayActionLabel && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAction();
                  }}
                  style={{
                    fontFamily: "var(--font-cakemono)",
                    fontWeight: 300,
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    padding: "4px 9px",
                    borderRadius: 2.5,
                    background: showAccent ? toneSurface.soft : "rgba(255,255,255,0.04)",
                    border: `1px solid ${showAccent ? toneSurface.line : "rgba(255,255,255,0.1)"}`,
                    color: showAccent ? toneSurface.color : "var(--text)",
                    cursor: "pointer",
                  }}
                >
                  {displayActionLabel} →
                </button>
              )}
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                style={rowSecondaryBtnStyle}
                disabled
                aria-disabled
                title={t("row.snoozeTooltipComingSoon")}
              >
                {t("row.snooze")}
              </button>
              {!notification.persistent && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss(notification.id);
                  }}
                  style={rowSecondaryBtnStyle}
                  aria-label={t("row.dismissAriaLabel")}
                >
                  {t("row.dismiss")}
                </button>
              )}
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

const rowSecondaryBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-cakemono)",
  fontWeight: 300,
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "4px 9px",
  borderRadius: 2.5,
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "var(--text-3)",
  cursor: "pointer",
};
