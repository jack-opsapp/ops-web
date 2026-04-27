// Shared chrome: Sidebar stub, TopBar stub, Backdrop.
// Mimics the ops-web dashboard layout just enough to give the rail context.

const Icon = ({ name, size = 16, stroke = 1.5, style, className }) => (
  <i data-lucide={name} style={{ width: size, height: size, strokeWidth: stroke, ...style }} className={className} />
);
window.Icon = Icon;

// ─── Sidebar ────────────────────────────────────────────────────────────────
function Sidebar() {
  const items = [
    { icon: "layout-dashboard", label: "DASHBOARD", active: true },
    { icon: "briefcase", label: "PROJECTS", count: 12 },
    { icon: "calendar", label: "SCHEDULE" },
    { icon: "users", label: "CLIENTS", count: 247 },
    { icon: "map", label: "MAP" },
    { icon: "git-branch", label: "PIPELINE", count: 6 },
    { icon: "inbox", label: "INBOX", count: 3 },
    { icon: "file-text", label: "ESTIMATES" },
    { icon: "package", label: "INVENTORY" },
    { icon: "receipt", label: "INVOICES" },
    { icon: "calculator", label: "ACCOUNTING" },
  ];
  return (
    <div style={{
      position: "absolute", top: 0, left: 0, bottom: 0, width: 72,
      background: "var(--glass)",
      backdropFilter: "blur(20px) saturate(1.2)",
      WebkitBackdropFilter: "blur(20px) saturate(1.2)",
      borderRight: "1px solid var(--glass-border)",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "14px 0", gap: 2, zIndex: 9,
    }}>
      {/* Mark */}
      <div style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
        <img src="assets/ops-mark.svg" alt="OPS" style={{ width: 22, height: 22, filter: "invert(1) brightness(0.92)" }} />
      </div>
      {/* Section label */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.18em", color: "var(--text-mute)", marginBottom: 4 }}>
        ///
      </div>
      {items.map((it) => (
        <div key={it.label} style={{
          width: 52, height: 44, borderRadius: 6,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 2, cursor: "pointer",
          background: it.active ? "rgba(255,255,255,0.06)" : "transparent",
          color: it.active ? "var(--text)" : "var(--text-3)",
          position: "relative",
        }}>
          {it.active && (
            <div style={{
              position: "absolute", left: -10, top: "50%", transform: "translateY(-50%)",
              width: 2, height: 18, background: "var(--text)",
            }} />
          )}
          <Icon name={it.icon} size={16} />
          <span style={{ fontFamily: "var(--font-cakemono)", fontSize: 7.5, letterSpacing: "0.08em", fontWeight: 300 }}>
            {it.label}
          </span>
          {it.count != null && (
            <span style={{
              position: "absolute", top: 4, right: 6,
              fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-mute)",
            }}>
              {it.count}
            </span>
          )}
        </div>
      ))}
      <div style={{ flex: 1 }} />
      {/* Footer */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-mute)", letterSpacing: "0.1em" }}>
        v2.4.1
      </div>
    </div>
  );
}
window.Sidebar = Sidebar;

// ─── TopBar ─────────────────────────────────────────────────────────────────
function TopBar({ title = "DASHBOARD" }) {
  return (
    <div style={{
      position: "absolute", top: 0, left: 72, right: 0, height: 56,
      background: "var(--glass)",
      backdropFilter: "blur(20px) saturate(1.2)",
      WebkitBackdropFilter: "blur(20px) saturate(1.2)",
      borderBottom: "1px solid var(--glass-border)",
      display: "flex", alignItems: "center", padding: "0 16px",
      zIndex: 8,
    }}>
      <h1 style={{
        fontFamily: "var(--font-cakemono)", fontWeight: 300,
        fontSize: 22, textTransform: "uppercase", color: "var(--text)",
        margin: 0, letterSpacing: "0.02em",
      }}>
        {title}
      </h1>
      <div style={{ flex: 1 }} />
      {/* Search stub */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, height: 40,
        padding: "0 10px", borderRadius: 2.5,
        background: "var(--glass-subtle)",
        border: "1px solid rgba(255,255,255,0.06)",
        width: 220, color: "var(--text-3)",
      }}>
        <Icon name="search" size={14} />
        <span style={{ fontFamily: "var(--font-mohave)", fontSize: 13 }}>Search</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", borderRadius: 3, padding: "1px 5px" }}>
          ⌘K
        </span>
      </div>
      <div style={{ width: 8 }} />
      {/* Sync indicator */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, height: 40, padding: "0 10px",
        borderRadius: 2.5, background: "var(--glass-subtle)",
        border: "1px solid rgba(255,255,255,0.06)", color: "var(--text-3)",
      }}>
        <Icon name="check" size={14} />
      </div>
    </div>
  );
}
window.TopBar = TopBar;

