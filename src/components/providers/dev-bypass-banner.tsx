"use client";

/**
 * Visual indicator + identity switcher for the dev auth bypass. Renders a
 * small tactical pill in the bottom-left whenever
 * NEXT_PUBLIC_DEV_BYPASS_AUTH=true. Returns null otherwise.
 *
 * Click any user pill to switch identity — sets the cookie, signs out,
 * reloads. AuthProvider's bypass flow picks up the new cookie on next mount.
 */

import { useEffect, useState } from "react";
import {
  fetchBypassMeta,
  isDevBypassEnabled,
  switchBypassUser,
  type BypassMetaResponse,
} from "@/lib/firebase/dev-bypass";

export function DevBypassBanner() {
  const [meta, setMeta] = useState<BypassMetaResponse | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!isDevBypassEnabled()) return;
    let cancelled = false;
    fetchBypassMeta().then((m) => {
      if (!cancelled) setMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isDevBypassEnabled()) return null;

  const handleSwitch = async (key: string) => {
    if (switching || key === meta?.key) return;
    setSwitching(true);
    await switchBypassUser(key);
  };

  return (
    <div
      className="fixed left-3 bottom-3 select-none"
      style={{ zIndex: 9999 }}
    >
      <div
        className="flex items-center gap-2 px-2 py-1 font-mono uppercase"
        style={{
          background: "rgba(18, 18, 20, 0.78)",
          backdropFilter: "blur(28px) saturate(1.3)",
          WebkitBackdropFilter: "blur(28px) saturate(1.3)",
          border: "1px solid rgba(196, 168, 104, 0.35)",
          borderRadius: 4,
          fontSize: 10,
          letterSpacing: "0.16em",
          fontFeatureSettings: '"tnum" 1, "zero" 1',
        }}
      >
        <span style={{ color: "#C4A868" }}>// DEV BYPASS</span>

        {meta ? (
          <div className="flex items-center gap-1">
            {meta.available.map((u) => {
              const active = u.key === meta.key;
              return (
                <button
                  key={u.key}
                  type="button"
                  onClick={() => handleSwitch(u.key)}
                  disabled={switching || active}
                  title={u.email}
                  className="px-1.5 py-[2px] uppercase tracking-wider transition-colors"
                  style={{
                    fontFamily: "var(--font-mono), monospace",
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    color: active ? "var(--text)" : "var(--text-3)",
                    background: active
                      ? "rgba(196, 168, 104, 0.18)"
                      : "transparent",
                    border: active
                      ? "1px solid rgba(196, 168, 104, 0.35)"
                      : "1px solid transparent",
                    borderRadius: 2,
                    cursor: active || switching ? "default" : "pointer",
                    opacity: switching && !active ? 0.4 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (active || switching) return;
                    (e.currentTarget as HTMLElement).style.color =
                      "var(--text-2)";
                    (e.currentTarget as HTMLElement).style.background =
                      "rgba(255,255,255,0.04)";
                  }}
                  onMouseLeave={(e) => {
                    if (active || switching) return;
                    (e.currentTarget as HTMLElement).style.color =
                      "var(--text-3)";
                    (e.currentTarget as HTMLElement).style.background =
                      "transparent";
                  }}
                >
                  {u.label}
                </button>
              );
            })}
            <span
              className="ml-1"
              style={{ color: "var(--text-mute)", letterSpacing: "0.06em" }}
            >
              · {meta.email}
            </span>
          </div>
        ) : (
          <span style={{ color: "var(--text-3)" }}>activating…</span>
        )}
      </div>
    </div>
  );
}
