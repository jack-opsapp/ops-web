// Variation 1 — FEED
// Vertical stack of glass cards on the right edge.
// The "refined inbox" take: clear hierarchy, generous spacing, hover-reveal quick actions.
// Concept: every notification is a small decision. The rail is a queue of decisions.
// 360px wide, fixed right, 16px from top/right/bottom edges.

function RailFeed({ notifs, compact = false, onDismiss, open = true }) {
  const [expandedId, setExpandedId] = React.useState(null);
  const [filter, setFilter] = React.useState("all"); // all | unread | pinned

  const filtered = notifs.filter(n => {
    if (filter === "pinned") return n.persistent;
    if (filter === "unread") return true; // all are "unread" in this mock
    return true;
  });

  const pinned = filtered.filter(n => n.persistent);
  const rest = filtered.filter(n => !n.persistent);

  return (
    <div style={{
      position: "absolute", top: 72, right: open ? 0 : -360, bottom: 16, width: 360,
      transition: "right 260ms var(--ease-smooth)",
      display: "flex", flexDirection: "column",
      background: "var(--glass)",
      backdropFilter: "blur(24px) saturate(1.3)",
      WebkitBackdropFilter: "blur(24px) saturate(1.3)",
      border: "1px solid rgba(255,255,255,0.14)",
      borderLeft: open ? "none" : "1px solid rgba(255,255,255,0.14)",
      borderRight: "none",
      borderTopLeftRadius: 0,
      borderBottomLeftRadius: 0,
      borderTopRightRadius: 0,
      borderBottomRightRadius: 0,
      zIndex: 10,
      overflow: "hidden",
    }}>
      {/* Top-edge lit gradient */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: 5, pointerEvents: "none",
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), transparent 40%)",
      }} />

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", padding: "12px 14px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.06)", position: "relative",
      }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.16em" }}>//</span>
        <span style={{ fontFamily: "var(--font-cakemono)", fontWeight: 300, fontSize: 13, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.08em", marginLeft: 6 }}>
          NOTIFICATIONS
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)", marginLeft: 8 }}>
          {notifs.length}
        </span>
        <div style={{ flex: 1 }} />
        <button title="Mute all" style={btnIcon}>
          <Icon name="bell-off" size={13} />
        </button>
        <button title="Clear dismissable" style={btnIcon}>
          <Icon name="check-check" size={13} />
        </button>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 4, padding: "8px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {[["all","ALL",notifs.length],["pinned","PINNED",notifs.filter(n=>n.persistent).length],["unread","UNREAD",notifs.length]].map(([k,l,c]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            ...chipStyle,
            background: filter === k ? "rgba(255,255,255,0.08)" : "transparent",
            color: filter === k ? "var(--text)" : "var(--text-3)",
            borderColor: filter === k ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)",
          }}>
            {l} <span style={{ color: "var(--text-mute)", marginLeft: 4 }}>{c}</span>
          </button>
        ))}
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }} className="hide-scrollbar">
        {pinned.length > 0 && (
          <>
            <SectionLabel>PINNED</SectionLabel>
            {pinned.map(n => (
              <FeedCard key={n.id} notif={n} compact={compact} expanded={expandedId===n.id}
                onToggle={() => setExpandedId(expandedId===n.id ? null : n.id)}
                onDismiss={onDismiss} />
            ))}
          </>
        )}
        {rest.length > 0 && (
          <>
            <SectionLabel>ACTIVE</SectionLabel>
            {rest.map(n => (
              <FeedCard key={n.id} notif={n} compact={compact} expanded={expandedId===n.id}
                onToggle={() => setExpandedId(expandedId===n.id ? null : n.id)}
                onDismiss={onDismiss} />
            ))}
          </>
        )}
        <div style={{ padding: "14px", textAlign: "center" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.14em" }}>
            [ END OF FEED ]
          </span>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        display: "flex", alignItems: "center", padding: "8px 14px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.14em" }}>
          SYS :: LAST SYNC {fmtAbs(1)}
        </span>
        <div style={{ flex: 1 }} />
        <button style={{ ...btnText }}>VIEW HISTORY →</button>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ padding: "10px 14px 4px", display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-mute)", letterSpacing: "0.2em" }}>
        // {children}
      </span>
      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }} />
    </div>
  );
}

