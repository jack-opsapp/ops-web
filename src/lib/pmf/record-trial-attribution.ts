/**
 * OPS Web — Trial attribution capture (Unified Attribution P2)
 *
 * Upgrades a company's `trial_attributions` row with real first-touch data
 * read from the `__ops_first_touch` cookie at company creation.
 *
 * The row itself is created by the `companies_seed_trial_attribution` DB
 * trigger the moment the company is inserted (on EVERY platform, not just
 * web), so this is always an UPDATE — never an insert. That split is
 * deliberate: it keeps the attribution denominator whole even for iOS-born
 * companies, which never have a web session and therefore never a cookie.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveAttributionChannel } from "./attribution";
import type { FirstTouch } from "./utm-capture";

/**
 * Write first-touch attribution onto a company's existing trial_attributions
 * row.
 *
 * Two contracts:
 *  - **First-touch wins.** The UPDATE is scoped to rows still at
 *    `attributed_channel = 'unknown'`, so a later touch can never overwrite
 *    the one that actually brought the customer in.
 *  - **Never throws.** Attribution is a side-effect of signup, not a
 *    precondition for it. A failure here is logged and swallowed so it can
 *    never fail the company-creation request.
 *
 * A cookie carrying no signal at all (no UTM, no click id, no landing URL) is
 * skipped — there is nothing to record, and writing would make the row
 * indistinguishable from one that was genuinely never touched.
 *
 * Note the skip test is "is there any signal", NOT "did the channel classify".
 * `deriveAttributionChannel` returns `unknown` for a real-but-unrecognized
 * source such as `utm_source=newsletter`; skipping those would throw away the
 * UTM values themselves. Those rows are written with their UTM data intact and
 * an `unknown` channel, which is the honest representation.
 */
export async function recordTrialAttribution(
  db: SupabaseClient,
  companyId: string,
  touch: FirstTouch | null
): Promise<void> {
  if (!touch) return;

  const hasSignal = Boolean(
    touch.utm_source ||
      touch.utm_medium ||
      touch.utm_campaign ||
      touch.utm_content ||
      touch.utm_term ||
      touch.gclid ||
      touch.fbclid ||
      touch.landing_url
  );
  if (!hasSignal) return;

  try {
    const attributed_channel = deriveAttributionChannel({
      utm_source: touch.utm_source,
      utm_medium: touch.utm_medium,
      utm_campaign: touch.utm_campaign,
      gclid: touch.gclid,
      fbclid: touch.fbclid,
      landing_url: touch.landing_url,
      referrer: touch.referrer,
    });

    const { error } = await db
      .from("trial_attributions")
      .update({
        utm_source: touch.utm_source ?? null,
        utm_medium: touch.utm_medium ?? null,
        utm_campaign: touch.utm_campaign ?? null,
        utm_content: touch.utm_content ?? null,
        utm_term: touch.utm_term ?? null,
        gclid: touch.gclid ?? null,
        fbclid: touch.fbclid ?? null,
        landing_url: touch.landing_url ?? null,
        attributed_channel,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("attributed_channel", "unknown");

    if (error) {
      console.error(
        "[attribution] trial_attributions update failed:",
        error.message
      );
    }
  } catch (err) {
    console.error("[attribution] unexpected failure:", err);
  }
}
