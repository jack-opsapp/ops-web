import "server-only";
import * as historySync from "@/lib/admin/ads-history-sync";

/**
 * Refresh the entity snapshot after a change lands, through phase 1's
 * `syncEntitySnapshot` (feat/ads-engine-p1). Until that branch is merged the
 * function does not exist; the next daily sync refreshes the snapshot instead,
 * so a missing export is logged, never thrown.
 */
export async function refreshEntitySnapshot(): Promise<boolean> {
  const candidate = historySync as unknown as { syncEntitySnapshot?: () => Promise<unknown> };
  if (typeof candidate.syncEntitySnapshot !== "function") {
    console.warn("[ads-engine] syncEntitySnapshot is not available yet; the daily sync will refresh the snapshot");
    return false;
  }
  await candidate.syncEntitySnapshot();
  return true;
}
