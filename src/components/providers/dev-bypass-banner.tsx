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
import { OpsMark } from "@/components/brand";
import { cn } from "@/lib/utils/cn";
import {
  fetchBypassMeta,
  isDevBypassEnabled,
  switchBypassUser,
  type BypassMetaResponse,
} from "@/lib/firebase/dev-bypass";

export function DevBypassBanner() {
  const [meta, setMeta] = useState<BypassMetaResponse | null>(null);
  const [switching, setSwitching] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
      data-dev-bypass-banner
      data-dev-bypass-expanded={expanded ? "true" : "false"}
      className="fixed bottom-[12px] left-[12px] select-none"
      style={{ zIndex: 2147483647 }}
    >
      {expanded && (
        <div
          data-dev-bypass-controls
          className="glass-dense absolute bottom-[calc(100%+8px)] left-0 flex h-[40px] max-w-[calc(100vw-24px)] items-center gap-[4px] overflow-x-auto rounded-panel border border-line p-[4px] font-mono uppercase [&::before]:rounded-panel"
          style={{
            fontSize: 10,
            letterSpacing: "0.16em",
            fontFeatureSettings: '"tnum" 1, "zero" 1',
          }}
        >
          <span className="shrink-0 px-[6px] text-text-3">
            {"// DEV BYPASS"}
          </span>

          {meta ? (
            <div className="flex items-center gap-[4px]">
              {meta.available.map((u) => {
                const active = u.key === meta.key;
                return (
                  <button
                    key={u.key}
                    type="button"
                    onClick={() => handleSwitch(u.key)}
                    disabled={switching || active}
                    title={u.email}
                    className={cn(
                      "h-[24px] rounded-[3px] border px-[6px] font-mono uppercase tracking-wider transition-colors",
                      active
                        ? "border-line-hi bg-surface-active text-text"
                        : "border-transparent text-text-3 hover:bg-surface-hover hover:text-text",
                      switching && !active && "opacity-40"
                    )}
                    style={{
                      fontFamily: "var(--font-mono), monospace",
                      fontSize: 10,
                      letterSpacing: "0.12em",
                      cursor: active || switching ? "default" : "pointer",
                    }}
                  >
                    {u.label}
                  </button>
                );
              })}
              <span
                className="ml-[4px] max-w-[240px] truncate text-text-mute"
                style={{ letterSpacing: "0.06em" }}
              >
                · {meta.email}
              </span>
            </div>
          ) : (
            <span className="shrink-0 px-[6px] text-text-3">activating…</span>
          )}
        </div>
      )}

      <div
        className="glass-dense flex items-center gap-[4px] rounded-panel border border-line p-[4px] font-mono uppercase [&::before]:rounded-panel"
        style={{
          fontSize: 10,
          letterSpacing: "0.16em",
          fontFeatureSettings: '"tnum" 1, "zero" 1',
        }}
      >
        <button
          type="button"
          data-dev-bypass-toggle
          aria-label="// DEV BYPASS"
          aria-expanded={expanded}
          className={cn(
            "flex h-[32px] w-[32px] items-center justify-center rounded border transition-colors",
            expanded
              ? "border-line-hi bg-surface-active text-text"
              : "border-transparent text-text-3 hover:bg-surface-hover hover:text-text"
          )}
          onClick={() => setExpanded((current) => !current)}
        >
          <OpsMark title="" className="h-[17px] w-[10px]" />
        </button>
      </div>
    </div>
  );
}
