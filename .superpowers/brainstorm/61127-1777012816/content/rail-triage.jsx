// Variation 3 — TRIAGE (v3: chip-filter buckets + standardized icons)
// - Bucket headers replaced with chip-style filter buttons (like Feed's chips).
// - Clicking a chip filters the list to that bucket. "ALL" is default.
// - Every row shows its type icon (standardized via NOTIF_TYPES in data.js).
// - Left accent hairline stays: rose for critical, tan for attn, none for ambient.

function RailTriage({ notifs, onDismiss, open = true }) {
  const [expandedId, setExpandedId] = React.useState(null);
  const [filter, setFilter] = React.useState("all");

  const withTone = (n) => {
    const meta = NOTIF_TYPES[n.type] || { tone: "info" };
    return meta.tone === "info" ? "ambient" : meta.tone; // roll info → ambient
  };

  const counts = { critical: 0, attn: 0, ambient: 0 };
  notifs.forEach(n => counts[withTone(n)]++);

  const visible = filter === "all" ? notifs : notifs.filter(n => withTone(n) === filter);

  const CHIPS = [
    { key: "all",      label: "ALL",       color: "var(--text)",    count: notifs.length },
    { key: "critical", label: "CRITICAL",  color: "var(--rose)",    line: "var(--rose-line)",   soft: "var(--rose-soft)",   count: counts.critical },
    { key: "attn",     label: "ATTENTION", color: "var(--tan)",     line: "var(--tan-line)",    soft: "var(--tan-soft)",    count: counts.attn },
    { key: "ambient",  label: "AMBIENT",   color: "var(--text-3)",  line: "rgba(255,255,255,0.12)", soft: "rgba(255,255,255,0.04)", count: counts.ambient },
  ];

  const toneOf = (n) => {
    const t = withTone(n);
    if (t === "critical") return { color: "var(--rose)", line: "var(--rose-line)", soft: "var(--rose-soft)" };
    if (t === "attn")     return { color: "var(--tan)",  line: "var(--tan-line)",  soft: "var(--tan-soft)" };
    return { color: "var(--text-3)", line: "rgba(255,255,255,0.08)", soft: "rgba(255,255,255,0.04)" };
  };

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
      borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
      borderTopRightRadius: 0, borderBottomRightRadius: 0,
      zIndex: 10, overflow: "hidden",
    }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 5, pointerEvents: "none",
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), transparent 40%)" }} />

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", padding: "12px 14px 10px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.16em" }}>//</span>
        <span style={{ fontFamily: "var(--font-cakemono)", fontWeight: 300, fontSize: 13, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.08em", marginLeft: 6 }}>
          NOTIFICATIONS
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)", marginLeft: 8 }}>
          {notifs.length}
        </span>
        <div style={{ flex: 1 }} />
        <button title="Mute" style={tIconBtn}><Icon name="bell-off" size={12} /></button>
        <button title="Clear all" style={tIconBtn}><Icon name="check-check" size={12} /></button>
      </div>

      {/* Filter chips — one per bucket, colored */}
      <div style={{ display: "flex", gap: 4, padding: "8px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap" }}>
        {CHIPS.map(c => {
          const active = filter === c.key;
          return (
            <button key={c.key} onClick={() => setFilter(c.key)} style={{
              fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em",
              padding: "4px 8px", borderRadius: 2.5, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 5,
              background: active ? (c.soft || "rgba(255,255,255,0.08)") : "transparent",
              border: `1px solid ${active ? (c.line || "rgba(255,255,255,0.18)") : "rgba(255,255,255,0.08)"}`,
              color: active ? c.color : "var(--text-3)",
              transition: "all 120ms",
            }}>
              {c.key !== "all" && (
                <span style={{ width: 4, height: 4, background: c.color, opacity: active ? 1 : 0.6 }} />
              )}
              {c.label}
              <span style={{ color: active ? c.color : "var(--text-mute)", opacity: active ? 0.7 : 1 }}>
                {c.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }} className="hide-scrollbar">
        {visible.length === 0 && (
          <div style={{ padding: 28, textAlign: "center" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.16em" }}>
              — ALL CLEAR —
            </span>
          </div>
        )}
        {visible.map(n => (
          <TriageRow key={n.id} notif={n} tone={toneOf(n)}
            expanded={expandedId === n.id}
            onToggle={() => setExpandedId(expandedId === n.id ? null : n.id)}
            onDismiss={onDismiss} />
        ))}
        {visible.length > 0 && (
          <div style={{ padding: "10px 14px", textAlign: "center" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-mute)", letterSpacing: "0.18em" }}>
              [ EOF ]
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.14em" }}>
          LAST SYNC {fmtAbs(1)}
        </span>
        <div style={{ flex: 1 }} />
        <button style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", color: "var(--text-3)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
          VIEW ALL →
        </button>
      </div>
    </div>
  );
}

function TriageRow({ notif, tone, expanded, onToggle, onDismiss }) {
  const [hover, setHover] = React.useState(false);
  const meta = NOTIF_TYPES[notif.type] || { label: notif.type.toUpperCase(), icon: "circle" };
  // Accent hairline: only when there's earth-tone (critical/attn)
  const showAccent = tone.color === "var(--rose)" || tone.color === "var(--tan)";

  return (
    <div
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      onClick={onToggle}
      style={{
        position: "relative", padding: "9px 14px 9px 14px",
        cursor: "pointer",
        background: hover || expanded ? "rgba(255,255,255,0.03)" : "transparent",
        borderTop: "1px solid rgba(255,255,255,0.04)",
        transition: "background 120ms var(--ease-smooth)",
      }}
    >
      {/* Left accent */}
      {showAccent && (
        <div style={{
          position: "absolute", left: 0, top: 10, bottom: 10,
          width: notif.persistent ? 2 : 1,
          background: tone.color,
          opacity: notif.persistent ? 0.85 : 0.45,
        }} />
      )}

      {/* Main row: icon + title + action hint + time */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
        {/* Standardized type icon in a small square, tone-tinted for critical/attn */}
        <div style={{
          width: 20, height: 20, borderRadius: 2.5, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: showAccent ? tone.soft : "rgba(255,255,255,0.04)",
          border: `1px solid ${showAccent ? tone.line : "rgba(255,255,255,0.06)"}`,
          color: showAccent ? tone.color : "var(--text-3)",
        }}>
          <Icon name={meta.icon} size={12} />
        </div>
        <span style={{
          fontFamily: "var(--font-mohave)", fontSize: 13.5, color: "var(--text)",
          flex: 1, overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
        }}>
          {notif.title}
        </span>
        {notif.actionLabel && !expanded && !hover && (
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em",
            color: tone.color, opacity: 0.75, flexShrink: 0,
          }}>
            {notif.actionLabel}
          </span>
        )}
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)",
          flexShrink: 0, minWidth: 24, textAlign: "right",
        }}>
          {fmtRel(notif.minutesAgo)}
        </span>
      </div>

      {/* Expanded body + actions */}
      <div style={{
        maxHeight: expanded ? 120 : 0, overflow: "hidden",
        transition: "max-height 200ms var(--ease-smooth)",
        paddingLeft: 28,
      }}>
        {notif.body && (
          <div style={{
            fontFamily: "var(--font-mohave)", fontSize: 12, color: "var(--text-3)",
            lineHeight: 1.45, marginTop: 6,
          }}>
            {notif.body}
          </div>
        )}
        <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
          {notif.actionLabel && (
            <button onClick={(e)=>e.stopPropagation()} style={{
              fontFamily: "var(--font-cakemono)", fontSize: 10, letterSpacing: "0.08em",
              textTransform: "uppercase", padding: "4px 9px", borderRadius: 2.5,
              background: tone.soft, border: `1px solid ${tone.line}`,
              color: showAccent ? tone.color : "var(--text)",
              cursor: "pointer",
            }}>
              {notif.actionLabel} →
            </button>
          )}
          <button onClick={(e)=>e.stopPropagation()} style={tSecondaryBtn}>SNOOZE</button>
          {!notif.persistent && (
            <button onClick={(e)=>{e.stopPropagation(); onDismiss && onDismiss(notif.id);}} style={tSecondaryBtn}>
              DISMISS
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const tIconBtn = {
  width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: 2.5, border: "none", background: "transparent",
  color: "var(--text-3)", cursor: "pointer",
};
const tSecondaryBtn = {
  fontFamily: "var(--font-cakemono)", fontSize: 10, letterSpacing: "0.08em",
  textTransform: "uppercase", padding: "4px 9px", borderRadius: 2.5,
  background: "transparent", border: "1px solid rgba(255,255,255,0.08)",
  color: "var(--text-3)", cursor: "pointer",
};

window.RailTriage = RailTriage;
