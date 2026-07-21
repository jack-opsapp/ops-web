"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
} from "lucide-react";
import {
  categoryDotClassName,
  categoryLabel,
} from "@/components/ops/inbox/category-chip";
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";
import { allowedLevelsFor } from "@/lib/email/phase-c-category-autonomy-policy";
import { useAuthStore } from "@/lib/store/auth-store";
import type {
  EmailThreadAutonomyLevel,
  EmailThreadCategory,
} from "@/lib/types/email-thread";
import { EMAIL_THREAD_CATEGORIES } from "@/lib/types/email-thread";
import { authedFetch } from "@/lib/utils/authed-fetch";
import { cn } from "@/lib/utils/cn";

interface CategoryReadiness {
  ready: boolean;
  sampleSize: number;
  approvalRate: number;
}

type CategoryReadinessMap = Partial<
  Record<EmailThreadCategory, CategoryReadiness>
>;

interface EmailCategoryAutonomyProps {
  connectionId: string;
  autoSendFeatureEnabled: boolean;
  focusPrimaryCategory?: EmailThreadCategory;
  visiblePrimaryCategories?: readonly EmailThreadCategory[];
}

interface PendingConfirmation {
  category: EmailThreadCategory;
  level: EmailThreadAutonomyLevel;
}

const EMPTY_READINESS: CategoryReadiness = {
  ready: false,
  sampleSize: 0,
  approvalRate: 0,
};

function initialLevels(): Record<
  EmailThreadCategory,
  EmailThreadAutonomyLevel
> {
  const levels = {} as Record<EmailThreadCategory, EmailThreadAutonomyLevel>;
  for (const category of EMAIL_THREAD_CATEGORIES) {
    levels[category] = allowedLevelsFor(category)[0];
  }
  return levels;
}

function autonomouslySends(level: EmailThreadAutonomyLevel): boolean {
  return level === "auto_send" || level === "auto_follow_up";
}

