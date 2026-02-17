"use client";

import { useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const ACCENT_COLORS = [
  { id: "steel-blue", label: "Steel Blue", value: "#417394" },
  { id: "amber-gold", label: "Amber Gold", value: "#C4A868" },
  { id: "emerald", label: "Emerald", value: "#10B981" },
  { id: "violet", label: "Violet", value: "#8B5CF6" },
  { id: "rose", label: "Rose", value: "#F43F5E" },
  { id: "cyan", label: "Cyan", value: "#06B6D4" },
];

const FONT_SIZES = [
  { id: "small", label: "Small", scale: "90%" },
  { id: "default", label: "Default", scale: "100%" },
  { id: "large", label: "Large", scale: "110%" },
];

export function AppearanceTab() {
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [accentColor, setAccentColor] = useState("steel-blue");
  const [fontSize, setFontSize] = useState("default");
  const [compactMode, setCompactMode] = useState(false);

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
                  setTheme(t.id);
                  toast.success(`Theme set to ${t.label}`);
                }}
                className={cn(
                  "flex flex-col items-center gap-[6px] py-1.5 rounded border transition-all",
                  theme === t.id
                    ? "bg-ops-accent-muted border-ops-accent"
                    : "bg-background-input border-border hover:border-border-medium"
                )}
              >
                <t.icon className={cn("w-[20px] h-[20px]", theme === t.id ? "text-ops-accent" : "text-text-tertiary")} />
                <span className={cn("font-mohave text-body-sm", theme === t.id ? "text-ops-accent" : "text-text-secondary")}>
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
                  style={{ backgroundColor: color.value }}
                />
                <span className="font-mohave text-body-sm text-text-secondary">{color.label}</span>
                {accentColor === color.id && (
                  <Check className="w-[12px] h-[12px] text-ops-accent" />
                )}
              </button>
            ))}
          </div>
          <p className="font-kosugi text-[11px] text-text-disabled mt-1">
            Custom accent colors will be available in a future update.
          </p>
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
                onClick={() => setFontSize(size.id)}
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
