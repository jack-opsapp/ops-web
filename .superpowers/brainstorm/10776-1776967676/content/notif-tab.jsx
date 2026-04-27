// Notification trigger tab — 1:1 behavior clone of the OPS FAB tab,
// adapted for notifications.
//
// Same animation: height + drawer-slide transition simultaneously over 260ms
// ease-smooth. Tab anchored at top:50% with translateY(-50%), so growth is
// equal from top and bottom. Width is fixed (28px) — never changes.
//
// Glyph: a bell rotated 90° so it reads along the vertical wordmark.
// On open it rotates to ×.
//
// Props:
//   open: boolean — is the drawer currently showing
//   onToggle: () => void
//   count: notification count (shown when closed)
//   railWidth, panelHeight: drawer dimensions — tab height when open/hover = panelHeight
//   fill: background — should match the drawer this tab pairs with
//   unreadTone: "critical" | "attn" | null

const NOTIF_TAB_W = 28;
const NOTIF_TAB_REST_H = 180; // fits "NOTIFICATIONS" (13 chars) + glyph + count

function NotifTab({
  open, onToggle, count, unreadTone = null,
  railWidth = 360, panelHeight = 560,
  railTop = 72, railBottom = 16,
  fill = "var(--glass)",
}) {
  const [hovered, setHovered] = React.useState(false);

  // FAB-parity behavior: only the HEIGHT transitions. The tab stays anchored
  // at top:50% with translateY(-50%) within its positioning parent, so growth
  // is perfectly symmetric from the center. We wrap in an outer container
  // that matches the drawer's vertical footprint so 50% = drawer center, not
  // viewport center.
  const tabHeight = (open || hovered) ? panelHeight : NOTIF_TAB_REST_H;
  const accentColor = unreadTone === "critical" ? "var(--rose)"
                    : unreadTone === "attn" ? "var(--tan)"
                    : "var(--ops-accent)";

  return (
    // Outer positioning parent: spans the drawer's vertical footprint.
    // This makes the tab's top:50% resolve to the drawer's vertical center,
    // so height growth is perfectly symmetric around it — exactly like FAB.
    <div style={{
      position: "absolute",
      top: railTop, bottom: railBottom,
      right: 0,
      width: 0, // zero-width anchor; the tab inside has its own width
      pointerEvents: "none",
      zIndex: 13,
    }}>
      <div
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "absolute",
          top: "50%",
          right: open ? railWidth : 0, // tab abuts drawer exactly (no overlap)
          transform: "translateY(-50%)",
          width: NOTIF_TAB_W,
          height: tabHeight,
          boxSizing: "border-box",
          background: fill,
          backdropFilter: "blur(24px) saturate(1.3)",
          WebkitBackdropFilter: "blur(24px) saturate(1.3)",
          border: "1px solid rgba(255,255,255,0.14)",
          borderTopLeftRadius: 4,
          borderBottomLeftRadius: 4,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          cursor: "pointer",
          pointerEvents: "auto",
          color: "var(--text)",
          transition: "right 260ms var(--ease-smooth), height 260ms var(--ease-smooth), background-color 180ms var(--ease-smooth)",
          boxShadow: hovered && !open
            ? "inset 0 1px 0 0 rgba(255,255,255,0.14), inset 1px 0 0 0 rgba(140,170,200,0.35)"
            : "inset 0 1px 0 0 rgba(255,255,255,0.08)",
        }}
      >
      {/* Steel-blue / tone accent — full height */}
      <span style={{
        position: "absolute", left: 0, top: 0, bottom: 0,
        width: 2, background: accentColor,
        transition: "background 180ms var(--ease-smooth)",
      }} />

      {/* Glyph — bell rotated 90° to read along the vertical wordmark.
          When open, it rotates to × (45°). */}
      <span style={{
        color: "var(--text)", display: "inline-flex",
        transform: `rotate(${open ? 45 : -90}deg)`,
        transition: "transform 260ms var(--ease-smooth)",
        position: "relative",
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
          {open ? (
            <path d="M18 6L6 18M6 6l12 12" />
          ) : (
            <>
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </>
          )}
        </svg>
        {!open && count > 0 && (
          <span style={{
            position: "absolute",
            top: -4, right: -5,
            width: 6, height: 6,
            background: accentColor,
          }} />
        )}
      </span>

      {/* Count number — closed only, rotated to read along the wordmark */}
      {!open && count > 0 && (
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text)",
          fontFeatureSettings: '"tnum" 1, "zero" 1',
          lineHeight: 1,
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
        }}>
          {count}
        </span>
      )}

      {/* Vertical wordmark */}
      <span style={{
        writingMode: "vertical-rl",
        transform: "rotate(180deg)",
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        color: "var(--text-2)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}>
        {open ? "CLOSE" : "NOTIFICATIONS"}
      </span>

      {/* Hover tooltip — closed only */}
      {hovered && !open && (
        <div style={{
          position: "absolute",
          right: "calc(100% + 8px)",
          top: "50%",
          transform: "translateY(-50%)",
          background: "rgba(10,10,10,0.85)",
          backdropFilter: "blur(24px) saturate(1.3)",
          WebkitBackdropFilter: "blur(24px) saturate(1.3)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 5,
          padding: "6px 10px",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <span style={{ fontFamily: "var(--font-mohave)", fontSize: 13, color: "var(--text)" }}>
            Notifications
          </span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-2)",
            padding: "2px 5px", minWidth: 14, textAlign: "center",
            border: "1px solid rgba(255,255,255,0.14)", borderRadius: 3,
            background: "rgba(255,255,255,0.04)",
          }}>
            N
          </span>
        </div>
      )}
      </div>
    </div>
  );
}

window.NotifTab = NotifTab;
