/**
 * OPS Web - Phase C Category Autonomy Service
 *
 * Read/write helpers for per-primary-category Phase C autonomy levels.
 *
 * Storage: `email_connections.auto_send_settings.category_autonomy` (JSONB).
 * Keys use the `primary:<CATEGORY>` namespace so they coexist with the
 * existing 9 relationship-type keys (client_new_inquiry, vendor_ordering, …)
 * used by ai-draft-service for writing-profile graduation.
 *
 * Example stored value:
 *   {
 *     "primary:LEAD":    "auto_draft",
 *     "primary:CLIENT":  "auto_send",
 *     "primary:VENDOR":  "auto_archive",
 *     "primary:LEGAL":   "off",
 *     "client_new_inquiry": "auto_send",   // legacy key retained
 *     "vendor_ordering":   "auto_draft",   // legacy key retained
 *     …
 *   }
 *
 * Valid autonomy levels differ per category — enforced by allowedLevelsFor().
 *
 * Graduation (isGraduated) = approval rate >= 0.95 over >= 20 finalized drafts
 * for the category's primary profile_type(s). A draft counts as "approved"
 * when the user sent it with edit_distance / original_word_count <= 0.15.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
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

// ─── Allowed autonomy levels per category ────────────────────────────────────

/**
 * Restricts the set of autonomy levels exposed in the UI for each category.
 * Enforced server-side too — set() rejects values outside this list.
 */
export function allowedLevelsFor(
  category: EmailThreadCategory
): EmailThreadAutonomyLevel[] {
  switch (category) {
    case "CUSTOMER":
      return ["off", "draft_on_request", "auto_draft", "auto_send", "auto_follow_up"];
    case "VENDOR":
    case "SUBTRADE":
      return ["off", "draft_on_request", "auto_draft", "auto_send"];
    case "PLATFORM_BID":
      return ["off", "draft_on_request", "auto_draft", "auto_send", "auto_archive"];
    case "LEGAL":
    case "COLLECTIONS":
    case "JOB_SEEKER":
      return ["off", "draft_on_request"];
    case "MARKETING":
    case "RECEIPT":
    case "PERSONAL":
    case "INTERNAL":
    case "OTHER":
      return ["off", "auto_archive"];
  }
}

// ─── Default level (when nothing is stored) ──────────────────────────────────

function defaultLevelFor(category: EmailThreadCategory): EmailThreadAutonomyLevel {
  switch (category) {
    case "LEGAL":
    case "COLLECTIONS":
    case "JOB_SEEKER":
      return "draft_on_request";
    case "MARKETING":
    case "RECEIPT":
      return "off"; // users opt in to auto_archive themselves
    default:
      return "off";
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

type CategoryAutonomyMap = Record<EmailThreadCategory, EmailThreadAutonomyLevel>;

export interface GraduationStatus {
  ready: boolean;
  approvalRate: number;
  sampleSize: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const PhaseCCategoryAutonomy = {
  /**
   * Read the per-category autonomy map for a connection. Missing keys fall
   * back to defaults. Always returns all 13 categories.
   */
  async get(connectionId: string): Promise<CategoryAutonomyMap> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_connections")
      .select("auto_send_settings")
      .eq("id", connectionId)
      .maybeSingle();

    if (error) throw error;

    const settings = (data?.auto_send_settings as Record<string, unknown>) ?? {};
    const stored = (settings.category_autonomy as Record<string, string>) ?? {};

    const out = {} as CategoryAutonomyMap;
    for (const cat of EMAIL_THREAD_CATEGORIES) {
      const key = `primary:${cat}`;
      const value = stored[key] as EmailThreadAutonomyLevel | undefined;
      out[cat] = value && allowedLevelsFor(cat).includes(value)
        ? value
        : defaultLevelFor(cat);
    }
    return out;
  },

  /**
   * Set the autonomy level for a single category. Rejects invalid levels.
   * Merges into existing category_autonomy JSONB — does not clobber other keys
   * (including the legacy per-relationship keys).
   */
  async set(
    connectionId: string,
    category: EmailThreadCategory,
    level: EmailThreadAutonomyLevel
  ): Promise<void> {
    if (!allowedLevelsFor(category).includes(level)) {
      throw new Error(
        `Autonomy level '${level}' is not allowed for category '${category}'.`
      );
    }
    const supabase = requireSupabase();

    const { data: current, error: readErr } = await supabase
      .from("email_connections")
      .select("auto_send_settings")
      .eq("id", connectionId)
      .maybeSingle();
    if (readErr) throw readErr;

    const currentSettings =
      (current?.auto_send_settings as Record<string, unknown>) ?? {};
    const currentMap =
      (currentSettings.category_autonomy as Record<string, string>) ?? {};

    const nextMap: Record<string, string> = {
      ...currentMap,
      [`primary:${category}`]: level,
    };

    const merged = {
      ...currentSettings,
      category_autonomy: nextMap,
    };

    const { error } = await supabase
      .from("email_connections")
      .update({ auto_send_settings: merged })
      .eq("id", connectionId);
    if (error) throw error;
  },

  /**
   * Return whether Phase C has graduated to auto_send for this category, based
   * on the user's recent draft edit behavior. Thresholds: ≥ 20 finalized
   * drafts in the mapped profile_type(s) AND approval rate ≥ 0.95.
   *
   * Approval definition:
   *   - status === 'sent' AND (sent_without_changes === true
   *       OR edit_distance <= 0.15 * origin_word_count)
   *   - status === 'discarded' counts as a rejection
   */
  async isGraduated(
    companyId: string,
    userId: string,
    category: EmailThreadCategory
  ): Promise<GraduationStatus> {
    const profileTypes = CATEGORY_TO_PROFILE_TYPES[category];
    if (!profileTypes || profileTypes.length === 0) {
      return { ready: false, approvalRate: 0, sampleSize: 0 };
    }

    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("ai_draft_history")
      .select("status, sent_without_changes, edit_distance, original_draft")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .in("profile_type", profileTypes)
      .in("status", ["sent", "discarded"])
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      status: string;
      sent_without_changes: boolean | null;
      edit_distance: number | null;
      original_draft: string | null;
    }>;

    if (rows.length === 0) {
      return { ready: false, approvalRate: 0, sampleSize: 0 };
    }

    let approved = 0;
    for (const row of rows) {
      if (row.status !== "sent") continue;
      if (row.sent_without_changes) {
        approved += 1;
        continue;
      }
      const origWords = (row.original_draft ?? "").split(/\s+/).filter(Boolean).length;
      const distance = row.edit_distance ?? Infinity;
      if (origWords > 0 && distance / origWords <= 0.15) {
        approved += 1;
      }
    }

    const approvalRate = approved / rows.length;
    const ready = rows.length >= 20 && approvalRate >= 0.95;
    return { ready, approvalRate, sampleSize: rows.length };
  },

  /** Return the list of profile_types that fuel a category. Used by router. */
  profileTypesFor(category: EmailThreadCategory): string[] {
    return CATEGORY_TO_PROFILE_TYPES[category] ?? [];
  },
};
