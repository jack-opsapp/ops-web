import { PricingCard } from "./pricing-card";
import type { SubscriptionTier } from "@/lib/subscription";

export interface PricingRowProps {
  companyId: string | undefined;
  recommendedTier?: Exclude<SubscriptionTier, "trial">;
}

const TIERS: ReadonlyArray<Exclude<SubscriptionTier, "trial">> = [
  "starter",
  "team",
  "business",
];

export function PricingRow({
  companyId,
  recommendedTier = "team",
}: PricingRowProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {TIERS.map((tier) => (
        <PricingCard
          key={tier}
          tier={tier}
          companyId={companyId}
          isRecommended={tier === recommendedTier}
        />
      ))}
    </div>
  );
}
