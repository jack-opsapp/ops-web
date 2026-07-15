"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  Loader2,
  ArrowRight,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SegmentControl } from "@/components/ui/segment-control";
import { Tag } from "@/components/ui/tag";
import {
  InstrumentStrip,
  GlanceGrid,
  GlanceTile,
  TileHero,
  TileSub,
} from "@/components/ui/instrument-strip";
import { useCompany } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  SUBSCRIPTION_PLAN_INFO,
  getDaysRemainingInTrial,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@/lib/types/models";
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { AddonsSection } from "./addons-section";

// ─── Section header (canonical `// TITLE`) ──────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </span>
  );
}

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
  preSelectedPlan,
  onClose,
}: {
  preSelectedPlan: SubscriptionPlan;
  onClose: () => void;
}) {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
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
    if (!can("settings.billing")) return;
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
      if (!res.ok) {
        // 402 from /api/stripe/subscribe means the company has no payment
        // method on file. Surface a specific, actionable toast that routes
        // the user to Settings → Billing instead of the generic failure
        // message — and bail BEFORE showing the success toast.
        if (res.status === 402 || data?.code === "payment_method_required") {
          toast.error(t("subscription.toast.paymentRequired"), {
            description: t("subscription.toast.paymentRequiredDesc"),
            action: {
              label: t("subscription.toast.openBilling"),
              onClick: () => {
                window.location.assign("/settings?tab=billing");
              },
            },
          });
          return;
        }
        throw new Error(data.error ?? "Subscription failed");
      }
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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {t("subscription.upgradeTo")} {info.displayName}
          </DialogTitle>
        </DialogHeader>

        {/* Plan summary */}
        <div className="space-y-2">
          {/* Period toggle */}
          <SegmentControl
            options={[
              { value: "Monthly", label: t("subscription.monthly") },
              {
                value: "Annual",
                label: `${t("subscription.annual")} (${t("subscription.saveAnnual")})`,
              },
            ]}
            value={period}
            onChange={(v) => setPeriod(v as "Monthly" | "Annual")}
          />

          {/* Price */}
          <div>
            <span className="font-mono text-data-lg text-text tabular-nums">
              ${price}
            </span>
            <span className="font-mono text-micro text-text-mute">
              {t("subscription.perMonth")}
            </span>
            {period === "Annual" && (
              <p className="font-mono text-micro text-text-mute mt-[2px] tabular-nums">
                ${info.annualPrice}{t("subscription.perYear")}
              </p>
            )}
          </div>

          {/* Features */}
          <div className="space-y-[6px] py-1">
            {features.map((f) => (
              <div key={f} className="flex items-center gap-[6px]">
                <Check className="w-[12px] h-[12px] text-text-2 shrink-0" />
                <span className="font-mono text-micro text-text-2">
                  {f}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Subscribe button */}
        <div className="pt-2 border-t border-border">
          <Button
            variant="primary"
            className="w-full gap-[6px]"
            disabled={isSubscribing}
            loading={isSubscribing}
            onClick={handleSubscribe}
          >
            {!isSubscribing && <ArrowRight className="w-[16px] h-[16px]" />}
            {t("subscription.upgradeTo")} {info.displayName}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
          ? "border-[rgba(255,255,255,0.18)] bg-surface-active"
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
            <ChevronDown className="w-[14px] h-[14px] text-text-mute shrink-0" />
          ) : (
            <ChevronRight className="w-[14px] h-[14px] text-text-mute shrink-0" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="font-mohave text-body text-text">
                {info.displayName}
              </h4>
              {isCurrent && (
                <Tag variant="neutral" className="shrink-0">
                  {t("subscription.currentBadge")}
                </Tag>
              )}
            </div>
            <p className="font-mono text-micro text-text-mute tabular-nums">
              {info.maxSeats} {t("subscription.seats")}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono text-data-sm text-text tabular-nums">
            ${info.monthlyPrice}{t("subscription.perMonth")}
          </p>
          {info.annualPrice > 0 && (
            <p className="font-mono text-micro text-text-mute tabular-nums">
              ${info.annualPrice}{t("subscription.perYear")}
            </p>
          )}
        </div>
      </button>

      {/* Expanded content — features + upgrade */}
      {expanded && (
        <div className="px-2 pb-2 pt-0 border-t border-border-subtle motion-safe:animate-anchored-in">
          <div className="space-y-[6px] py-1.5">
            {features.map((f) => (
              <div key={f} className="flex items-center gap-[6px]">
                <Check className="w-[12px] h-[12px] text-text-2 shrink-0" />
                <span className="font-mono text-micro text-text-2">
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
  const { data: company, isLoading: isCompanyLoading, refetch } = useCompany();
  const [upgradePlan, setUpgradePlan] = useState<SubscriptionPlan | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Stripe Checkout return — fires a confirmation toast and force-refetches
  // company so the lockout overlay (which keys off `subscriptionStatus`)
  // clears as soon as the webhook flips state. Strips the query so a refresh
  // does not replay the toast.
  useEffect(() => {
    const result = searchParams.get("result");
    if (!result) return;

    if (result === "success") {
      toast.success(t("subscription.toast.active"), {
        description: t("subscription.toast.activeDesc"),
      });
      refetch();
    } else if (result === "cancelled") {
      toast(t("subscription.toast.checkoutCancelled"));
    }

    queueMicrotask(() => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.delete("result");
      params.delete("session_id");
      const next = params.toString();
      router.replace(next ? `/settings?${next}` : "/settings", { scroll: false });
    });
  }, [searchParams, router, refetch, t]);

  if (isCompanyLoading && !company) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-[24px] h-[24px] text-text-2 animate-spin" />
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
      <div className="space-y-4">
        {/* Glance band — PLAN / SEATS / NEXT BILLING */}
        <InstrumentStrip label={t("subscription.currentPlan")}>
          <GlanceGrid className="grid-cols-1 sm:grid-cols-3">
            {/* Plan + price */}
            <GlanceTile label={t("subscription.currentPlan")}>
              <TileHero>{planInfo.displayName}</TileHero>
              <TileSub>{priceDisplay}</TileSub>
            </GlanceTile>

            {/* Seat usage */}
            <GlanceTile
              label={t("subscription.seatUsage")}
              right={
                <span className="font-mono text-micro text-text-3 tabular-nums">
                  {seatPercentage}%
                </span>
              }
            >
              <TileHero>
                {seatedCount} / {maxSeats}
              </TileHero>
              <div className="my-1.5 h-[2px] overflow-hidden rounded-bar bg-fill-neutral-dim">
                <div
                  className="h-full rounded-bar bg-fill-neutral transition-all duration-300 motion-reduce:transition-none"
                  style={{ width: `${seatPercentage}%` }}
                />
              </div>
              <TileSub>
                {seatsRemaining} {t("subscription.seatsRemaining")}
              </TileSub>
            </GlanceTile>

            {/* Next billing / trial */}
            <GlanceTile
              label={
                isTrial
                  ? t("subscription.trialRemaining")
                  : t("subscription.nextBilling")
              }
            >
              {isTrial && trialDaysRemaining > 0 ? (
                <TileHero tone="olive">{trialDaysRemaining}</TileHero>
              ) : nextBillingDate && !isTrial ? (
                <TileHero>{nextBillingDate}</TileHero>
              ) : (
                <TileHero>—</TileHero>
              )}
              <TileSub>{priceDisplay}</TileSub>
            </GlanceTile>
          </GlanceGrid>
        </InstrumentStrip>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Current plan features */}
          <Card>
            <div className="pb-2">
              <SectionLabel>{t("subscription.planFeatures")}</SectionLabel>
            </div>
            <CardContent className="space-y-[6px]">
              {features.map((feature) => (
                <div key={feature} className="flex items-center gap-[6px]">
                  <Check className="w-[14px] h-[14px] text-text-2 shrink-0" />
                  <span className="font-mono text-micro text-text-2">
                    {feature}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Available Plans (expandable) */}
          <Card>
            <div className="pb-2">
              <SectionLabel>{t("subscription.availablePlans")}</SectionLabel>
            </div>
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

        {/* Add-ons — Data Setup + Priority Support */}
        <AddonsSection />
      </div>

      {upgradePlan && (
        <UpgradeModal
          preSelectedPlan={upgradePlan}
          onClose={() => setUpgradePlan(null)}
        />
      )}
    </>
  );
}