export function EmailCategoryAutonomy({
  connectionId,
  autoSendFeatureEnabled,
  focusPrimaryCategory,
  visiblePrimaryCategories,
}: EmailCategoryAutonomyProps) {
  const { t } = useDictionary("autonomy");
  const { company, currentUser } = useAuthStore();
  const [levels, setLevels] = useState(initialLevels);
  const [categoryReadiness, setCategoryReadiness] =
    useState<CategoryReadinessMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<EmailThreadCategory | null>(null);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const [saveError, setSaveError] = useState<EmailThreadCategory | null>(null);
  const focusedRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!company?.id || !currentUser?.id || !connectionId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [settingsResponse, readinessResponse] = await Promise.all([
          authedFetch(
            `/api/integrations/email/auto-send/settings?companyId=${company.id}&connectionId=${connectionId}`
          ),
          authedFetch(
            `/api/integrations/email/draft-stats-by-category?companyId=${company.id}&connectionId=${connectionId}`
          ),
        ]);
        if (cancelled) return;

        if (settingsResponse.ok) {
          const body = await settingsResponse.json();
          const settings = (body.settings as Record<string, unknown>) ?? {};
          const stored =
            (settings.category_autonomy as Record<string, string>) ?? {};
          const next = initialLevels();
          for (const category of EMAIL_THREAD_CATEGORIES) {
            const value = stored[
              `primary:${category}`
            ] as EmailThreadAutonomyLevel;
            if (allowedLevelsFor(category).includes(value)) {
              next[category] = value;
            }
          }
          setLevels(next);
        }

        if (readinessResponse.ok) {
          const body = await readinessResponse.json();
          setCategoryReadiness(
            (body.categoryReadiness as CategoryReadinessMap) ?? {}
          );
        }
      } catch {
        // The settings surface remains usable at fail-closed defaults.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [company?.id, connectionId, currentUser?.id]);

  useEffect(() => {
    if (loading || !focusPrimaryCategory) return;
    const frame = requestAnimationFrame(() => {
      focusedRowRef.current?.scrollIntoView({ block: "center" });
      focusedRowRef.current
        ?.querySelector<HTMLSelectElement>("select")
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusPrimaryCategory, loading]);

  const commit = useCallback(
    async (category: EmailThreadCategory, level: EmailThreadAutonomyLevel) => {
      if (!company?.id) return;
      const previous = levels[category];
      setSaving(category);
      setSaveError(null);
      setPendingConfirmation(null);
      setLevels((current) => ({ ...current, [category]: level }));

      try {
        const response = await authedFetch(
          "/api/integrations/email/auto-send/settings",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId: company.id,
              connectionId,
              settings: {
                category_autonomy: { [`primary:${category}`]: level },
              },
            }),
          }
        );
        if (!response.ok) throw new Error("category setting rejected");
        toast.success(t("category.saved"));
      } catch {
        setLevels((current) => ({ ...current, [category]: previous }));
        setSaveError(category);
        toast.error(t("error.categorySaveFailed"));
      } finally {
        setSaving(null);
      }
    },
    [company?.id, connectionId, levels, t]
  );

  const chooseLevel = useCallback(
    (category: EmailThreadCategory, level: EmailThreadAutonomyLevel) => {
      if (autonomouslySends(level)) {
        setPendingConfirmation({ category, level });
        return;
      }
      void commit(category, level);
    },
    [commit]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <Loader2 className="h-4 w-4 text-text-mute motion-safe:animate-spin" />
        <span className="font-mohave text-body-sm text-text-mute">
          {t("loading")}
        </span>
      </div>
    );
  }

  const displayedCategories = visiblePrimaryCategories?.length
    ? EMAIL_THREAD_CATEGORIES.filter((category) =>
        visiblePrimaryCategories.includes(category)
      )
    : EMAIL_THREAD_CATEGORIES;

  return (
    <section className="space-y-2" aria-labelledby="category-autonomy-title">
      <header>
        <h3
          id="category-autonomy-title"
          className="font-cakemono text-body-sm font-light uppercase tracking-wide text-text-2"
        >
          {t("category.title")}
        </h3>
        <p className="mt-0.5 font-mono text-micro text-text-mute">
          [{t("category.description")}]
        </p>
      </header>

      <div className="overflow-hidden rounded-panel border border-border bg-surface-input">
        {displayedCategories.map((category, index) => {
          const status = categoryReadiness[category] ?? EMPTY_READINESS;
          const currentLevel = levels[category];
          const isSaving = saving === category;
          const isFocused = category === focusPrimaryCategory;
          const canEnableSend = autoSendFeatureEnabled && status.ready;
          const availableLevels = allowedLevelsFor(category).filter((level) => {
            if (!autonomouslySends(level)) return true;
            if (level === currentLevel) return true;
            return autoSendFeatureEnabled && status.ready;
          });
          const readyToEnable =
            canEnableSend &&
            currentLevel === "auto_draft" &&
            availableLevels.some(autonomouslySends);
          const rate = Math.round(status.approvalRate * 100);

          return (
            <div
              key={category}
              ref={isFocused ? focusedRowRef : undefined}
              className={cn(
                index > 0 && "border-t border-border",
                isFocused && "border-olive-line bg-olive-soft"
              )}
            >
              <div className="flex min-h-12 items-center justify-between gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      categoryDotClassName(category)
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-cakemono text-caption-sm font-light uppercase tracking-wider text-text-2">
                        {categoryLabel(category)}
                      </span>
                      {readyToEnable && (
                        <span className="inline-flex items-center gap-1 rounded-chip border border-olive-line bg-olive-soft px-1.5 py-0.5 font-mono text-micro uppercase tracking-wider text-olive">
                          <CheckCircle2 className="h-3 w-3" aria-hidden />
                          {t("category.readyToEnable")}
                        </span>
                      )}
                    </div>
                    <span className="block font-mono text-micro text-text-mute">
                      {t("category.reviewedAccuracy", {
                        rate,
                        count: status.sampleSize,
                      })}
                    </span>
                  </div>
                </div>

                <div className="relative shrink-0">
                  <select
                    value={currentLevel}
                    onChange={(event) =>
                      chooseLevel(
                        category,
                        event.target.value as EmailThreadAutonomyLevel
                      )
                    }
                    disabled={isSaving || availableLevels.length <= 1}
                    aria-label={t("category.autonomyLabel", {
                      category: categoryLabel(category),
                    })}
                    className={cn(
                      "min-h-11 min-w-36 cursor-pointer appearance-none rounded border border-border bg-surface-input py-1 pl-2 pr-7 font-mohave text-caption-sm text-text-2 outline-none transition-colors focus:border-border-medium",
                      isSaving && "cursor-wait opacity-50"
                    )}
                  >
                    {availableLevels.map((level) => (
                      <option key={level} value={level}>
                        {t(`category.level.${level}`)}
                      </option>
                    ))}
                  </select>
                  {isSaving ? (
                    <Loader2 className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-mute motion-safe:animate-spin" />
                  ) : (
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-mute" />
                  )}
                </div>
              </div>

              {pendingConfirmation?.category === category && (
                <div
                  className="mx-3 mb-2 flex items-start gap-2 rounded-chip border border-olive-line bg-olive-soft px-2 py-1.5"
                  role="alert"
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-olive" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mohave text-caption-sm text-olive">
                      {t("category.warning.autoSend")}
                    </p>
                    <div className="mt-1 flex gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          void commit(category, pendingConfirmation.level)
                        }
                        className="font-mono text-micro uppercase tracking-wider text-olive transition-colors hover:text-text"
                      >
                        {t("confirm")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingConfirmation(null)}
                        className="font-mono text-micro uppercase tracking-wider text-text-mute transition-colors hover:text-text-3"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {saveError === category && (
                <p
                  className="mx-3 mb-2 font-mohave text-caption-sm text-rose"
                  role="alert"
                >
                  {t("error.categorySaveFailed")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