function FeedCard({ notif, compact, expanded, onToggle, onDismiss }) {
  const [hover, setHover] = React.useState(false);
  const meta = NOTIF_TYPES[notif.type] || { label: notif.type.toUpperCase(), icon: "circle", tone: "info" };
  const toneColor = TONE_COLOR[meta.tone];

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onToggle}
      style={{
        position: "relative",
        padding: compact ? "8px 14px 8px 18px" : "10px 14px 10px 18px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        cursor: "pointer",
        background: hover ? "rgba(255,255,255,0.03)" : "transparent",
        transition: "background 150ms var(--ease-smooth)",
      }}
    >
      {/* Left accent — 2px pin for persistent, 1px dim hairline otherwise */}
      <div style={{
        position: "absolute", left: 0, top: 8, bottom: 8,
        width: notif.persistent ? 2 : 1,
        background: notif.persistent ? toneColor : "rgba(255,255,255,0.08)",
        opacity: notif.persistent ? 0.8 : 1,
      }} />

      {/* Row 1: type + time + dismiss */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, whiteSpace: "nowrap" }}>
        <Icon name={meta.icon} size={11} style={{ color: toneColor, flexShrink: 0 }} />
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em",
          color: toneColor, fontWeight: 500,
        }}>
          {meta.label}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)" }}>::</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>
          {fmtRel(notif.minutesAgo)} ago
        </span>
        <div style={{ flex: 1 }} />
        {!notif.persistent && (
          <button onClick={(e)=>{e.stopPropagation(); onDismiss && onDismiss(notif.id);}}
            style={{ ...btnIcon, opacity: hover ? 1 : 0, transition: "opacity 120ms" }}
            title="Dismiss">
            <Icon name="x" size={11} />
          </button>
        )}
      </div>

      {/* Title */}
      <div style={{
        fontFamily: "var(--font-mohave)", fontSize: 14, color: "var(--text)",
        lineHeight: 1.3, marginBottom: 2,
      }}>
        {notif.title}
      </div>

      {/* Body */}
      {!compact && notif.body && (
        <div style={{
          fontFamily: "var(--font-mohave)", fontSize: 12, color: "var(--text-3)",
          lineHeight: 1.4,
          display: "-webkit-box", WebkitLineClamp: expanded ? 99 : 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {notif.body}
        </div>
      )}

      {/* Quick actions — hover reveal */}
      {notif.actionLabel && (
        <div style={{
          display: "flex", gap: 4, marginTop: hover || expanded ? 8 : 0,
          maxHeight: hover || expanded ? 40 : 0, overflow: "hidden",
          transition: "max-height 180ms var(--ease-smooth), margin-top 180ms var(--ease-smooth)",
        }}>
          <button style={{ ...actionBtnPrimary, color: toneColor, borderColor: `${toneColor === "var(--rose)" ? "var(--rose-line)" : toneColor === "var(--tan)" ? "var(--tan-line)" : "rgba(255,255,255,0.15)"}` }}>
            {notif.actionLabel}
            <Icon name="arrow-right" size={10} style={{ marginLeft: 4 }} />
          </button>
          <button style={actionBtnSecondary}>SNOOZE</button>
          {!notif.persistent && <button style={actionBtnSecondary}>DISMISS</button>}
        </div>
      )}
    </div>
  );
}

// ─── shared styles ──────────────────────────────────────────────────────────
const btnIcon = {
  width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: 2.5, border: "none", background: "transparent",
  color: "var(--text-3)", cursor: "pointer",
  transition: "background 120ms, color 120ms",
};
const btnText = {
  fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em",
  color: "var(--text-3)", background: "transparent", border: "none", cursor: "pointer",
  padding: 0,
};
const chipStyle = {
  fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em",
  padding: "4px 8px", borderRadius: 2.5,
  border: "1px solid rgba(255,255,255,0.08)",
  cursor: "pointer", transition: "all 120ms",
};
const actionBtnPrimary = {
  fontFamily: "var(--font-cakemono)", fontWeight: 300, fontSize: 10,
  letterSpacing: "0.08em", textTransform: "uppercase",
  padding: "5px 9px", borderRadius: 2.5,
  background: "transparent", border: "1px solid",
  cursor: "pointer", display: "inline-flex", alignItems: "center",
  color: "var(--text)",
};
const actionBtnSecondary = {
  fontFamily: "var(--font-cakemono)", fontWeight: 300, fontSize: 10,
  letterSpacing: "0.08em", textTransform: "uppercase",
  padding: "5px 9px", borderRadius: 2.5,
  background: "transparent", border: "1px solid rgba(255,255,255,0.08)",
  color: "var(--text-3)", cursor: "pointer",
};

window.RailFeed = RailFeed;
