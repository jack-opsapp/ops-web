"use client";

import { X, AlertTriangle, Clock, Users } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { type SubscriptionInfo } from "@/lib/subscription";

interface SubscriptionBannerProps {
  subscription: SubscriptionInfo;
}

export function SubscriptionBanner({ subscription }: SubscriptionBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  // Determine what to show
  let message = "";
  let icon = Clock;
  let variant: "warning" | "error" | "info" = "info";

  if (subscription.status === "past_due") {
    message = "Your payment is past due. Please update your payment method to avoid service interruption.";
    icon = AlertTriangle;
    variant = "error";
  } else if (subscription.daysRemaining !== undefined && subscription.daysRemaining <= 7) {
    message = `Your trial ends in ${subscription.daysRemaining} day${subscription.daysRemaining !== 1 ? "s" : ""}. Upgrade now to keep your data.`;
    icon = Clock;
    variant = "warning";
  } else if (subscription.currentSeats >= subscription.maxSeats - 1) {
    message = `You're using ${subscription.currentSeats} of ${subscription.maxSeats} seats. Upgrade for more team members.`;
    icon = Users;
    variant = "info";
  } else {
    return null;
  }

  const Icon = icon;

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 text-body-sm font-mohave",
      variant === "error" && "bg-ops-error/20 text-red-300 border-b border-ops-error/30",
      variant === "warning" && "bg-amber-900/20 text-amber-300 border-b border-amber-700/30",
      variant === "info" && "bg-ops-accent/10 text-ops-accent border-b border-ops-accent/20",
    )}>
      <Icon className="w-[16px] h-[16px] shrink-0" />
      <span className="flex-1">{message}</span>
      <a
        href="/settings"
        className="font-mohave text-body-sm underline underline-offset-2 hover:text-text-primary transition-colors shrink-0"
      >
        {variant === "error" ? "Fix Payment" : "Upgrade"}
      </a>
      <button
        onClick={() => setDismissed(true)}
        className="text-current/50 hover:text-current transition-colors shrink-0"
        aria-label="Dismiss banner"
      >
        <X className="w-[14px] h-[14px]" />
      </button>
    </div>
  );
}
