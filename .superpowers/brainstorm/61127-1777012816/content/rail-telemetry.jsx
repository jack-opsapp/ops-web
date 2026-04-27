// Variation 2 — TELEMETRY
// Terminal-style log stream. Every notification is a single line with a
// fixed-width timestamp gutter, type prefix, and terse message. Dense, scannable,
// meant for operators who treat the rail like a tail -f.
// Hover a line to expand with body + inline actions.

function RailTelemetry({ notifs, onDismiss, open = true }) {
  const [activeId, setActiveId] = React.useState(null);
  const scrollRef = React.useRef(null);
  const [autoScroll, setAutoScroll] = React.useState(true);

  // Sort newest first
  const sorted = [...notifs].sort((a, b) => a.minutesAgo - b.minutesAgo);
  // Bucket by hour for subtle grouping
  let lastHour = -1;

  return (
    <div style={{
      position: "absolute", top: 72, right: open ? 0 : -380, bottom: 16, width: 380,
      transition: "right 260ms var(--ease-smooth)",
      display: "flex", flexDirection: "column",
      background: "rgba(6,6,8,0.82)",
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
      fontFamily: "var(--font-mono)",
    }}>
      {/* Top-edge lit gradient */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: 5, pointerEvents: "none",
        background: "linear-gradient(180deg, rgba(255,255,255,0.04), transparent 40%)",
      }} />

      {/* Header — "comms channel" framing */}
      <div style={{
        display: "flex", alignItems: "center", padding: "10px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.06)", gap: 8,
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "var(--olive)",
          boxShadow: "0 0 8px var(--olive)",
          animation: "pulse 2s ease-in-out infinite",
        }} />
        <span style={{ fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.18em" }}>//</span>
        <span style={{ fontFamily: "var(--font-cakemono)", fontWeight: 300, fontSize: 13, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          COMMS
        </span>
        <span style={{ fontSize: 10, color: "var(--text-3)", letterSpacing: "0.14em" }}>
          :: CH-01 :: {notifs.length} EVT
        </span>
        <div style={{ flex: 1 }} />
        <button title="Pause stream" onClick={() => setAutoScroll(!autoScroll)} style={{
          ...miniBtn,
          color: autoScroll ? "var(--olive)" : "var(--text-3)",
          borderColor: autoScroll ? "var(--olive-line)" : "rgba(255,255,255,0.08)",
        }}>
          {autoScroll ? "LIVE" : "HOLD"}
        </button>
        <button title="Filter" style={miniBtn}>FILTER</button>
      </div>

      {/* Column headers */}
      <div style={{
        display: "grid", gridTemplateColumns: "52px 70px 1fr 28px",
        padding: "6px 12px", gap: 8,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        fontSize: 9, color: "var(--text-mute)", letterSpacing: "0.2em",
      }}>
        <span>TIME</span>
        <span>TYPE</span>
        <span>MESSAGE</span>
        <span></span>
      </div>

      {/* Stream */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }} className="hide-scrollbar">
        {sorted.map((n, i) => {
          const meta = NOTIF_TYPES[n.type] || { label: n.type.toUpperCase(), icon: "circle", tone: "info" };
          const toneColor = TONE_COLOR[meta.tone];
          const hour = Math.floor(n.minutesAgo / 60);
          const showDivider = hour !== lastHour;
          lastHour = hour;
          const isActive = activeId === n.id;

          return (
            <React.Fragment key={n.id}>
              {showDivider && i > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px" }}>
                  <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }} />
                  <span style={{ fontSize: 9, color: "var(--text-mute)", letterSpacing: "0.18em" }}>
                    — T-{hour}h
                  </span>
                  <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }} />
                </div>
              )}
              <TelemetryRow notif={n} meta={meta} toneColor={toneColor}
                active={isActive}
                onClick={() => setActiveId(isActive ? null : n.id)}
                onDismiss={onDismiss} />
            </React.Fragment>
          );
        })}
        <div style={{ padding: 14, textAlign: "center" }}>
          <span style={{ fontSize: 9, color: "var(--text-mute)", letterSpacing: "0.18em" }}>
            ▓ EOF ▓
          </span>
        </div>
      </div>

      {/* Footer — uptime strip */}
      <div style={{
        display: "flex", alignItems: "center", padding: "6px 12px", gap: 8,
        borderTop: "1px solid rgba(255,255,255,0.06)",
        fontSize: 9, color: "var(--text-mute)", letterSpacing: "0.14em",
      }}>
        <span>UP :: 14D 06H 22M</span>
        <span style={{ color: "var(--text-mute)" }}>·</span>
        <span>LAT :: 18ms</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: "var(--olive)" }}>● NOMINAL</span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function TelemetryRow({ notif, meta, toneColor, active, onClick, onDismiss }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      onClick={onClick}
      style={{
        cursor: "pointer",
        background: active ? "rgba(255,255,255,0.04)" : hover ? "rgba(255,255,255,0.02)" : "transparent",
        borderLeft: `2px solid ${notif.persistent ? toneColor : "transparent"}`,
        paddingLeft: notif.persistent ? 0 : 2,
        transition: "background 120ms",
      }}
    >
      {/* One-line row */}
      <div style={{
        display: "grid", gridTemplateColumns: "52px 70px 1fr 28px",
        padding: "5px 12px", gap: 8, alignItems: "center",
      }}>
        <span style={{ fontSize: 10, color: "var(--text-mute)" }}>{fmtAbs(notif.minutesAgo)}</span>
        <span style={{ fontSize: 9, color: toneColor, letterSpacing: "0.14em", fontWeight: 500 }}>
          {meta.label.padEnd(8, " ")}
        </span>
        <span style={{
          fontFamily: "var(--font-mohave)", fontSize: 12, color: "var(--text)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {notif.title}
        </span>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          {notif.persistent ? (
            <span title="Persistent" style={{ fontSize: 10, color: toneColor, opacity: 0.7 }}>▣</span>
          ) : (
            <span style={{
              fontSize: 10, color: "var(--text-mute)",
              opacity: hover ? 0 : 1, transition: "opacity 120ms",
            }}>→</span>
          )}
          {hover && !notif.persistent && (
            <button onClick={(e)=>{e.stopPropagation(); onDismiss && onDismiss(notif.id);}}
              style={{ ...miniBtn, padding: 0, width: 18, height: 18, border: "none", color: "var(--text-3)" }}>
              ×
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {active && (
        <div style={{
          padding: "0 12px 10px 64px", display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{
            fontFamily: "var(--font-mohave)", fontSize: 11.5, color: "var(--text-3)",
            lineHeight: 1.5, borderLeft: `1px solid rgba(255,255,255,0.1)`,
            paddingLeft: 8,
          }}>
            {notif.body}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {notif.actionLabel && (
              <button style={{
                fontFamily: "var(--font-cakemono)", fontSize: 10, letterSpacing: "0.08em",
                textTransform: "uppercase", padding: "4px 9px", borderRadius: 2.5,
                background: "transparent", border: `1px solid ${toneColor === "var(--rose)" ? "var(--rose-line)" : toneColor === "var(--tan)" ? "var(--tan-line)" : "rgba(255,255,255,0.2)"}`,
                color: "var(--text)", cursor: "pointer",
              }}>
                {notif.actionLabel} →
              </button>
            )}
            <button style={{
              fontFamily: "var(--font-cakemono)", fontSize: 10, letterSpacing: "0.08em",
              textTransform: "uppercase", padding: "4px 9px", borderRadius: 2.5,
              background: "transparent", border: "1px solid rgba(255,255,255,0.08)",
              color: "var(--text-3)", cursor: "pointer",
            }}>SNOOZE 1H</button>
            {!notif.persistent && (
              <button onClick={(e)=>{e.stopPropagation(); onDismiss && onDismiss(notif.id);}} style={{
                fontFamily: "var(--font-cakemono)", fontSize: 10, letterSpacing: "0.08em",
                textTransform: "uppercase", padding: "4px 9px", borderRadius: 2.5,
                background: "transparent", border: "1px solid rgba(255,255,255,0.08)",
                color: "var(--text-3)", cursor: "pointer",
              }}>ACK</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const miniBtn = {
  fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em",
  padding: "3px 7px", borderRadius: 2.5,
  background: "transparent", border: "1px solid rgba(255,255,255,0.08)",
  color: "var(--text-3)", cursor: "pointer",
};

window.RailTelemetry = RailTelemetry;
