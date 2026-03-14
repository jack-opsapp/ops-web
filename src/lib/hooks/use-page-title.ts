/**
 * OPS Web - usePageTitle Hook
 *
 * Sets the browser tab title for client-side pages.
 * Uses the root layout's template ("%s | OPS") pattern by setting document.title directly.
 */

import { useEffect } from "react";

/**
 * Sets the document title for a page.
 * @param title - The page title (e.g. "Dashboard"). Will render as "Dashboard | OPS" in the browser tab.
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} | OPS` : "OPS";
  }, [title]);
}
