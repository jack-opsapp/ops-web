"use client";

import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePreferencesStore } from "@/stores/preferences-store";

const shortcutGroups = [
  {
    category: "Navigation",
    shortcuts: [
      { keys: ["1"], description: "Dashboard" },
      { keys: ["2"], description: "Projects" },
      { keys: ["3"], description: "Calendar" },
      { keys: ["4"], description: "Clients" },
      { keys: ["5"], description: "Job Board" },
      { keys: ["6"], description: "Team" },
      { keys: ["7"], description: "Map" },
      { keys: ["8"], description: "Pipeline" },
      { keys: ["9"], description: "Invoices" },
      { keys: ["\u2318", "K"], description: "Open command palette" },
    ],
  },
  {
    category: "Actions",
    shortcuts: [
      { keys: ["\u2318", "\u21E7", "P"], description: "New project" },
      { keys: ["\u2318", "\u21E7", "C"], description: "New client" },
    ],
  },
  {
    category: "Interface",
    shortcuts: [
      { keys: ["\u2318", "B"], description: "Toggle sidebar" },
    ],
  },
];

export function ShortcutsTab() {
  const showShortcutHints = usePreferencesStore((s) => s.showShortcutHints);
  const toggleShortcutHints = usePreferencesStore((s) => s.toggleShortcutHints);

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardContent className="p-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mohave text-body text-text-primary">Show Keyboard Shortcuts</p>
              <p className="font-kosugi text-[11px] text-text-tertiary">
                Display shortcut hints inline on action buttons
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

      {shortcutGroups.map((group) => (
        <Card key={group.category}>
          <CardHeader>
            <CardTitle>{group.category}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0">
            {group.shortcuts.map((shortcut) => (
              <div
                key={shortcut.description}
                className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0"
              >
                <span className="font-mohave text-body text-text-secondary">
                  {shortcut.description}
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
        On Windows/Linux, use Ctrl instead of \u2318
      </p>
    </div>
  );
}
