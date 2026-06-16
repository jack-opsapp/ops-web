"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useDictionary } from "@/i18n/client";

// ─── Section header (// TITLE) ───────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </span>
  );
}

const shortcutGroups = [
  {
    categoryKey: "shortcuts.navigation",
    shortcuts: [
      { keys: ["1"], descKey: "shortcuts.dashboard" },
      { keys: ["2"], descKey: "shortcuts.projects" },
      { keys: ["3"], descKey: "shortcuts.schedule" },
      { keys: ["4"], descKey: "shortcuts.clients" },
      { keys: ["5"], descKey: "shortcuts.team" },
      { keys: ["6"], descKey: "shortcuts.map" },
      { keys: ["7"], descKey: "shortcuts.pipeline" },
      { keys: ["8"], descKey: "shortcuts.invoices" },
      { keys: ["⌘", "K"], descKey: "shortcuts.commandPalette" },
    ],
  },
  {
    categoryKey: "shortcuts.actions",
    shortcuts: [
      { keys: ["⌘", "⇧", "P"], descKey: "shortcuts.newProject" },
      { keys: ["⌘", "⇧", "C"], descKey: "shortcuts.newClient" },
    ],
  },
  {
    categoryKey: "shortcuts.interface",
    shortcuts: [
      { keys: ["⌘", "B"], descKey: "shortcuts.toggleSidebar" },
    ],
  },
];

export function ShortcutsTab() {
  const { t } = useDictionary("settings");
  const showShortcutHints = usePreferencesStore((s) => s.showShortcutHints);
  const toggleShortcutHints = usePreferencesStore((s) => s.toggleShortcutHints);

  return (
    <div className="space-y-3">
      {/* Toggle row — not in a card, just an inline control */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mohave text-body text-text">{t("shortcuts.showShortcuts")}</p>
          <p className="font-mono text-micro text-text-3">
            {t("shortcuts.showShortcutsDesc")}
          </p>
        </div>
        <Switch
          checked={showShortcutHints}
          onCheckedChange={() => toggleShortcutHints()}
        />
      </div>

      {showShortcutHints && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {shortcutGroups.map((group) => (
              <Card key={group.categoryKey}>
                <div className="pb-2">
                  <SectionTitle>{t(group.categoryKey)}</SectionTitle>
                </div>
                <CardContent className="space-y-0">
                  {group.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.descKey}
                      className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0"
                    >
                      <span className="font-mohave text-body text-text-2">
                        {t(shortcut.descKey)}
                      </span>
                      <div className="flex items-center gap-[4px]">
                        {shortcut.keys.map((key, i) => (
                          <kbd
                            key={i}
                            className="inline-flex items-center justify-center min-w-[24px] h-[24px] px-[6px] rounded-[4px] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] font-mono text-micro text-text-3"
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
          </div>
          <p className="font-mono text-micro text-text-mute">
            {t("shortcuts.footer")}
          </p>
        </>
      )}
    </div>
  );
}
