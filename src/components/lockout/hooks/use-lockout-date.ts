import { useMemo } from "react";
import { type Company, SubscriptionPlan } from "@/lib/types/models";

type CompanyDateInput = Pick<
  Company,
  "subscriptionPlan" | "trialEndDate" | "subscriptionEnd"
>;

/**
 * Resolves the "expired on" date for a lockout display.
 * - Trial path → trial_end_date
 * - Paid path → subscription_end, falling back to trial_end_date as historical anchor
 * - Invalid / missing → null (renderer picks the dateless copy variant)
 */
export function useLockoutDate(company: CompanyDateInput | null): Date | null {
  return useMemo(() => {
    if (!company) return null;

    const candidate =
      company.subscriptionPlan === SubscriptionPlan.Trial
        ? company.trialEndDate
        : company.subscriptionEnd ?? company.trialEndDate;

    if (!candidate) return null;

    const date =
      candidate instanceof Date
        ? candidate
        : new Date(candidate as unknown as string);

    return Number.isNaN(date.getTime()) ? null : date;
  }, [company]);
}
