"use client";

import { useEffect } from "react";
import {
  usePreferencesStore,
  ACCENT_COLOR_VALUES,
  FONT_SIZE_SCALES,
} from "@/stores/preferences-store";

/** Convert hex to "R G B" string for Tailwind's alpha modifier support. */
function hexToRgbString(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

/** Lighten a hex color by a fixed amount. */
function lightenHex(hex: string, amount = 20): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Applies user appearance preferences to CSS custom properties on `<html>`.
 * Mount once in the dashboard layout — renders no DOM.
 */
export function PreferencesApplier() {
  const accentColor = usePreferencesStore((s) => s.accentColor);
  const fontSize = usePreferencesStore((s) => s.fontSize);
  const compactMode = usePreferencesStore((s) => s.compactMode);

  // Apply accent color
  useEffect(() => {
    const hex = ACCENT_COLOR_VALUES[accentColor];
    const root = document.documentElement;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    root.style.setProperty("--ops-accent-rgb", hexToRgbString(hex));
    root.style.setProperty("--ops-accent-hover", lightenHex(hex));
    root.style.setProperty("--ops-accent-muted", `rgba(${r}, ${g}, ${b}, 0.15)`);
  }, [accentColor]);

  // Apply font scale
  useEffect(() => {
    const scale = FONT_SIZE_SCALES[fontSize];
    document.documentElement.style.fontSize = `${scale * 16}px`;
  }, [fontSize]);

  // Apply compact mode
  useEffect(() => {
    document.body.classList.toggle("compact-mode", compactMode);
  }, [compactMode]);

  return null;
}