// ─── Backdrop: dark map-ish tile ────────────────────────────────────────────
function Backdrop() {
  // Faint radial + grid to hint at map tiles without photography
  return (
    <div style={{
      position: "absolute", inset: 0, overflow: "hidden",
      background: "#000",
    }}>
      {/* radial ambient */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 30% 20%, rgba(111,148,176,0.06), transparent 55%), radial-gradient(ellipse at 80% 70%, rgba(196,168,104,0.04), transparent 50%)",
      }} />
      {/* grid */}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.35 }}>
        <defs>
          <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="1"/>
          </pattern>
          <pattern id="grid2" width="240" height="240" patternUnits="userSpaceOnUse">
            <path d="M 240 0 L 0 0 0 240" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)"/>
        <rect width="100%" height="100%" fill="url(#grid2)"/>
      </svg>
      {/* roads hairlines */}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.25 }}>
        <line x1="0" y1="38%" x2="100%" y2="42%" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5"/>
        <line x1="20%" y1="0" x2="25%" y2="100%" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5"/>
        <line x1="65%" y1="0" x2="62%" y2="100%" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5"/>
        <line x1="0" y1="75%" x2="100%" y2="72%" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5"/>
        {/* dots — job pins */}
        {[[18,30],[42,55],[68,48],[33,70],[77,28],[55,80]].map(([x,y],i) => (
          <circle key={i} cx={`${x}%`} cy={`${y}%`} r="2" fill="rgba(111,148,176,0.5)"/>
        ))}
      </svg>
    </div>
  );
}
window.Backdrop = Backdrop;

// ─── Shell: Sidebar + TopBar + Backdrop + children ──────────────────────────
function Shell({ children, title, contentDim = false }) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#000" }}>
      <Backdrop />
      <Sidebar />
      <TopBar title={title} />
      {/* Dim layer to push rail forward */}
      {contentDim && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", pointerEvents: "none", zIndex: 2 }} />
      )}
      {/* Faux dashboard widgets to sell the scene */}
      <FauxDashboard />
      {children}
    </div>
  );
}
window.Shell = Shell;

// Minimal faux dashboard so the canvas isn't empty
function FauxDashboard() {
  const boxStyle = {
    background: "var(--glass)",
    backdropFilter: "blur(20px) saturate(1.2)",
    WebkitBackdropFilter: "blur(20px) saturate(1.2)",
    border: "1px solid var(--glass-border)",
    borderRadius: 5,
    padding: "12px 14px",
  };
  return (
    <div style={{
      position: "absolute", top: 72, left: 88, right: 400, bottom: 16,
      display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "auto auto 1fr",
      gap: 12, zIndex: 1,
    }}>
      <div style={{ ...boxStyle, gridColumn: "1 / 3" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.16em" }}>// OPERATOR :: JACKSON</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 6 }}>
          <span style={{ fontFamily: "var(--font-mohave)", fontWeight: 300, fontSize: 48, color: "var(--text)", lineHeight: 1 }}>12</span>
          <span style={{ fontFamily: "var(--font-cakemono)", fontWeight: 300, fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>ACTIVE JOBS</span>
          <span style={{ fontFamily: "var(--font-mohave)", fontWeight: 300, fontSize: 48, color: "var(--text)", lineHeight: 1, marginLeft: 24 }}>$48,240</span>
          <span style={{ fontFamily: "var(--font-cakemono)", fontWeight: 300, fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>PENDING</span>
        </div>
      </div>
      <div style={boxStyle}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.16em" }}>// THIS WEEK</div>
        <div style={{ display: "flex", gap: 4, marginTop: 10, alignItems: "flex-end", height: 52 }}>
          {[40,62,48,72,55,80,38].map((h,i) => (
            <div key={i} style={{ flex: 1, background: "rgba(255,255,255,0.15)", height: `${h}%`, borderRadius: 2 }}/>
          ))}
        </div>
      </div>
      <div style={boxStyle}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.16em" }}>// PIPELINE</div>
        <div style={{ marginTop: 8 }}>
          {[["LEAD", 18, 40],["QUOTE", 9, 28],["WON", 6, 70]].map(([l,n,w]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", width: 44 }}>{l}</span>
              <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                <div style={{ width: `${w}%`, height: "100%", background: "rgba(255,255,255,0.35)", borderRadius: 2 }}/>
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text)" }}>{n}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ ...boxStyle, gridColumn: "1 / 3" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.16em" }}>// TODAY'S JOBS</div>
        <div style={{ marginTop: 8 }}>
          {[
            ["08:00", "1524 HARBOUR LN", "ROOFING", "IN PROGRESS"],
            ["11:30", "88 BLOOR ST W", "INSPECTION", "QUEUED"],
            ["14:00", "412 DUNDAS AVE", "REPAIR", "QUEUED"],
            ["16:30", "7 KING ST E", "ESTIMATE", "QUEUED"],
          ].map(([t,a,k,s],i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr 100px 100px", gap: 12, padding: "6px 0", borderTop: i ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)" }}>{t}</span>
              <span style={{ fontFamily: "var(--font-mohave)", fontSize: 13, color: "var(--text)" }}>{a}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", letterSpacing: "0.12em" }}>{k}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: s === "IN PROGRESS" ? "var(--olive)" : "var(--text-mute)", letterSpacing: "0.12em" }}>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
