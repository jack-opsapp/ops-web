"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  usePreferencesStore,
  ACCENT_COLOR_VALUES,
  FONT_SIZE_SCALES,
  type AccentColorId,
  type FontSizeId,
} from "@/stores/preferences-store";

const ACCENT_COLORS: { id: AccentColorId; label: string }[] = [
  { id: "steel-blue", label: "Steel Blue" },
  { id: "amber-gold", label: "Amber Gold" },
  { id: "emerald", label: "Emerald" },
  { id: "violet", label: "Violet" },
  { id: "rose", label: "Rose" },
  { id: "cyan", label: "Cyan" },
];

const FONT_SIZES: { id: FontSizeId; label: string; scale: string }[] = [
  { id: "small", label: "Small", scale: "90%" },
  { id: "default", label: "Default", scale: "100%" },
  { id: "large", label: "Large", scale: "110%" },
];

export function AppearanceTab() {
  const accentColor = usePreferencesStore((s) => s.accentColor);
  const fontSize = usePreferencesStore((s) => s.fontSize);
  const compactMode = usePreferencesStore((s) => s.compactMode);
  const setAccentColor = usePreferencesStore((s) => s.setAccentColor);
  const setFontSize = usePreferencesStore((s) => s.setFontSize);
  const setCompactMode = usePreferencesStore((s) => s.setCompactMode);

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-1">
            {([
              { id: "dark" as const, label: "Dark", icon: Moon },
              { id: "light" as const, label: "Light", icon: Sun },
              { id: "system" as const, label: "System", icon: Monitor },
            ]).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  if (t.id !== "dark") {
                    toast.info("Light theme coming soon");
                    return;
                  }
                }}
                className={cn(
                  "flex flex-col items-center gap-[6px] py-1.5 rounded border transition-all",
                  t.id === "dark"
                    ? "bg-ops-accent-muted border-ops-accent"
                    : "bg-background-input border-border hover:border-border-medium opacity-50"
                )}
              >
                <t.icon className={cn("w-[20px] h-[20px]", t.id === "dark" ? "text-ops-accent" : "text-text-tertiary")} />
                <span className={cn("font-mohave text-body-sm", t.id === "dark" ? "text-ops-accent" : "text-text-secondary")}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>
          <p className="font-kosugi text-[11px] text-text-disabled mt-1">
            Light theme coming soon. Dark mode is currently the only active theme.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accent Color</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {ACCENT_COLORS.map((color) => (
              <button
                key={color.id}
                onClick={() => {
                  setAccentColor(color.id);
                  toast.success(`Accent color set to ${color.label}`);
                }}
                className={cn(
                  "flex items-center gap-[6px] px-1.5 py-[8px] rounded border transition-all",
                  accentColor === color.id
                    ? "border-[rgba(255,255,255,0.4)] bg-[rgba(255,255,255,0.06)]"
                    : "border-border hover:border-border-medium"
                )}
              >
                <span
                  className="w-[16px] h-[16px] rounded-full border border-[rgba(255,255,255,0.2)]"
                  style={{ backgroundColor: ACCENT_COLOR_VALUES[color.id] }}
                />
                <span className="font-mohave text-body-sm text-text-secondary">{color.label}</span>
                {accentColor === color.id && (
                  <Check className="w-[12px] h-[12px] text-ops-accent" />
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Font Size</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1">
            {FONT_SIZES.map((size) => (
              <button
                key={size.id}
                onClick={() => {
                  setFontSize(size.id);
                  toast.success(`Font size set to ${size.label}`);
                }}
                className={cn(
                  "flex-1 py-[8px] rounded border font-mohave text-body-sm transition-all",
                  fontSize === size.id
                    ? "bg-ops-accent-muted border-ops-accent text-ops-accent"
                    : "bg-background-input border-border text-text-tertiary hover:text-text-secondary"
                )}
              >
                {size.label} ({size.scale})
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mohave text-body text-text-primary">Compact Mode</p>
              <p className="font-kosugi text-[11px] text-text-tertiary">
                Reduce spacing and padding throughout the interface
              </p>
            </div>
            <button
              onClick={() => {
                setCompactMode(!compactMode);
                toast.success(`Compact mode ${!compactMode ? "enabled" : "disabled"}`);
              }}
              className={cn(
                "w-[40px] h-[22px] rounded-full transition-colors relative",
                compactMode ? "bg-ops-accent" : "bg-background-elevated"
              )}
            >
              <span
                className={cn(
                  "absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all",
                  compactMode ? "right-[2px]" : "left-[2px]"
                )}
              />
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
