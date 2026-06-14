import { Suspense } from "react";
import { SettingsShell } from "@/components/settings/settings-shell";

/**
 * /settings — the renovated settings hub (WEB OVERHAUL P3-6).
 *
 * Horizontal domain tabs + sub-section SegmentControl + `?section=` deep-linking;
 * absorbs the retired standalone /team page (TEAM › Members). Suspense boundary is
 * required for useSearchParams during prerender.
 */
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsShell />
    </Suspense>
  );
}
