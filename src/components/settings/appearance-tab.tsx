"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent } from "@/components/ui/card";
import { SegmentControl } from "@/components/ui/segment-control";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import {
  usePreferencesStore,
  type FontSizeId,
} from "@/stores/preferences-store";
import { ACCENT_COLORS } from "@/lib/data/curated-colors";

// ─── Section header (// TITLE) ───────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </span>
  );
}

const FONT_SIZES: { id: FontSizeId; labelKey: string; scale: string }[] = [
  { id: "small", labelKey: "appearance.small", scale: "90%" },
  { id: "default", labelKey: "appearance.default", scale: "100%" },
  { id: "large", labelKey: "appearance.large", scale: "110%" },
];

type ThemeId = "dark" | "light" | "system";

export function AppearanceTab() {
  const { t } = useDictionary("settings");
  const accentColor = usePreferencesStore((s) => s.accentColor);
  const fontSize = usePreferencesStore((s) => s.fontSize);
  const compactMode = usePreferencesStore((s) => s.compactMode);
  const setAccentColor = usePreferencesStore((s) => s.setAccentColor);
  const setFontSize = usePreferencesStore((s) => s.setFontSize);
  const setCompactMode = usePreferencesStore((s) => s.setCompactMode);

  const themeOptions: { value: ThemeId; label: string }[] = [
    { value: "dark", label: t("appearance.dark") },
    { value: "light", label: t("appearance.light") },
    { value: "system", label: t("appearance.system") },
  ];

  const fontSizeOptions = FONT_SIZES.map((size) => ({
    value: size.id,
    label: `${t(size.labelKey)} ${size.scale}`,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Card>
        <div className="pb-2">
          <SectionTitle>{t("appearance.theme")}</SectionTitle>
        </div>
        <CardContent>
          <SegmentControl<ThemeId>
            options={themeOptions}
            value="dark"
            onChange={(v) => {
              if (v !== "dark") {
                toast.info(t("appearance.lightComingSoon"));
              }
            }}
          />
          <p className="font-mono text-micro text-text-mute mt-1">
            {t("appearance.lightComingSoonDesc")}
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <div className="pb-2">
          <SectionTitle>{t("appearance.accentColor")}</SectionTitle>
        </div>
        <CardContent>
          <div className="grid grid-cols-4 lg:grid-cols-8 gap-1.5">
            {ACCENT_COLORS.map((color) => {
              const isActive = accentColor === color.id;
              return (
                <button
                  key={color.id}
                  onClick={() => {
                    setAccentColor(color.id);
                    toast.success(`${t("appearance.toast.accent")} ${color.name}`);
                  }}
                  className={cn(
                    "relative flex items-center gap-[6px] px-1.5 py-[8px] rounded-[5px] border transition-all",
                    isActive
                      ? "border-[rgba(255,255,255,0.18)] bg-surface-active"
                      : "border-border hover:border-border-medium"
                  )}
                >
                  {/* Accent swatch is intentionally color-driven — this IS the accent picker */}
                  <span
                    className={cn(
                      "w-[16px] h-[16px] rounded-full shrink-0",
                      isActive
                        ? "ring-2 ring-[rgba(255,255,255,0.4)] ring-offset-1 ring-offset-background-card"
                        : "border border-[rgba(255,255,255,0.2)]"
                    )}
                    style={{ backgroundColor: color.hex }}
                  />
                  <span className="font-mohave text-body-sm text-text-2 truncate">{color.name}</span>
                  {isActive && (
                    <Check className="w-[12px] h-[12px] text-text absolute right-[6px] shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <div className="pb-2">
          <SectionTitle>{t("appearance.fontSize")}</SectionTitle>
        </div>
        <CardContent>
          <SegmentControl<FontSizeId>
            options={fontSizeOptions}
            value={fontSize}
            onChange={(id) => {
              const label = t(FONT_SIZES.find((s) => s.id === id)!.labelKey);
              setFontSize(id);
              toast.success(`${t("appearance.toast.fontSize")} ${label}`);
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mohave text-body text-text">{t("appearance.compact")}</p>
              <p className="font-mono text-micro text-text-3">
                {t("appearance.compactDesc")}
              </p>
            </div>
            <Switch
              checked={compactMode}
              onCheckedChange={(v) => {
                setCompactMode(v);
                toast.success(v ? t("appearance.toast.compactEnabled") : t("appearance.toast.compactDisabled"));
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
