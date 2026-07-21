/**
 * OPS Web - Phase C Category Autonomy Service
 *
 * Read/write helpers for per-primary-category Phase C autonomy levels.
 *
 * Shared policy lives in `email_connections.auto_send_settings.category_autonomy`
 * under `primary:<CATEGORY>` keys. Send-capable policy is effective only when
 * the exact OPS actor also has a live acceptance ledger row.
 *
 * Example stored value:
 *   {
 *     "primary:CUSTOMER": "auto_send",
 *     "primary:VENDOR":   "auto_archive",
 *     "primary:LEGAL":    "off"
 *   }
 *
 * Valid autonomy levels differ per category — enforced by allowedLevelsFor().
 *
 * Graduation (isGraduated) = strict unchanged-send rate >= 0.95 over >= 20
 * human-finalized drafts carrying the exact immutable primary-category proof.
 */

import "server-only";

import {
  allowedLevelsFor,
  defaultLevelFor,
} from "@/lib/email/phase-c-category-autonomy-policy";
import { requireSupabase } from "@/lib/supabase/helpers";
import { getHumanDraftAccuracy } from "./phase-c-draft-accuracy-service";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadAutonomyLevel,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";

// ─── Category → profile_type mapping (for graduation heuristic) ──────────────

/**
 * Primary categories map to one or more ai_draft_history profile_types.
 * Only categories that can actually drive drafts appear here.
 */
const CATEGORY_TO_PROFILE_TYPES: Partial<
  Record<EmailThreadCategory, string[]>
> = {
  // CUSTOMER is the single profile spanning lead → won → repeat — the
  // legacy LEAD/CLIENT split was collapsed in migration 20260428061836.
  CUSTOMER: [
    "client_new_inquiry",
    "client_quoting",
    "client_active_project",
    "client_followup",
  ],
  VENDOR: ["vendor_ordering", "vendor_inquiry"],
  SUBTRADE: ["subtrade_coordination"],
  PLATFORM_BID: ["client_new_inquiry"], // platform bids draft like inquiries
  INTERNAL: ["internal"],
  // Categories that should never draft stay unmapped.
};

export { allowedLevelsFor } from "@/lib/email/phase-c-category-autonomy-policy";

// ─── Types ───────────────────────────────────────────────────────────────────

type CategoryAutonomyMap = Record<
  EmailThreadCategory,
  EmailThreadAutonomyLevel
>;

export interface GraduationStatus {
  ready: boolean;
  approvalRate: number;
  sampleSize: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const PhaseCCategoryAutonomy = {
  /**
   * Read the per-category autonomy map for a connection. When actorUserId is
   * supplied, shared send-capable policy is capped at auto-draft until that
   * exact actor has accepted the exact mailbox/category/level. Missing keys
   * fall back to defaults. Always returns all 12 categories.
   */
  async get(
    connectionId: string,
    actorUserId?: string
  ): Promise<CategoryAutonomyMap> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_connections")
      .select("auto_send_settings")
      .eq("id", connectionId)
      .maybeSingle();

    if (error) throw error;

    const settings =
      (data?.auto_send_settings as Record<string, unknown>) ?? {};
    const stored = (settings.category_autonomy as Record<string, string>) ?? {};
    const accepted = new Map<EmailThreadCategory, EmailThreadAutonomyLevel>();

    if (actorUserId) {
      const { data: acceptanceRows, error: acceptanceError } =
        await supabase.rpc("get_phase_c_actor_category_acceptances_as_system", {
          p_connection_id: connectionId,
          p_actor_user_id: actorUserId,
        });
      if (acceptanceError) throw acceptanceError;

      for (const raw of Array.isArray(acceptanceRows) ? acceptanceRows : []) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as Record<string, unknown>;
        const category = row.primary_category;
        const level = row.accepted_level;
        if (
          typeof category === "string" &&
          EMAIL_THREAD_CATEGORIES.includes(category as EmailThreadCategory) &&
          (level === "auto_send" || level === "auto_follow_up")
        ) {
          accepted.set(
            category as EmailThreadCategory,
            level as EmailThreadAutonomyLevel
          );
        }
      }
    }

    const out = {} as CategoryAutonomyMap;
    for (const cat of EMAIL_THREAD_CATEGORIES) {
      const key = `primary:${cat}`;
      const value = stored[key] as EmailThreadAutonomyLevel | undefined;
      const declared =
        value && allowedLevelsFor(cat).includes(value)
          ? value
          : defaultLevelFor(cat);
      out[cat] =
        actorUserId &&
        (declared === "auto_send" || declared === "auto_follow_up") &&
        accepted.get(cat) !== declared
          ? "auto_draft"
          : declared;
    }
    return out;
  },

  /**
   * Return whether Phase C has graduated to auto_send for this category, based
   * on the user's recent draft edit behavior. Thresholds: ≥ 20 finalized
   * drafts for this exact category AND approval rate ≥ 0.95.
   *
   * Approval definition: the exact OPS actor sent the generated draft without
   * changing it. Edited and autonomous sends cannot inflate graduation.
   */
  async isGraduated(
    companyId: string,
    connectionId: string,
    userId: string,
    category: EmailThreadCategory
  ): Promise<GraduationStatus> {
    const profileTypes = CATEGORY_TO_PROFILE_TYPES[category];
    if (!profileTypes || profileTypes.length === 0) {
      return { ready: false, approvalRate: 0, sampleSize: 0 };
    }

    const accuracy = await getHumanDraftAccuracy({
      companyId,
      connectionId,
      userId,
      primaryCategory: category,
    });
    return {
      ready: accuracy.sampleSize >= 20 && accuracy.approvalRate >= 0.95,
      approvalRate: accuracy.approvalRate,
      sampleSize: accuracy.sampleSize,
    };
  },

  /** Return the list of profile_types that fuel a category. Used by router. */
  profileTypesFor(category: EmailThreadCategory): string[] {
    return CATEGORY_TO_PROFILE_TYPES[category] ?? [];
  },
};
