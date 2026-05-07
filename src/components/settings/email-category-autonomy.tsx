"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  ChevronDown,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadAutonomyLevel,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";
import {
  categoryLabel,
  categoryDotClassName,
} from "@/components/ops/inbox/category-chip";
import { allowedLevelsFor } from "@/lib/api/services/phase-c-category-autonomy-service";

// ─── Types ──────────────────────────────────────────────────────────────────

type AutonomyLevel = "off" | "draft_on_request" | "auto_draft" | "auto_send";

interface CategoryConfig {
  profileType: string;
  level: AutonomyLevel;
  emailCount: number;
}

interface EmailCategoryAutonomyProps {
  connectionId: string;
  autoSendFeatureEnabled: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  "client_new_inquiry",
  "client_quoting",
  "client_active_project",
  "client_followup",
  "vendor_ordering",
  "vendor_inquiry",
  "subtrade_coordination",
  "warranty_claim",
  "internal",
] as const;

const MIN_EMAILS_FOR_AUTO = 10;

const LEVELS: AutonomyLevel[] = [
  "off",
  "draft_on_request",
  "auto_draft",
  "auto_send",
];

// ─── Component ──────────────────────────────────────────────────────────────

export function EmailCategoryAutonomy({
  connectionId,
  autoSendFeatureEnabled,
}: EmailCategoryAutonomyProps) {
  const { t } = useDictionary("autonomy");
  const { currentUser, company } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const prefersReducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
  const [categories, setCategories] = useState<CategoryConfig[]>([]);
  const [showAutoSendWarning, setShowAutoSendWarning] = useState<string | null>(null);

  // ─── Fetch current settings + category stats ──────────────────────────
  useEffect(() => {
    if (!company?.id || !currentUser?.id || !connectionId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [settingsRes, categoryStatsRes] = await Promise.all([
          fetch(
            `/api/integrations/email/auto-send/settings?companyId=${company.id}&connectionId=${connectionId}`
          ),
          fetch(
            `/api/integrations/email/draft-stats-by-category?companyId=${company.id}`
          ),
        ]);

        let categoryAutonomy: Record<string, string> = {};
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          categoryAutonomy =
            (data.settings as Record<string, unknown>)?.category_autonomy as Record<string, string> ?? {};
        }

        // Real per-profile-type counts from ai_draft_history
        let categoryCounts: Record<string, number> = {};
        if (categoryStatsRes.ok) {
          const data = await categoryStatsRes.json();
          categoryCounts = (data.categoryCounts as Record<string, number>) || {};
        }

        setCategories(
          CATEGORIES.map((profileType) => ({
            profileType,
            level: (categoryAutonomy[profileType] as AutonomyLevel) || "draft_on_request",
            emailCount: categoryCounts[profileType] || 0,
          }))
        );
      } catch {
        // Non-fatal
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [company?.id, currentUser?.id, connectionId]);

  // ─── Save category level ──────────────────────────────────────────────
  const handleLevelChange = useCallback(
    async (profileType: string, newLevel: AutonomyLevel) => {
      if (!company?.id) return;

      // Show warning for auto_send
      if (newLevel === "auto_send") {
        setShowAutoSendWarning(profileType);
        return;
      }

      await applyLevelChange(profileType, newLevel);
    },
    [company?.id, connectionId]
  );

  const applyLevelChange = useCallback(
    async (profileType: string, newLevel: AutonomyLevel) => {
      if (!company?.id) return;
      setSaving(profileType);
      setShowAutoSendWarning(null);

      try {
        // Build new category_autonomy from current state
        const newCategoryAutonomy: Record<string, string> = {};
        for (const cat of categories) {
          newCategoryAutonomy[cat.profileType] =
            cat.profileType === profileType ? newLevel : cat.level;
        }

        const response = await fetch(
          "/api/integrations/email/auto-send/settings",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId: company.id,
              connectionId,
              settings: { category_autonomy: newCategoryAutonomy },
            }),
          }
        );

        if (!response.ok) throw new Error("Save failed");

        setCategories((prev) =>
          prev.map((cat) =>
            cat.profileType === profileType
              ? { ...cat, level: newLevel }
              : cat
          )
        );
        toast.success(t("category.saved"));
      } catch {
        toast.error(t("error.categorySaveFailed"));
      } finally {
        setSaving(null);
      }
    },
    [company?.id, connectionId, categories, t]
  );

  // ─── Loading ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <Loader2 className={cn("w-[14px] h-[14px] text-text-mute", !prefersReducedMotion && "animate-spin")} />
        <span className="font-mohave text-body-sm text-text-mute">
          {t("loading")}
        </span>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="mb-2">
        <span className="font-cakemono text-body-sm text-text-2 font-light uppercase tracking-wide">
          {t("category.title")}
        </span>
        <p className="font-mono text-micro text-text-mute mt-0.5">
          [{t("category.description")}]
        </p>
      </div>

      {/* Category rows */}
      <div className="rounded-[8px] border border-[rgba(255,255,255,0.06)] overflow-hidden">
        {categories.map((cat, index) => {
          const isLearning = cat.emailCount < MIN_EMAILS_FOR_AUTO;
          const isSaving = saving === cat.profileType;
          const showWarning = showAutoSendWarning === cat.profileType;

          // Available levels for this category
          const availableLevels = LEVELS.filter((level) => {
            if (level === "auto_send" && !autoSendFeatureEnabled) return false;
            if (
              (level === "auto_draft" || level === "auto_send") &&
              isLearning
            )
              return false;
            return true;
          });

          return (
            <div key={cat.profileType}>
              <div
                className={cn(
                  "flex items-center justify-between px-3 py-2 min-h-[56px]",
                  index > 0 && "border-t border-[rgba(255,255,255,0.04)]"
                )}
              >
                {/* Category info */}
                <div className="flex-1 min-w-0 mr-3">
                  <span className="font-mohave text-body-sm text-text block truncate">
                    {t(`category.${cat.profileType}`)}
                  </span>
                  <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
                    {isLearning
                      ? t("category.learning")
                      : t("category.emailCount").replace(
                          "{{count}}",
                          String(cat.emailCount)
                        )}
                  </span>
                </div>

                {/* Level selector */}
                <div className="relative shrink-0">
                  <select
                    value={cat.level}
                    onChange={(e) =>
                      handleLevelChange(
                        cat.profileType,
                        e.target.value as AutonomyLevel
                      )
                    }
                    disabled={isSaving}
                    className={cn(
                      "appearance-none pl-2 pr-6 py-1 rounded-[4px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] font-mohave text-caption-sm text-text-2 outline-none focus:border-[rgba(111, 148, 176,0.4)] transition-colors cursor-pointer min-w-[130px]",
                      isSaving && "opacity-50"
                    )}
                  >
                    {availableLevels.map((level) => (
                      <option key={level} value={level}>
                        {t(`category.level.${level}`)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-[10px] h-[10px] text-text-mute pointer-events-none" />
                  {isSaving && (
                    <Loader2 className={cn("absolute right-6 top-1/2 -translate-y-1/2 w-[10px] h-[10px] text-text-mute", !prefersReducedMotion && "animate-spin")} />
                  )}
                </div>
              </div>

              {/* Auto-send warning banner */}
              {showWarning && (
                <div className="px-3 pb-2">
                  <div className="flex items-start gap-2 px-2 py-1.5 rounded-[4px] bg-[rgba(196,168,104,0.06)] border border-[rgba(196,168,104,0.15)]">
                    <AlertTriangle className="w-[12px] h-[12px] text-[#C4A868] shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-mohave text-caption-sm text-[#C4A868]">
                        {t("category.warning.autoSend")}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <button
                          onClick={() =>
                            applyLevelChange(cat.profileType, "auto_send")
                          }
                          className="font-mono text-micro text-[#C4A868] uppercase tracking-wider hover:text-text transition-colors"
                        >
                          {t("confirm")}
                        </button>
                        <button
                          onClick={() => setShowAutoSendWarning(null)}
                          className="font-mono text-micro text-text-mute uppercase tracking-wider hover:text-text-3 transition-colors"
                        >
                          {t("cancel")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Min emails notice */}
              {isLearning &&
                (cat.level === "auto_draft" || cat.level === "auto_send") && (
                  <div className="px-3 pb-1.5">
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-panel bg-[rgba(255,255,255,0.02)]">
                      <Sparkles className="w-[10px] h-[10px] text-text-mute" />
                      <span className="font-mohave text-[11px] text-text-mute">
                        {t("category.minEmails").replace(
                          "{{count}}",
                          String(MIN_EMAILS_FOR_AUTO)
                        )}
                      </span>
                    </div>
                  </div>
                )}
            </div>
          );
        })}
      </div>

      {/* ─── Primary Category Autonomy (Inbox v2) ───────────────────────── */}
      <PrimaryCategoryAutonomy
        connectionId={connectionId}
        autoSendFeatureEnabled={autoSendFeatureEnabled}
        categoryCounts={categories.reduce<Record<string, number>>((acc, c) => {
          acc[c.profileType] = c.emailCount;
          return acc;
        }, {})}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Primary Category Autonomy section — Inbox v2 taxonomy (13 categories)
// ═══════════════════════════════════════════════════════════════════════════

interface PrimaryCategoryAutonomyProps {
  connectionId: string;
  autoSendFeatureEnabled: boolean;
  /**
   * Category email counts per profile_type — used to compute a rough
   * "ready to graduate" signal for primary categories (LEAD maps to
   * client_new_inquiry + client_quoting profile types, etc.).
   */
  categoryCounts: Record<string, number>;
}

const PRIMARY_PROFILE_MAP: Partial<Record<EmailThreadCategory, string[]>> = {
  LEAD: ["client_new_inquiry", "client_quoting"],
  CLIENT: ["client_active_project", "client_followup"],
  VENDOR: ["vendor_ordering", "vendor_inquiry"],
  SUBTRADE: ["subtrade_coordination"],
  PLATFORM_BID: ["client_new_inquiry"],
  INTERNAL: ["internal"],
};

const PRIMARY_MIN_SAMPLES = 20;

function PrimaryCategoryAutonomy({
  connectionId,
  autoSendFeatureEnabled,
  categoryCounts,
}: PrimaryCategoryAutonomyProps) {
  const { t } = useDictionary("autonomy");
  const { company } = useAuthStore();
  const [levels, setLevels] = useState<
    Record<EmailThreadCategory, EmailThreadAutonomyLevel>
  >(() => {
    const out = {} as Record<EmailThreadCategory, EmailThreadAutonomyLevel>;
    for (const c of EMAIL_THREAD_CATEGORIES) out[c] = "off";
    return out;
  });
  const [saving, setSaving] = useState<EmailThreadCategory | null>(null);
  const [loading, setLoading] = useState(true);

  // Load current settings
  useEffect(() => {
    if (!company?.id || !connectionId) return;
    let aborted = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/integrations/email/auto-send/settings?companyId=${company.id}&connectionId=${connectionId}`
        );
        if (!res.ok || aborted) return;
        const data = await res.json();
        const settings = (data.settings as Record<string, unknown>) ?? {};
        const map =
          (settings.category_autonomy as Record<string, string>) ?? {};
        const next = {} as Record<EmailThreadCategory, EmailThreadAutonomyLevel>;
        for (const c of EMAIL_THREAD_CATEGORIES) {
          const key = `primary:${c}`;
          const value = (map[key] as EmailThreadAutonomyLevel | undefined);
          const allowed = allowedLevelsFor(c);
          next[c] = value && allowed.includes(value)
            ? value
            : allowed[0]; // default: first allowed ("off" or "draft_on_request")
        }
        setLevels(next);
      } catch {
        // non-fatal
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [company?.id, connectionId]);

  const commit = useCallback(
    async (category: EmailThreadCategory, level: EmailThreadAutonomyLevel) => {
      if (!company?.id) return;
      setSaving(category);
      const prevLevels = levels;
      const nextLevels = { ...levels, [category]: level };
      setLevels(nextLevels);
      try {
        // Merge with existing category_autonomy: fetch → patch → write.
        const getRes = await fetch(
          `/api/integrations/email/auto-send/settings?companyId=${company.id}&connectionId=${connectionId}`
        );
        const getBody = await getRes.json();
        const currentMap =
          ((getBody.settings as Record<string, unknown>)
            ?.category_autonomy as Record<string, string>) ?? {};

        const mergedMap: Record<string, string> = {
          ...currentMap,
          [`primary:${category}`]: level,
        };

        const res = await fetch(
          "/api/integrations/email/auto-send/settings",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId: company.id,
              connectionId,
              settings: { category_autonomy: mergedMap },
            }),
          }
        );
        if (!res.ok) throw new Error("Save failed");
        toast.success(t("category.saved") ?? "Saved");
      } catch {
        setLevels(prevLevels);
        toast.error(t("error.categorySaveFailed") ?? "Could not save.");
      } finally {
        setSaving(null);
      }
    },
    [company?.id, connectionId, levels, t]
  );

  if (loading) return null;

  return (
    <div className="mt-6">
      <div className="mb-2">
        <span className="font-cakemono text-body-sm text-text-2 font-light uppercase tracking-wide">
          Primary category autonomy
        </span>
        <p className="font-mono text-micro text-text-mute mt-0.5">
          [Inbox v2 — thirteen primary categories]
        </p>
      </div>

      <div className="rounded-[8px] border border-[rgba(255,255,255,0.06)] overflow-hidden">
        {EMAIL_THREAD_CATEGORIES.map((cat, index) => {
          const allowed = allowedLevelsFor(cat);
          // Apply the global feature gate too: if auto_send isn't enabled at
          // the connection level, remove it from the dropdown.
          const filtered = allowed.filter((lvl) => {
            if (
              (lvl === "auto_send" || lvl === "auto_follow_up") &&
              !autoSendFeatureEnabled
            ) {
              return false;
            }
            return true;
          });

          const profileTypes = PRIMARY_PROFILE_MAP[cat] ?? [];
          const totalSamples = profileTypes.reduce(
            (sum, pt) => sum + (categoryCounts[pt] ?? 0),
            0
          );
          const readyToGraduate =
            profileTypes.length > 0 && totalSamples >= PRIMARY_MIN_SAMPLES;

          const isSaving = saving === cat;

          return (
            <div
              key={cat}
              className={cn(
                "flex items-center justify-between px-3 py-2 min-h-[48px]",
                index > 0 && "border-t border-[rgba(255,255,255,0.04)]"
              )}
            >
              <div className="flex-1 min-w-0 mr-3 flex items-center gap-2">
                <span
                  className={cn(
                    "w-[6px] h-[6px] rounded-full shrink-0",
                    categoryDotClassName(cat)
                  )}
                  aria-hidden
                />
                <span className="font-cakemono font-light uppercase text-[12px] tracking-[0.14em] text-text-2">
                  {categoryLabel(cat)}
                </span>
                {readyToGraduate && levels[cat] === "auto_draft" && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-[3px] bg-[rgba(157,181,130,0.08)] border border-[rgba(157,181,130,0.24)]">
                    <CheckCircle2 className="w-[10px] h-[10px] text-olive" strokeWidth={2} />
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-olive">
                      Ready to auto
                    </span>
                  </span>
                )}
              </div>

              <div className="relative shrink-0">
                <select
                  value={levels[cat]}
                  onChange={(e) =>
                    commit(cat, e.target.value as EmailThreadAutonomyLevel)
                  }
                  disabled={isSaving || filtered.length <= 1}
                  className={cn(
                    "appearance-none pl-2 pr-6 py-1 rounded-[4px]",
                    "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)]",
                    "font-mohave text-caption-sm text-text-2 outline-none",
                    "focus:border-[rgba(111,148,176,0.4)] transition-colors cursor-pointer min-w-[150px]",
                    isSaving && "opacity-50"
                  )}
                >
                  {filtered.map((level) => (
                    <option key={level} value={level}>
                      {formatLevelLabel(level)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-[10px] h-[10px] text-text-mute pointer-events-none" />
                {isSaving && (
                  <Loader2
                    className={cn(
                      "absolute right-6 top-1/2 -translate-y-1/2 w-[10px] h-[10px] text-text-mute",
                      "animate-spin"
                    )}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatLevelLabel(level: EmailThreadAutonomyLevel): string {
  switch (level) {
    case "off":
      return "Off";
    case "draft_on_request":
      return "Draft on request";
    case "auto_draft":
      return "Auto-draft";
    case "auto_send":
      return "Auto-send";
    case "auto_archive":
      return "Auto-archive";
    case "auto_follow_up":
      return "Auto follow-up";
  }
}
