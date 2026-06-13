import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * OnboardingHint — the soft, guidance-bearing affordance: icon + title + optional
 * description + optional action, on a left-border strip.
 *
 * NOT for register/segment tables. DESIGN.md §2 bans this coach-mark form for empty
 * registers ("$0, 0%, or —. No illustrations. No coach-marks."). A register that is
 * simply empty uses `RegisterEmpty` (@/components/ui/register-table) — the tactical
 * "0 // NOUN" fact. Reach for OnboardingHint only on non-register surfaces where
 * guiding the user toward a first action is the point: onboarding nudges, panel /
 * widget placeholders.
 *
 * (Renamed from `EmptyState` on 2026-06-13 — WEB OVERHAUL P4-1 — so it can never be
 * grabbed as the default empty state for a register. See the cross-surface visual
 * cohesion audit §5.2.)
 */

export interface OnboardingHintProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: ButtonProps["variant"];
  };
  className?: string;
}

const OnboardingHint = React.forwardRef<HTMLDivElement, OnboardingHintProps>(
  ({ icon, title, description, action, className }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-start gap-2 py-3 px-3",
        "border-l-2 border-l-border",
        className
      )}
    >
      {icon && (
        <div className="text-text-mute shrink-0 mt-[2px]" aria-hidden="true">
          {icon}
        </div>
      )}
      <div className="flex flex-col items-start gap-0.5">
        <h3 className="font-mohave text-body-lg text-text-2">{title}</h3>
        {description && (
          <p className="font-mohave text-body-sm text-text-3 max-w-[360px]">
            {description}
          </p>
        )}
        {action && (
          <Button
            variant={action.variant ?? "default"}
            size="sm"
            onClick={action.onClick}
            className="mt-1.5"
          >
            {action.label}
          </Button>
        )}
      </div>
    </div>
  )
);
OnboardingHint.displayName = "OnboardingHint";

export { OnboardingHint };
