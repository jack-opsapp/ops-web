"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  ChevronDown,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";

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
        <span className="font-mohave text-body-sm text-text-2 font-medium uppercase tracking-wide">
          {t("category.title")}
        </span>
        <p className="font-kosugi text-micro text-text-mute mt-0.5">
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
                  <span className="font-kosugi text-micro text-text-mute uppercase tracking-wider">
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
                          className="font-kosugi text-micro text-[#C4A868] uppercase tracking-wider hover:text-text transition-colors"
                        >
                          {t("confirm")}
                        </button>
                        <button
                          onClick={() => setShowAutoSendWarning(null)}
                          className="font-kosugi text-micro text-text-mute uppercase tracking-wider hover:text-text-3 transition-colors"
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
    </div>
  );
}
