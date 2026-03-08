"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import {
  usePreferencesStore,
  ACCENT_COLOR_VALUES,
  FONT_SIZE_SCALES,
  type AccentColorId,
  type FontSizeId,
} from "@/stores/preferences-store";

const ACCENT_COLORS: { id: AccentColorId; labelKey: string }[] = [
  { id: "steel-blue", labelKey: "appearance.steelBlue" },
  { id: "slate", labelKey: "appearance.slate" },
  { id: "mist", labelKey: "appearance.mist" },
  { id: "pewter", labelKey: "appearance.pewter" },
  { id: "sage", labelKey: "appearance.sage" },
  { id: "olive", labelKey: "appearance.olive" },
  { id: "dusty-rose", labelKey: "appearance.dustyRose" },
  { id: "mauve", labelKey: "appearance.mauve" },
  { id: "blush", labelKey: "appearance.blush" },
  { id: "sandstone", labelKey: "appearance.sandstone" },
  { id: "quicksand", labelKey: "appearance.quicksand" },
  { id: "warm-taupe", labelKey: "appearance.warmTaupe" },
  { id: "terracotta", labelKey: "appearance.terracotta" },
  { id: "driftwood", labelKey: "appearance.driftwood" },
  { id: "amber-gold", labelKey: "appearance.amberGold" },
  { id: "charcoal", labelKey: "appearance.charcoal" },
];

const FONT_SIZES: { id: FontSizeId; labelKey: string; scale: string }[] = [
  { id: "small", labelKey: "appearance.small", scale: "90%" },
  { id: "default", labelKey: "appearance.default", scale: "100%" },
  { id: "large", labelKey: "appearance.large", scale: "110%" },
];

export function AppearanceTab() {
  const { t } = useDictionary("settings");
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
          <CardTitle>{t("appearance.theme")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-1">
            {([
              { id: "dark" as const, label: t("appearance.dark"), icon: Moon },
              { id: "light" as const, label: t("appearance.light"), icon: Sun },
              { id: "system" as const, label: t("appearance.system"), icon: Monitor },
            ]).map((themeOpt) => (
              <button
                key={themeOpt.id}
                onClick={() => {
                  if (themeOpt.id !== "dark") {
                    toast.info(t("appearance.lightComingSoon"));
                    return;
                  }
                }}
                className={cn(
                  "flex flex-col items-center gap-[6px] py-1.5 rounded border transition-all",
                  themeOpt.id === "dark"
                    ? "bg-ops-accent-muted border-ops-accent"
                    : "bg-background-input border-border hover:border-border-medium opacity-50"
                )}
              >
                <themeOpt.icon className={cn("w-[20px] h-[20px]", themeOpt.id === "dark" ? "text-ops-accent" : "text-text-tertiary")} />
                <span className={cn("font-mohave text-body-sm", themeOpt.id === "dark" ? "text-ops-accent" : "text-text-secondary")}>
                  {themeOpt.label}
                </span>
              </button>
            ))}
          </div>
          <p className="font-kosugi text-[11px] text-text-disabled mt-1">
            {t("appearance.lightComingSoonDesc")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("appearance.accentColor")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-1.5">
            {ACCENT_COLORS.map((color) => {
              const colorLabel = t(color.labelKey);
              const isActive = accentColor === color.id;
              return (
              <button
                key={color.id}
                onClick={() => {
                  setAccentColor(color.id);
                  toast.success(`${t("appearance.toast.accent")} ${colorLabel}`);
                }}
                className={cn(
                  "relative flex items-center gap-[6px] px-1.5 py-[8px] rounded border transition-all",
                  isActive
                    ? "border-[rgba(255,255,255,0.4)] bg-[rgba(255,255,255,0.06)]"
                    : "border-border hover:border-border-medium"
                )}
              >
                <span
                  className={cn(
                    "w-[16px] h-[16px] rounded-full shrink-0",
                    isActive ? "ring-2 ring-white/40 ring-offset-1 ring-offset-background-card" : "border border-[rgba(255,255,255,0.2)]"
                  )}
                  style={{ backgroundColor: ACCENT_COLOR_VALUES[color.id] }}
                />
                <span className="font-mohave text-body-sm text-text-secondary truncate">{colorLabel}</span>
                {isActive && (
                  <Check className="w-[12px] h-[12px] text-ops-accent absolute right-[6px] shrink-0" />
                )}
              </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("appearance.fontSize")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1">
            {FONT_SIZES.map((size) => {
              const sizeLabel = t(size.labelKey);
              return (
              <button
                key={size.id}
                onClick={() => {
                  setFontSize(size.id);
                  toast.success(`${t("appearance.toast.fontSize")} ${sizeLabel}`);
                }}
                className={cn(
                  "flex-1 py-[8px] rounded border font-mohave text-body-sm transition-all",
                  fontSize === size.id
                    ? "bg-ops-accent-muted border-ops-accent text-ops-accent"
                    : "bg-background-input border-border text-text-tertiary hover:text-text-secondary"
                )}
              >
                {sizeLabel} ({size.scale})
              </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mohave text-body text-text-primary">{t("appearance.compact")}</p>
              <p className="font-kosugi text-[11px] text-text-tertiary">
                {t("appearance.compactDesc")}
              </p>
            </div>
            <button
              onClick={() => {
                setCompactMode(!compactMode);
                toast.success(!compactMode ? t("appearance.toast.compactEnabled") : t("appearance.toast.compactDisabled"));
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
