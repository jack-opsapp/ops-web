/**
 * OPS Web - Subscription Enforcement Utilities
 *
 * Tier definitions, enforcement logic, and subscription status helpers.
 * Works with the Company model from models.ts and the existing
 * SubscriptionStatus / SubscriptionPlan enums defined there.
 */

import {
  type Company,
  SubscriptionStatus,
  SubscriptionPlan,
} from "@/lib/types/models";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SubscriptionTier = "trial" | "starter" | "team" | "business";
export type SubscriptionStatusValue = "active" | "past_due" | "canceled" | "expired" | "trialing" | "grace";

export interface SubscriptionInfo {
  tier: SubscriptionTier;
  status: SubscriptionStatusValue;
  maxSeats: number;
  currentSeats: number;
  trialEndsAt?: Date;
  isActive: boolean;
  daysRemaining?: number;
}

// ─── Tier Configuration ──────────────────────────────────────────────────────

export const TIER_CONFIG: Record<SubscriptionTier, {
  name: string;
  price: number;
  maxSeats: number;
  features: string[];
}> = {
  trial: {
    name: "Free Trial",
    price: 0,
    maxSeats: 10,
    features: ["All features", "30-day trial", "10 team members"],
  },
  starter: {
    name: "Starter",
    price: 90,
    maxSeats: 3,
    features: ["All core features", "3 team members", "Email support"],
  },
  team: {
    name: "Team",
    price: 140,
    maxSeats: 5,
    features: ["All features", "5 team members", "Priority support", "Custom reports"],
  },
  business: {
    name: "Business",
    price: 190,
    maxSeats: 10,
    features: ["All features", "10 team members", "Dedicated support", "API access", "Custom integrations"],
  },
};

// ─── Status Mapping ──────────────────────────────────────────────────────────

/** Map the Company model's SubscriptionStatus enum to our internal status value */
function mapSubscriptionStatus(status: SubscriptionStatus | null): SubscriptionStatusValue {
  switch (status) {
    case SubscriptionStatus.Active:
      return "active";
    case SubscriptionStatus.Trial:
      return "trialing";
    case SubscriptionStatus.Grace:
      return "grace";
    case SubscriptionStatus.Expired:
      return "expired";
    case SubscriptionStatus.Cancelled:
      return "canceled";
    default:
      return "trialing";
  }
}

/** Map the Company model's SubscriptionPlan enum to our tier string */
function mapSubscriptionPlan(plan: SubscriptionPlan | null): SubscriptionTier {
  switch (plan) {
    case SubscriptionPlan.Starter:
      return "starter";
    case SubscriptionPlan.Team:
      return "team";
    case SubscriptionPlan.Business:
      return "business";
    case SubscriptionPlan.Trial:
    default:
      return "trial";
  }
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Derive complete subscription info from a Company entity.
 *
 * Accepts a partial Company shape so callers don't need the full entity,
 * and also accepts `null` for cases where the company hasn't loaded yet
 * (defaults to a generous trial state so the UI doesn't lock prematurely).
 */
export function getSubscriptionInfo(company: Pick<
  Company,
  | "subscriptionPlan"
  | "subscriptionStatus"
  | "trialEndDate"
  | "seatedEmployeeIds"
  | "adminIds"
  | "maxSeats"
> | null): SubscriptionInfo {
  if (!company) {
    return {
      tier: "trial",
      status: "trialing",
      maxSeats: 10,
      currentSeats: 0,
      isActive: true,
      daysRemaining: 30,
    };
  }

  const tier = mapSubscriptionPlan(company.subscriptionPlan);
  const status = mapSubscriptionStatus(company.subscriptionStatus);
  const currentSeats = (company.seatedEmployeeIds?.length || 0) + (company.adminIds?.length || 0);
  const maxSeats = company.maxSeats || TIER_CONFIG[tier].maxSeats;

  let daysRemaining: number | undefined;
  let trialEndsAt: Date | undefined;

  if (tier === "trial" && company.trialEndDate) {
    trialEndsAt = company.trialEndDate instanceof Date
      ? company.trialEndDate
      : new Date(company.trialEndDate as unknown as string);
    daysRemaining = Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }

  const isActive =
    status === "active" ||
    status === "trialing" ||
    status === "grace" ||
    (tier === "trial" && daysRemaining !== undefined && daysRemaining > 0);

  return {
    tier,
    status,
    maxSeats,
    currentSeats,
    trialEndsAt,
    isActive,
    daysRemaining,
  };
}

// ─── Enforcement Helpers ─────────────────────────────────────────────────────

/** Whether the company has room to add another seated employee */
export function canAddSeat(info: SubscriptionInfo): boolean {
  return info.currentSeats < info.maxSeats;
}

/** Whether the UI should nudge the user toward upgrading */
export function shouldShowUpgrade(info: SubscriptionInfo): boolean {
  return (
    info.tier === "trial" ||
    (info.daysRemaining !== undefined && info.daysRemaining <= 7) ||
    info.currentSeats >= info.maxSeats - 1
  );
}

/** Whether the user should be redirected to the lockout page */
export function shouldLockOut(info: SubscriptionInfo): boolean {
  return !info.isActive;
}

/** Whether a dismissible warning banner should be shown */
export function shouldShowBanner(info: SubscriptionInfo): boolean {
  if (info.status === "past_due") return true;
  if (info.daysRemaining !== undefined && info.daysRemaining <= 7) return true;
  if (info.currentSeats >= info.maxSeats - 1) return true;
  return false;
}
