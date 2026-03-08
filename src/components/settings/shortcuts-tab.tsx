"use client";

import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useDictionary } from "@/i18n/client";

const shortcutGroups = [
  {
    categoryKey: "shortcuts.navigation",
    shortcuts: [
      { keys: ["1"], descKey: "shortcuts.dashboard" },
      { keys: ["2"], descKey: "shortcuts.projects" },
      { keys: ["3"], descKey: "shortcuts.calendar" },
      { keys: ["4"], descKey: "shortcuts.clients" },
      { keys: ["5"], descKey: "shortcuts.jobBoard" },
      { keys: ["6"], descKey: "shortcuts.team" },
      { keys: ["7"], descKey: "shortcuts.map" },
      { keys: ["8"], descKey: "shortcuts.pipeline" },
      { keys: ["9"], descKey: "shortcuts.invoices" },
      { keys: ["\u2318", "K"], descKey: "shortcuts.commandPalette" },
    ],
  },
  {
    categoryKey: "shortcuts.actions",
    shortcuts: [
      { keys: ["\u2318", "\u21E7", "P"], descKey: "shortcuts.newProject" },
      { keys: ["\u2318", "\u21E7", "C"], descKey: "shortcuts.newClient" },
    ],
  },
  {
    categoryKey: "shortcuts.interface",
    shortcuts: [
      { keys: ["\u2318", "B"], descKey: "shortcuts.toggleSidebar" },
    ],
  },
];

export function ShortcutsTab() {
  const { t } = useDictionary("settings");
  const showShortcutHints = usePreferencesStore((s) => s.showShortcutHints);
  const toggleShortcutHints = usePreferencesStore((s) => s.toggleShortcutHints);

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardContent className="p-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mohave text-body text-text-primary">{t("shortcuts.showShortcuts")}</p>
              <p className="font-kosugi text-[11px] text-text-tertiary">
                {t("shortcuts.showShortcutsDesc")}
              </p>
            </div>
            <button
              onClick={toggleShortcutHints}
              className={cn(
                "w-[40px] h-[22px] rounded-full transition-colors relative",
                showShortcutHints ? "bg-ops-accent" : "bg-background-elevated"
              )}
            >
              <span
                className={cn(
                  "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                  showShortcutHints ? "right-[2px]" : "left-[2px]"
                )}
              />
            </button>
          </div>
        </CardContent>
      </Card>

      {showShortcutHints && (
        <>
          {shortcutGroups.map((group) => (
            <Card key={group.categoryKey}>
              <CardHeader>
                <CardTitle>{t(group.categoryKey)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-0">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.descKey}
                    className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0"
                  >
                    <span className="font-mohave text-body text-text-secondary">
                      {t(shortcut.descKey)}
                    </span>
                    <div className="flex items-center gap-[4px]">
                      {shortcut.keys.map((key, i) => (
                        <kbd
                          key={i}
                          className="inline-flex items-center justify-center min-w-[24px] h-[24px] px-[6px] rounded bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] font-mono text-[11px] text-text-tertiary"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
          <p className="font-kosugi text-[11px] text-text-disabled">
            {t("shortcuts.footer")}
          </p>
        </>
      )}
    </div>
  );
}
