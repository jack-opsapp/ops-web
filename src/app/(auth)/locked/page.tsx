"use client";

import { ShieldOff, Check, ExternalLink, Headphones, Zap, Crown, Building2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { TIER_CONFIG, type SubscriptionTier } from "@/lib/subscription";
import { Button } from "@/components/ui/button";

// ─── Tier Visual Config ──────────────────────────────────────────────────────

const TIER_DISPLAY: Record<Exclude<SubscriptionTier, "trial">, {
  icon: React.ReactNode;
  accentClass: string;
  borderClass: string;
  glowClass: string;
  badgeClass: string;
  popular?: boolean;
}> = {
  starter: {
    icon: <Zap className="w-[20px] h-[20px]" />,
    accentClass: "text-ops-accent",
    borderClass: "border-ops-accent/20 hover:border-ops-accent/40",
    glowClass: "hover:shadow-glow-accent",
    badgeClass: "bg-ops-accent/10 text-ops-accent",
  },
  team: {
    icon: <Crown className="w-[20px] h-[20px]" />,
    accentClass: "text-ops-amber",
    borderClass: "border-ops-amber/30 hover:border-ops-amber/50",
    glowClass: "hover:shadow-glow-amber",
    badgeClass: "bg-ops-amber/10 text-ops-amber",
    popular: true,
  },
  business: {
    icon: <Building2 className="w-[20px] h-[20px]" />,
    accentClass: "text-text-primary",
    borderClass: "border-border-medium hover:border-border-strong",
    glowClass: "hover:shadow-elevated",
    badgeClass: "bg-text-primary/10 text-text-primary",
  },
};

// ─── Pricing Card ────────────────────────────────────────────────────────────

function PricingCard({ tier }: { tier: Exclude<SubscriptionTier, "trial"> }) {
  const config = TIER_CONFIG[tier];
  const display = TIER_DISPLAY[tier];

  // Placeholder Stripe checkout URL
  const checkoutUrl = `https://billing.stripe.com/checkout?plan=${tier}`;

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-lg border bg-background-panel p-3 transition-all duration-200",
        display.borderClass,
        display.glowClass,
        display.popular && "ring-1 ring-ops-amber/20"
      )}
    >
      {/* Popular badge */}
      {display.popular && (
        <div className="absolute -top-[12px] left-1/2 -translate-x-1/2">
          <span className="font-kosugi text-[10px] uppercase tracking-[0.2em] bg-ops-amber text-text-inverse px-1.5 py-0.5 rounded-sm">
            Most Popular
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-1 mb-2">
        <div className={cn("p-1 rounded bg-background-elevated", display.accentClass)}>
          {display.icon}
        </div>
        <div>
          <h3 className="font-mohave text-body-lg text-text-primary">{config.name}</h3>
        </div>
      </div>

      {/* Price */}
      <div className="flex items-baseline gap-0.5 mb-2">
        <span className="font-mono text-[36px] leading-none text-text-primary tracking-tight">
          ${config.price}
        </span>
        <span className="font-mohave text-body-sm text-text-tertiary">/mo</span>
      </div>

      {/* Seat count */}
      <div className={cn("inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-caption-sm font-mono mb-2 w-fit", display.badgeClass)}>
        {config.maxSeats} seats included
      </div>

      {/* Features */}
      <ul className="flex flex-col gap-1 mb-3 flex-1">
        {config.features.map((feature) => (
          <li key={feature} className="flex items-start gap-1">
            <Check className={cn("w-[14px] h-[14px] mt-[2px] shrink-0", display.accentClass)} />
            <span className="font-mohave text-body-sm text-text-secondary">{feature}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <a href={checkoutUrl} className="block">
        <Button
          variant={display.popular ? "accent" : "default"}
          size="lg"
          className="w-full"
        >
          Subscribe
          <ExternalLink className="w-[14px] h-[14px] ml-0.5" />
        </Button>
      </a>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LockedPage() {
  return (
    <div className="flex flex-col items-center min-h-screen px-2 py-5">
      {/* Logo */}
      <div className="text-center mb-2">
        <h1 className="font-bebas text-[56px] tracking-[0.2em] text-ops-accent leading-none">
          OPS
        </h1>
        <p className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-[0.3em] mt-0.5">
          Command Center
        </p>
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-1 mb-2">
        <div className="p-1 rounded-full bg-ops-error/15">
          <ShieldOff className="w-[24px] h-[24px] text-ops-error" />
        </div>
      </div>

      {/* Heading */}
      <div className="text-center mb-1 max-w-[600px]">
        <h2 className="font-mohave text-display text-text-primary mb-1">
          Your subscription has expired
        </h2>
        <p className="font-mohave text-body text-text-secondary leading-relaxed">
          Your access to the OPS command center has been suspended.
          All your data is safe and will be available once you reactivate your subscription.
          Choose a plan below to restore full access.
        </p>
      </div>

      {/* Divider */}
      <div className="w-full max-w-[800px] flex items-center gap-2 my-3">
        <div className="flex-1 h-px bg-border" />
        <span className="font-kosugi text-[11px] uppercase tracking-[0.3em] text-text-tertiary">
          Select a Plan
        </span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Pricing grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 w-full max-w-[900px] mb-4">
        <PricingCard tier="starter" />
        <PricingCard tier="team" />
        <PricingCard tier="business" />
      </div>

      {/* Footer */}
      <div className="text-center space-y-1">
        <p className="font-mohave text-body-sm text-text-tertiary">
          All plans include a 30-day money-back guarantee.
        </p>
        <div className="flex items-center justify-center gap-2">
          <a
            href="mailto:support@opsapp.co"
            className="inline-flex items-center gap-0.5 font-mohave text-body-sm text-ops-accent hover:text-ops-accent-hover underline underline-offset-4 transition-colors"
          >
            <Headphones className="w-[14px] h-[14px]" />
            Contact Support
          </a>
          <span className="text-text-disabled">|</span>
          <a
            href="/login"
            className="font-mohave text-body-sm text-text-tertiary hover:text-text-secondary underline underline-offset-4 transition-colors"
          >
            Sign in with a different account
          </a>
        </div>

        {/* System fingerprint for defense-tech aesthetic */}
        <p className="font-mono text-[10px] text-text-disabled tracking-wider mt-2 opacity-40">
          SYS::SUBSCRIPTION_LOCKOUT // ACCESS_LEVEL::NONE // RETRY::PAYMENT_REQUIRED
        </p>
      </div>
    </div>
  );
}
