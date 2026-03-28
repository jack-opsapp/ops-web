"use client";

import { useState } from "react";
import {
  Shield,
  Check,
  Loader2,
  ArrowRight,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  SUBSCRIPTION_PLAN_INFO,
  getDaysRemainingInTrial,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@/lib/types/models";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

// ─── Plan Features Data ──────────────────────────────────────────────────────

const PLAN_FEATURES: Record<SubscriptionPlan, string[]> = {
  [SubscriptionPlan.Trial]: [
    "5 team seats",
    "Unlimited projects",
    "Calendar scheduling",
    "Client management",
  ],
  [SubscriptionPlan.Starter]: [
    "5 team seats",
    "Unlimited projects",
    "Calendar scheduling",
    "Client management",
    "Email support",
  ],
  [SubscriptionPlan.Team]: [
    "15 team seats",
    "Unlimited projects",
    "Calendar scheduling",
    "Client management",
    "Priority support",
    "Custom branding",
  ],
  [SubscriptionPlan.Business]: [
    "50 team seats",
    "Unlimited projects",
    "Calendar scheduling",
    "Client management",
    "Priority support",
    "Custom branding",
    "API access",
    "Dedicated account manager",
  ],
};

// ─── Upgrade Modal (pre-selected plan) ──────────────────────────────────────

function UpgradeModal({
  currentPlan,
  preSelectedPlan,
  onClose,
}: {
  currentPlan: SubscriptionPlan;
  preSelectedPlan: SubscriptionPlan;
  onClose: () => void;
}) {
  const { t } = useDictionary("settings");
  const { company } = useAuthStore();
  const [period, setPeriod] = useState<"Monthly" | "Annual">("Monthly");
  const [isSubscribing, setIsSubscribing] = useState(false);

  const info = SUBSCRIPTION_PLAN_INFO[preSelectedPlan];
  const features = PLAN_FEATURES[preSelectedPlan];
  const price =
    period === "Monthly"
      ? info.monthlyPrice
      : Math.round(info.annualPrice / 12);

  async function handleSubscribe() {
    if (!company) return;
    setIsSubscribing(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const token = await getIdToken();
      const res = await fetch("/api/stripe/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          companyId: company.id,
          plan: preSelectedPlan,
          period,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Subscription failed");
      toast.success(t("subscription.toast.subscribed"));
      onClose();
    } catch (err) {
      toast.error(t("subscription.toast.subscribeFailed"), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsSubscribing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-background-card border border-border rounded-lg w-full max-w-[480px] mx-3">
        {/* Header */}
        <div className="flex items-center justify-between p-2 border-b border-border">
          <h2 className="font-mohave text-heading text-text-primary">
            {t("subscription.upgradeTo")} {info.displayName}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-background-elevated transition-colors"
          >
            <X className="w-[20px] h-[20px] text-text-tertiary" />
          </button>
        </div>

        {/* Plan summary */}
        <div className="p-2 space-y-2">
          {/* Period toggle */}
          <div className="flex items-center justify-center gap-1">
            {(["Monthly", "Annual"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "px-3 py-1 rounded font-mohave text-body-sm transition-all",
                  period === p
                    ? "bg-ops-accent-muted text-ops-accent"
                    : "text-text-tertiary hover:text-text-secondary"
                )}
              >
                {t(`subscription.${p.toLowerCase()}`)}
                {p === "Annual" ? ` (${t("subscription.saveAnnual")})` : ""}
              </button>
            ))}
          </div>

          {/* Price */}
          <div className="text-center">
            <span className="font-mono text-[28px] text-text-primary">
              ${price}
            </span>
            <span className="font-kosugi text-[12px] text-text-disabled">
              {t("subscription.perMonth")}
            </span>
            {period === "Annual" && (
              <p className="font-kosugi text-[11px] text-text-disabled mt-[2px]">
                ${info.annualPrice}{t("subscription.perYear")}
              </p>
            )}
          </div>

          {/* Features */}
          <div className="space-y-[6px] py-1">
            {features.map((f) => (
              <div key={f} className="flex items-center gap-[6px]">
                <Check className="w-[12px] h-[12px] text-ops-accent shrink-0" />
                <span className="font-kosugi text-[11px] text-text-secondary">
                  {f}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Subscribe button */}
        <div className="p-2 border-t border-border">
          <Button
            variant="primary"
            className="w-full gap-[6px]"
            disabled={isSubscribing}
            onClick={handleSubscribe}
          >
            {isSubscribing ? (
              <Loader2 className="w-[16px] h-[16px] animate-spin" />
            ) : (
              <ArrowRight className="w-[16px] h-[16px]" />
            )}
            {t("subscription.upgradeTo")} {info.displayName}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Expandable Plan Card ───────────────────────────────────────────────────

function PlanCard({
  planId,
  isCurrent,
  isDowngrade,
  onUpgrade,
}: {
  planId: SubscriptionPlan;
  isCurrent: boolean;
  isDowngrade: boolean;
  onUpgrade: () => void;
}) {
  const { t } = useDictionary("settings");
  const [expanded, setExpanded] = useState(isCurrent);

  const info = SUBSCRIPTION_PLAN_INFO[planId];
  const features = PLAN_FEATURES[planId];

  return (
    <div
      className={cn(
        "border rounded transition-all duration-200",
        isCurrent
          ? "border-ops-accent bg-[rgba(89,119,159,0.06)]"
          : "border-border hover:border-[rgba(255,255,255,0.15)]"
      )}
    >
      {/* Header — always visible, clickable */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-left"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {expanded ? (
            <ChevronDown className="w-[14px] h-[14px] text-text-disabled shrink-0" />
          ) : (
            <ChevronRight className="w-[14px] h-[14px] text-text-disabled shrink-0" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="font-mohave text-body text-text-primary">
                {info.displayName}
              </h4>
              {isCurrent && (
                <span className="font-kosugi text-[9px] text-ops-accent bg-ops-accent-muted px-[6px] py-[2px] rounded-full uppercase tracking-wider shrink-0">
                  {t("subscription.currentBadge")}
                </span>
              )}
            </div>
            <p className="font-kosugi text-[11px] text-text-disabled">
              {info.maxSeats} {t("subscription.seats")}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono text-data-sm text-text-primary">
            ${info.monthlyPrice}{t("subscription.perMonth")}
          </p>
          {info.annualPrice > 0 && (
            <p className="font-kosugi text-[10px] text-text-disabled">
              ${info.annualPrice}{t("subscription.perYear")}
            </p>
          )}
        </div>
      </button>

      {/* Expanded content — features + upgrade */}
      {expanded && (
        <div className="px-2 pb-2 pt-0 border-t border-[rgba(255,255,255,0.04)] animate-scale-in">
          <div className="space-y-[6px] py-1.5">
            {features.map((f) => (
              <div key={f} className="flex items-center gap-[6px]">
                <Check className="w-[12px] h-[12px] text-ops-accent shrink-0" />
                <span className="font-kosugi text-[11px] text-text-secondary">
                  {f}
                </span>
              </div>
            ))}
          </div>
          {!isCurrent && !isDowngrade && (
            <Button
              variant="primary"
              size="sm"
              className="w-full gap-[6px] mt-1"
              onClick={(e) => {
                e.stopPropagation();
                onUpgrade();
              }}
            >
              <ArrowRight className="w-[14px] h-[14px]" />
              {t("subscription.upgradeTo")} {info.displayName}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Tab ────────────────────────────────────────────────────────────────

export function SubscriptionTab() {
  const { t } = useDictionary("settings");
  const { data: company, isLoading: isCompanyLoading } = useCompany();
  const [upgradePlan, setUpgradePlan] = useState<SubscriptionPlan | null>(null);

  if (isCompanyLoading && !company) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-[24px] h-[24px] text-ops-accent animate-spin" />
      </div>
    );
  }

  const plan = company?.subscriptionPlan ?? SubscriptionPlan.Trial;
  const planInfo = SUBSCRIPTION_PLAN_INFO[plan];
  const seatedCount = company?.seatedEmployeeIds?.length ?? 0;
  const maxSeats = company?.maxSeats ?? planInfo.maxSeats;
  const seatPercentage =
    maxSeats > 0 ? Math.min(100, Math.round((seatedCount / maxSeats) * 100)) : 0;
  const seatsRemaining = Math.max(0, maxSeats - seatedCount);

  const isTrial =
    company?.subscriptionStatus === SubscriptionStatus.Trial ||
    plan === SubscriptionPlan.Trial;
  const trialDaysRemaining = company ? getDaysRemainingInTrial(company) : 0;

  const features = PLAN_FEATURES[plan];

  const priceDisplay =
    planInfo.monthlyPrice === 0
      ? t("subscription.free")
      : `$${planInfo.monthlyPrice}${t("subscription.perMonth")}`;

  const nextBillingDate = company?.subscriptionEnd
    ? new Date(company.subscriptionEnd).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  // Plan order for determining upgrade vs downgrade
  const planOrder = [
    SubscriptionPlan.Trial,
    SubscriptionPlan.Starter,
    SubscriptionPlan.Team,
    SubscriptionPlan.Business,
  ];
  const currentPlanIndex = planOrder.indexOf(plan);

  const availablePlans = [
    SubscriptionPlan.Starter,
    SubscriptionPlan.Team,
    SubscriptionPlan.Business,
  ];

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Current Plan + Features + Seat Usage (combined) */}
        <Card variant="accent">
          <CardContent className="p-2 space-y-2">
            {/* Plan header */}
            <div className="flex items-center justify-between">
              <div>
                <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                  {t("subscription.currentPlan")}
                </span>
                <h3 className="font-mohave text-heading text-text-primary">
                  {planInfo.displayName}
                </h3>
                <p className="font-mono text-data text-ops-accent">
                  {priceDisplay}
                </p>
                {isTrial && trialDaysRemaining > 0 && (
                  <p className="font-kosugi text-[11px] text-ops-amber mt-[4px]">
                    {trialDaysRemaining} {t("subscription.trialRemaining")}
                  </p>
                )}
                {nextBillingDate && !isTrial && (
                  <p className="font-kosugi text-[11px] text-text-disabled mt-[4px]">
                    {t("subscription.nextBilling")}: {nextBillingDate}
                  </p>
                )}
              </div>
              <div className="w-[48px] h-[48px] rounded-lg bg-ops-accent-muted flex items-center justify-center">
                <Shield className="w-[24px] h-[24px] text-ops-accent" />
              </div>
            </div>

            {/* Seat usage */}
            <div className="pt-1.5 border-t border-[rgba(255,255,255,0.06)]">
              <div className="flex items-center justify-between mb-1">
                <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider">
                  {t("subscription.seatUsage")}
                </span>
                <span className="font-mono text-data-sm text-text-primary">
                  {seatedCount} / {maxSeats}
                </span>
              </div>
              <div className="h-[6px] bg-background-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-ops-accent rounded-full transition-all duration-300"
                  style={{ width: `${seatPercentage}%` }}
                />
              </div>
              <p className="font-kosugi text-[10px] text-text-disabled mt-[4px]">
                {seatsRemaining} {t("subscription.seatsRemaining")}
              </p>
            </div>

            {/* Features */}
            <div className="pt-1.5 border-t border-[rgba(255,255,255,0.06)]">
              <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider">
                {t("subscription.planFeatures")}
              </span>
              <div className="space-y-[6px] mt-1">
                {features.map((feature) => (
                  <div key={feature} className="flex items-center gap-[6px]">
                    <Check className="w-[14px] h-[14px] text-ops-accent shrink-0" />
                    <span className="font-kosugi text-[11px] text-text-secondary">
                      {feature}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Available Plans (expandable) */}
        <Card>
          <CardHeader>
            <CardTitle>{t("subscription.availablePlans")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {availablePlans.map((planId) => {
              const isCurrent = planId === plan;
              const isDowngrade =
                planOrder.indexOf(planId) < currentPlanIndex;

              return (
                <PlanCard
                  key={planId}
                  planId={planId}
                  isCurrent={isCurrent}
                  isDowngrade={isDowngrade}
                  onUpgrade={() => setUpgradePlan(planId)}
                />
              );
            })}
          </CardContent>
        </Card>
      </div>

      {upgradePlan && (
        <UpgradeModal
          currentPlan={plan}
          preSelectedPlan={upgradePlan}
          onClose={() => setUpgradePlan(null)}
        />
      )}
    </>
  );
}
