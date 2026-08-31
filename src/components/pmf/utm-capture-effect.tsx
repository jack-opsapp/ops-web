/**
 * <UtmCaptureEffect />
 *
 * Mounted once in the root layout. On client mount, captures UTM params /
 * gclid / fbclid from the current URL into the versioned __ops_first_touch
 * cookie shared across .opsapp.co. First-touch is preserved — subsequent
 * landings are no-ops.
 *
 * Defensive only: most users land on try.opsapp.co (separate repo); this
 * catches the rare case where a UTM-tagged URL hits app.opsapp.co directly.
 *
 * Returns null — purely an effect, no DOM.
 */
"use client";

import { useEffect } from "react";
import { captureOnLanding } from "@/lib/pmf/utm-capture";

export function UtmCaptureEffect() {
  useEffect(() => {
    captureOnLanding();
  }, []);
  return null;
}
