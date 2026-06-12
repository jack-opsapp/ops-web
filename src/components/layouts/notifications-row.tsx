"use client";

/**
 * Notification row (WEB OVERHAUL P2 recomposition).
 *
 * One-step actions: hovering a row reveals its primary action button and
 * (for non-persistent rows) a dismiss ×, replacing the old two-step
 * expand-to-act flow. Clicking the row still expands the body text +
 * actions for keyboard/touch users. The disabled snooze button is gone —
 * it returns when snooze ships.
 */

import { useState, useMemo } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { lucideIconFromName } from "@/lib/notifications/notification-meta";
import { translateNotifCopy } from "@/lib/notifications/translate-copy";
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
  critical: {
    color: "var(--rose)",
    line: "var(--rose-line)",
    soft: "var(--rose-soft)",
  },
  attn: {
    color: "var(--tan)",
    line: "var(--tan-line)",
    soft: "var(--tan-soft)",
  },
  ambient: {
    color: "var(--text-3)",
    line: "var(--line)",
    soft: "rgba(255,255,255,0.04)",
  },
};

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

  const displayTitle =
    translateNotifCopy(notification.title, tCommon) ?? notification.title;
  const displayBody = translateNotifCopy(notification.body, tCommon);
  const displayActionLabel = translateNotifCopy(
    notification.actionLabel,
    tCommon,
  );

  const minutesAgo = useMemo(() => {
    return Math.max(
      0,
      Math.floor((Date.now() - notification.createdAt.getTime()) / 60_000),
    );
  }, [notification.createdAt]);

  const Icon = lucideIconFromName(meta.icon);
  const variants = reducedMotion ? rowVariantsReduced : rowVariants;
  const hasAction =
    Boolean(notification.actionUrl) || notification.type === "duplicates_found";
  const showQuickAction = hover && !expanded && hasAction && displayActionLabel;
  const showQuickDismiss = hover && !expanded && !notification.persistent;

  return (
    <motion.div
      layout
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
        borderTop: "1px solid var(--line)",
        transition: reducedMotion
          ? "none"
          : "background var(--d-hover) var(--ease-smooth)",
        outline: "none",
      }}
    >
      {/* Tone bar — 2px persistent / 1px standard */}
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          whiteSpace: "nowrap",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: showAccent ? toneSurface.soft : "rgba(255,255,255,0.04)",
            border: `1px solid ${
              showAccent ? toneSurface.line : "var(--line)"
            }`,
            color: showAccent ? toneSurface.color : "var(--text-3)",
          }}
        >
          <Icon size={12} strokeWidth={1.5} />
        </div>
        <span
          style={{
            fontFamily: "var(--font-mohave)",
            fontSize: 14,
            color: "var(--text)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {displayTitle}
        </span>

        {/* Hover-revealed primary action — one step, no expand needed. */}
        {showQuickAction && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAction();
            }}
            style={{
              fontFamily: "var(--font-cakemono)",
              fontWeight: 300,
              fontSize: 14,
              letterSpacing: 0,
              textTransform: "uppercase",
              padding: "3px 8px",
              borderRadius: 5,
              flexShrink: 0,
              background: showAccent
                ? toneSurface.soft
                : "rgba(255,255,255,0.04)",
              border: `1px solid ${
                showAccent ? toneSurface.line : "var(--line)"
              }`,
              color: showAccent ? toneSurface.color : "var(--text)",
              cursor: "pointer",
            }}
          >
            {displayActionLabel} →
          </button>
        )}

        {/* Hover-revealed dismiss (non-persistent only) */}
        {showQuickDismiss && (
          <button
            type="button"
            aria-label={t("row.dismissAriaLabel")}
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(notification.id);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              flexShrink: 0,
              borderRadius: 4,
              border: "none",
              background: "transparent",
              color: "var(--text-mute)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text-2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-mute)";
            }}
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        )}

        {/* Relative timestamp — yields to the hover controls */}
        {!showQuickAction && !showQuickDismiss && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-3)",
              flexShrink: 0,
              minWidth: 24,
              textAlign: "right",
              fontFeatureSettings: '"tnum" 1, "zero" 1',
            }}
          >
            {formatRel(minutesAgo)}
          </span>
        )}
      </div>

      {/* Expanded body + actions (keyboard/touch path) */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="expanded-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
            }
            style={{ overflow: "hidden", paddingLeft: 28 }}
          >
            {displayBody && (
              <div
                style={{
                  fontFamily: "var(--font-mohave)",
                  fontSize: 14,
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
                    fontSize: 14,
                    letterSpacing: 0,
                    textTransform: "uppercase",
                    padding: "4px 9px",
                    borderRadius: 5,
                    background: showAccent
                      ? toneSurface.soft
                      : "rgba(255,255,255,0.04)",
                    border: `1px solid ${
                      showAccent ? toneSurface.line : "var(--line)"
                    }`,
                    color: showAccent ? toneSurface.color : "var(--text)",
                    cursor: "pointer",
                  }}
                >
                  {displayActionLabel} →
                </button>
              )}
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const rowSecondaryBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-cakemono)",
  fontWeight: 300,
  fontSize: 14,
  letterSpacing: 0,
  textTransform: "uppercase",
  padding: "4px 9px",
  borderRadius: 5,
  background: "transparent",
  border: "1px solid var(--line)",
  color: "var(--text-3)",
  cursor: "pointer",
};
