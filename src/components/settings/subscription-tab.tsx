"use client";

import { useState } from "react";
import { Shield, Check, Loader2, ArrowRight, X } from "lucide-react";
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

// ─── Upgrade Modal ──────────────────────────────────────────────────────────

function UpgradeModal({
  currentPlan,
  onClose,
}: {
  currentPlan: SubscriptionPlan;
  onClose: () => void;
}) {
  const { t } = useDictionary("settings");
  const { company } = useAuthStore();
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [period, setPeriod] = useState<"Monthly" | "Annual">("Monthly");
  const [isSubscribing, setIsSubscribing] = useState(false);

  const upgradePlans = [
    SubscriptionPlan.Starter,
    SubscriptionPlan.Team,
    SubscriptionPlan.Business,
  ].filter((p) => p !== currentPlan);

  async function handleSubscribe() {
    if (!selectedPlan || !company) return;
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
          plan: selectedPlan,
          period,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Subscription failed");
      toast.success(t("subscription.toast.subscribed") ?? "Plan updated successfully!");
      onClose();
    } catch (err) {
      toast.error(t("subscription.toast.subscribeFailed") ?? "Failed to update plan", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsSubscribing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-background-card border border-border rounded-lg w-full max-w-[700px] mx-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-2 border-b border-border">
          <h2 className="font-mohave text-heading text-text-primary">{t("subscription.choosePlan") ?? "Choose a plan"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-background-elevated transition-colors">
            <X className="w-[20px] h-[20px] text-text-tertiary" />
          </button>
        </div>

        {/* Period toggle */}
        <div className="flex items-center justify-center gap-1 p-2">
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
              {p}{p === "Annual" ? " (save ~20%)" : ""}
            </button>
          ))}
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 p-2">
          {upgradePlans.map((planId) => {
            const info = SUBSCRIPTION_PLAN_INFO[planId];
            const features = PLAN_FEATURES[planId];
            const isSelected = selectedPlan === planId;
            const price = period === "Monthly" ? info.monthlyPrice : Math.round(info.annualPrice / 12);

            return (
              <button
                key={planId}
                onClick={() => setSelectedPlan(planId)}
                className={cn(
                  "text-left p-2 rounded-lg border transition-all",
                  isSelected
                    ? "border-ops-accent bg-ops-accent-muted"
                    : "border-border hover:border-border-medium"
                )}
              >
                <h3 className="font-mohave text-card-title text-text-primary">{info.displayName}</h3>
                <p className="font-mono text-data text-ops-accent mt-0.5">
                  ${price}/mo
                  {period === "Annual" && (
                    <span className="font-kosugi text-[10px] text-text-disabled ml-1">
                      (${info.annualPrice}/yr)
                    </span>
                  )}
                </p>
                <p className="font-kosugi text-[11px] text-text-tertiary mt-0.5">
                  {info.maxSeats} seats
                </p>
                <div className="mt-1.5 space-y-[4px]">
                  {features.map((f) => (
                    <div key={f} className="flex items-center gap-[4px]">
                      <Check className="w-[12px] h-[12px] text-ops-accent shrink-0" />
                      <span className="font-kosugi text-[11px] text-text-secondary">{f}</span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        {/* Subscribe button */}
        <div className="p-2 border-t border-border">
          <Button
            variant="accent"
            className="w-full gap-[6px]"
            disabled={!selectedPlan || isSubscribing}
            onClick={handleSubscribe}
          >
            {isSubscribing ? (
              <Loader2 className="w-[16px] h-[16px] animate-spin" />
            ) : (
              <ArrowRight className="w-[16px] h-[16px]" />
            )}
            {selectedPlan
              ? `${t("subscription.upgrade") ?? "Upgrade"} to ${SUBSCRIPTION_PLAN_INFO[selectedPlan].displayName}`
              : t("subscription.selectPlan") ?? "Select a plan"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Tab ────────────────────────────────────────────────────────────────

export function SubscriptionTab() {
  const { t } = useDictionary("settings");
  const { data: company, isLoading: isCompanyLoading } = useCompany();
  const [showUpgrade, setShowUpgrade] = useState(false);

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
  const seatPercentage = maxSeats > 0 ? Math.min(100, Math.round((seatedCount / maxSeats) * 100)) : 0;
  const seatsRemaining = Math.max(0, maxSeats - seatedCount);

  const isTrial = company?.subscriptionStatus === SubscriptionStatus.Trial || plan === SubscriptionPlan.Trial;
  const trialDaysRemaining = company ? getDaysRemainingInTrial(company) : 0;
  const isMaxPlan = plan === SubscriptionPlan.Business;

  const features = PLAN_FEATURES[plan];

  const priceDisplay = planInfo.monthlyPrice === 0
    ? t("subscription.free")
    : `$${planInfo.monthlyPrice}${t("subscription.perMonth")}`;

  // Next billing date from subscription end
  const nextBillingDate = company?.subscriptionEnd
    ? new Date(company.subscriptionEnd).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Current plan card */}
        <Card variant="accent">
          <CardContent className="p-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                  {t("subscription.currentPlan")}
                </span>
                <h3 className="font-mohave text-heading text-text-primary">{planInfo.displayName}</h3>
                <p className="font-mono text-data text-ops-accent">{priceDisplay}</p>
                {isTrial && trialDaysRemaining > 0 && (
                  <p className="font-kosugi text-[11px] text-ops-amber mt-[4px]">
                    {trialDaysRemaining} {t("subscription.trialRemaining")}
                  </p>
                )}
                {nextBillingDate && !isTrial && (
                  <p className="font-kosugi text-[11px] text-text-disabled mt-[4px]">
                    Next billing: {nextBillingDate}
                  </p>
                )}
              </div>
              <div className="w-[48px] h-[48px] rounded-lg bg-ops-accent-muted flex items-center justify-center">
                <Shield className="w-[24px] h-[24px] text-ops-accent" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Seat usage */}
        <Card>
          <CardHeader>
            <CardTitle>{t("subscription.seatUsage")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-1">
              <span className="font-mohave text-body text-text-secondary">{t("subscription.activeMembers")}</span>
              <span className="font-mono text-data text-text-primary">{seatedCount} / {maxSeats}</span>
            </div>
            <div className="h-[6px] bg-background-elevated rounded-full overflow-hidden">
              <div className="h-full bg-ops-accent rounded-full" style={{ width: `${seatPercentage}%` }} />
            </div>
            <p className="font-kosugi text-[11px] text-text-tertiary mt-[6px]">
              {seatsRemaining} {t("subscription.seatsRemaining")}
            </p>
          </CardContent>
        </Card>

        {/* Plan features */}
        <Card>
          <CardHeader>
            <CardTitle>{t("subscription.planFeatures")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-[8px]">
              {features.map((feature) => (
                <div key={feature} className="flex items-center gap-1">
                  <Check className="w-[16px] h-[16px] text-ops-accent shrink-0" />
                  <span className="font-mohave text-body-sm text-text-secondary">{feature}</span>
                </div>
              ))}
            </div>
            {!isMaxPlan && (
              <Button variant="accent" className="mt-2 w-full gap-[6px]" onClick={() => setShowUpgrade(true)}>
                <ArrowRight className="w-[16px] h-[16px]" />
                {t("subscription.upgrade")}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Available plans at a glance */}
        <Card>
          <CardHeader>
            <CardTitle>Available Plans</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {([SubscriptionPlan.Starter, SubscriptionPlan.Team, SubscriptionPlan.Business] as const).map((planId) => {
              const info = SUBSCRIPTION_PLAN_INFO[planId];
              const isCurrent = planId === plan;
              return (
                <div
                  key={planId}
                  className={cn(
                    "flex items-center justify-between px-1.5 py-[8px] rounded border",
                    isCurrent
                      ? "border-ops-accent bg-ops-accent-muted"
                      : "border-border"
                  )}
                >
                  <div>
                    <p className="font-mohave text-body text-text-primary">{info.displayName}</p>
                    <p className="font-kosugi text-[11px] text-text-disabled">
                      {info.maxSeats} seats
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-data-sm text-text-primary">${info.monthlyPrice}/mo</p>
                    {isCurrent && (
                      <span className="font-kosugi text-[9px] text-ops-accent uppercase tracking-wider">Current</span>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {showUpgrade && (
        <UpgradeModal currentPlan={plan} onClose={() => setShowUpgrade(false)} />
      )}
    </>
  );
}
