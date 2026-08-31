import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyAttribution } from "./attribution";
import type { FirstTouch } from "./utm-capture";

/**
 * Records the trigger-seeded trial attribution and its touchpoint through one
 * database transaction. Attribution is diagnostic context for company setup,
 * so an analytics failure is observable but never blocks account creation.
 */
export async function recordTrialAttribution(
  db: SupabaseClient,
  companyId: string,
  touch: FirstTouch | null
): Promise<void> {
  if (!touch) return;

  const classification = classifyAttribution({
    utm_source: touch.utm_source,
    utm_medium: touch.utm_medium,
    utm_campaign: touch.utm_campaign,
    gclid: touch.gclid,
    fbclid: touch.fbclid,
    landing_path: touch.landing_path,
    referrer_domain: touch.referrer_domain,
  });

  const payload = {
    ...touch,
    channel: classification.channel,
    basis: classification.basis,
    confidence: classification.confidence,
    reason: classification.reason,
  };

  try {
    const { error } = await db.rpc("record_first_touch_attribution", {
      p_company_id: companyId,
      p_touch: payload,
    });
    if (error) {
      console.error(
        "[attribution] first-touch transaction failed:",
        error.message
      );
    }
  } catch (error) {
    console.error("[attribution] unexpected first-touch failure:", error);
  }
}
