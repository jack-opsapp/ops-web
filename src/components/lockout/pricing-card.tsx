"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  TIER_CONFIG,
  type SubscriptionTier,
} from "@/lib/subscription";

export interface PricingCardProps {
  tier: Exclude<SubscriptionTier, "trial">;
  companyId: string | undefined;
  isRecommended: boolean;
}

export function PricingCard({ tier, companyId, isRecommended }: PricingCardProps) {
  const { t } = useDictionary("auth");
  const config = TIER_CONFIG[tier];
  const [loading, setLoading] = useState(false);

  const handleSubscribe = useCallback(async () => {
    if (loading) return;
    if (!companyId) {
      toast.error(t("lockout.pricing.subscribeFailed.title"), {
        description: t("lockout.pricing.subscribeFailed.noCompany"),
      });
      return;
    }
    setLoading(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const token = await getIdToken();
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ companyId, plan: tier, period: "Monthly" }),
      });
      const data = (await res.json()) as { url?: string; message?: string };
      if (!res.ok || !data.url) {
        toast.error(t("lockout.pricing.subscribeFailed.title"), {
          description: data.message ?? t("lockout.pricing.subscribeFailed.generic"),
        });
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      toast.error(t("lockout.pricing.subscribeFailed.title"), {
        description:
          err instanceof Error ? err.message : t("lockout.pricing.subscribeFailed.generic"),
      });
    } finally {
      setLoading(false);
    }
  }, [loading, companyId, tier, t]);

  const summaryKey = `lockout.pricing.${tier}.summary`;

  return (
    <div className="relative flex flex-col">
      {/* Always render the label slot so all 3 cards align top-of-card.
          Non-recommended cards render an invisible spacer to reserve height. */}
      <p
        className={cn(
          "font-cakemono font-light text-[11px] uppercase tracking-[0.08em] mb-1",
          isRecommended ? "text-text-3" : "invisible select-none"
        )}
        aria-hidden={!isRecommended}
      >
        {"// "}
        {t("lockout.pricing.recommended")}
      </p>
      <div className="glass-surface rounded-[5px] p-5 flex flex-col flex-1">
        <h3 className="font-cakemono font-light text-[18px] uppercase tracking-tight text-text mb-2">
          {config.name}
        </h3>
        <div className="flex items-baseline gap-1 mb-2">
          <span className="font-mono text-[28px] leading-none text-text [font-feature-settings:'tnum'_1,'zero'_1]">
            ${config.price}
          </span>
          <span className="font-mohave text-[13px] text-text-3">
            {t("lockout.pricing.perMonth")}
          </span>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 mb-2 [font-feature-settings:'tnum'_1,'zero'_1]">
          {config.maxSeats} {t("lockout.pricing.seatsLabel")}
        </p>
        <p className="font-mohave text-[14px] text-text-2 mb-4 flex-1">{t(summaryKey)}</p>
        <Button
          variant={isRecommended ? "primary" : "default"}
          size="sm"
          className="flex"
          style={{ width: "100%" }}
          onClick={handleSubscribe}
          disabled={loading}
          loading={loading}
        >
          {t("lockout.pricing.subscribe")}
        </Button>
      </div>
    </div>
  );
}
