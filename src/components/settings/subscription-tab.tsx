"use client";

import { Shield, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/lib/hooks";
import {
  SUBSCRIPTION_PLAN_INFO,
  getDaysRemainingInTrial,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@/lib/types/models";
import { toast } from "sonner";

export function SubscriptionTab() {
  const { data: company, isLoading: isCompanyLoading } = useCompany();

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

  const features = [
    "Unlimited projects",
    `${maxSeats} team seat${maxSeats !== 1 ? "s" : ""}`,
    "Calendar & scheduling",
    "Client management",
    ...(plan === SubscriptionPlan.Team || plan === SubscriptionPlan.Business
      ? ["Priority support"]
      : []),
    ...(plan === SubscriptionPlan.Business ? ["API access"] : []),
  ];

  const priceDisplay = planInfo.monthlyPrice === 0
    ? "Free"
    : `$${planInfo.monthlyPrice}/month`;

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card variant="accent">
        <CardContent className="p-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                Current Plan
              </span>
              <h3 className="font-mohave text-heading text-text-primary">{planInfo.displayName}</h3>
              <p className="font-mono text-data text-ops-accent">{priceDisplay}</p>
              {isTrial && trialDaysRemaining > 0 && (
                <p className="font-kosugi text-[11px] text-ops-amber mt-[4px]">
                  {trialDaysRemaining} day{trialDaysRemaining !== 1 ? "s" : ""} remaining in trial
                </p>
              )}
            </div>
            <div className="w-[48px] h-[48px] rounded-lg bg-ops-accent-muted flex items-center justify-center">
              <Shield className="w-[24px] h-[24px] text-ops-accent" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seat Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-1">
            <span className="font-mohave text-body text-text-secondary">Active Members</span>
            <span className="font-mono text-data text-text-primary">{seatedCount} / {maxSeats}</span>
          </div>
          <div className="h-[6px] bg-background-elevated rounded-full overflow-hidden">
            <div className="h-full bg-ops-accent rounded-full" style={{ width: `${seatPercentage}%` }} />
          </div>
          <p className="font-kosugi text-[11px] text-text-tertiary mt-[6px]">
            {seatsRemaining} seat{seatsRemaining !== 1 ? "s" : ""} remaining on your plan
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plan Features</CardTitle>
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
          <Button variant="accent" className="mt-2 w-full" onClick={() => toast.info("Contact support to upgrade your plan", { description: "Email support@opsapp.co for subscription changes." })}>
            Upgrade Plan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
