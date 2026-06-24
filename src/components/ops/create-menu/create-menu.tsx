"use client";

/**
 * CreateMenu — body of the bottom-right Create popover (WEB OVERHAUL P5).
 *
 * Presentational. Renders the `// CREATE` header, one row per quick action
 * (icon · label · 3-letter mono hint code), and a footer pairing the
 * CUSTOMIZE entry with a ⌘K search hint. All state — open/close, the setup
 * gate, dispatch — lives in CreateCluster; this component only renders and
 * calls up.
 *
 * Replaces the old QuickActionsDrawer's list. The accent budget is spent
 * entirely on the trigger that opens this menu, so every row here stays
 * monochrome (text-3 → text on hover); the hint code is text-mute.
 */

import type { FABAction } from "@/lib/constants/fab-actions";

interface CreateMenuProps {
  actions: FABAction[];
  /** `quick-actions` dictionary accessor. */
  t: (key: string) => string;
  onRun: (action: FABAction) => void;
  onCustomize: () => void;
}

export function CreateMenu({ actions, t, onRun, onCustomize }: CreateMenuProps) {
  return (
    <div className="flex flex-col">
      {/* Header — `// CREATE` + the Q shortcut chip (Widget.jsx anatomy). */}
      <div className="flex items-center border-b border-[var(--line)] px-3.5 pb-2 pt-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          <span aria-hidden className="text-text-mute">
            {"// "}
          </span>
          {t("menu.title")}
        </span>
        <span className="flex-1" />
        <span
          aria-hidden
          className="rounded-sm border border-border-subtle bg-fill-neutral-dim px-1.5 py-px font-mono text-[10px] text-text-2"
        >
          {t("tab.shortcut")}
        </span>
      </div>

      {/* Rows */}
      <div role="list" className="p-1.5">
        {actions.length === 0 ? (
          <div className="px-2.5 py-4">
            <span className="font-mono text-[11px] tracking-[0.16em] text-text-3">
              {t("empty.noActions")}
            </span>
          </div>
        ) : (
          actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                role="listitem"
                onClick={() => onRun(action)}
                className="group flex w-full cursor-pointer items-center gap-2.5 rounded px-2.5 py-2 text-left transition-colors duration-150 hover:bg-fill-neutral-dim focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-1 focus-visible:ring-offset-black"
              >
                <Icon className="h-[15px] w-[15px] shrink-0 text-text-3 transition-colors duration-150 group-hover:text-text-2" />
                <span className="flex-1 truncate font-mohave text-[14px] text-text-2 transition-colors duration-150 group-hover:text-text">
                  {t(action.labelKey)}
                </span>
                <span
                  aria-hidden
                  className="font-mono text-[10px] tracking-[0.08em] text-text-mute"
                  style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                >
                  {action.hintCode}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Footer — [ CUSTOMIZE ] + ⌘K search hint */}
      <div className="flex items-center border-t border-[var(--line)] px-3.5 py-2.5">
        <button
          type="button"
          onClick={onCustomize}
          className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-text-3 transition-colors duration-150 hover:text-text focus-visible:text-text focus-visible:outline-none"
        >
          {`[ ${t("footer.customize")} ]`}
        </button>
        <span className="flex-1" />
        <span
          aria-hidden
          className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-text-mute"
        >
          <span className="rounded-sm border border-border-subtle bg-fill-neutral-dim px-1 py-px">
            {"⌘K"}
          </span>
          {t("menu.searchHint")}
        </span>
      </div>
    </div>
  );
}
