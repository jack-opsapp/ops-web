"use client";

import { useCallback, useState } from "react";
import { ShieldOff, Check, Headphones, Zap, Crown, Building2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { TIER_CONFIG, type SubscriptionTier } from "@/lib/subscription";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";
import { OpsLockup } from "@/components/brand";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";

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
    accentClass: "text-text",
    borderClass: "border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.18)]",
    glowClass: "",
    badgeClass: "bg-[rgba(255,255,255,0.05)] text-text",
  },
  team: {
    icon: <Crown className="w-[20px] h-[20px]" />,
    accentClass: "text-ops-amber",
    borderClass: "border-ops-amber/30 hover:border-ops-amber/50",
    glowClass: "",
    badgeClass: "bg-ops-amber/10 text-ops-amber",
    popular: true,
  },
  business: {
    icon: <Building2 className="w-[20px] h-[20px]" />,
    accentClass: "text-text",
    borderClass: "border-border-medium hover:border-border-strong",
    glowClass: "",
    badgeClass: "bg-text-primary/10 text-text",
  },
};

// ─── Pricing Card ────────────────────────────────────────────────────────────

function PricingCard({
  tier,
  companyId,
}: {
  tier: Exclude<SubscriptionTier, "trial">;
  companyId: string | undefined;
}) {
  const { t } = useDictionary("auth");
  const config = TIER_CONFIG[tier];
  const display = TIER_DISPLAY[tier];
  const [loading, setLoading] = useState(false);

  // Initiate Stripe Checkout — webhook is the only writer of
  // `companies.subscription_status='active'`, so abandoning the Stripe-hosted
  // checkout leaves the lockout in place. This is the same fix as the
  // CompactPricingCard inside the dashboard lockout overlay (bug
  // ac030a6c-6022-46dd-8d7b-5d477baaec53).
  const handleSubscribe = useCallback(async () => {
    if (loading) return;
    if (!companyId) {
      toast.error(t("locked.subscribeFailed.title"), {
        description: t("locked.subscribeFailed.noCompany"),
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
        body: JSON.stringify({
          companyId,
          plan: tier,
          period: "Monthly",
        }),
      });
      const data = (await res.json()) as { url?: string; message?: string };
      if (!res.ok || !data.url) {
        toast.error(t("locked.subscribeFailed.title"), {
          description: data.message ?? t("locked.subscribeFailed.generic"),
        });
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      toast.error(t("locked.subscribeFailed.title"), {
        description:
          err instanceof Error ? err.message : t("locked.subscribeFailed.generic"),
      });
    } finally {
      setLoading(false);
    }
  }, [loading, companyId, tier, t]);

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-lg border bg-glass glass-surface p-3 transition-all duration-200",
        display.borderClass,
        display.glowClass,
        display.popular && "ring-1 ring-ops-amber/20"
      )}
    >
      {/* Popular badge */}
      {display.popular && (
        <div className="absolute -top-[12px] left-1/2 -translate-x-1/2">
          <span className="font-mono text-micro uppercase tracking-[0.2em] bg-ops-amber text-text-inverse px-1.5 py-0.5 rounded-sm">
            {t("locked.mostPopular")}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-1 mb-2">
        <div className={cn("p-1 rounded bg-fill-neutral-dim", display.accentClass)}>
          {display.icon}
        </div>
        <div>
          <h3 className="font-mohave text-body-lg text-text">{config.name}</h3>
        </div>
      </div>

      {/* Price */}
      <div className="flex items-baseline gap-0.5 mb-2">
        <span className="font-mono text-[36px] leading-none text-text tracking-tight">
          ${config.price}
        </span>
        <span className="font-mohave text-body-sm text-text-3">/mo</span>
      </div>

      {/* Seat count */}
      <div className={cn("inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-caption-sm font-mono mb-2 w-fit", display.badgeClass)}>
        {config.maxSeats} {t("locked.seatsIncluded")}
      </div>

      {/* Features */}
      <ul className="flex flex-col gap-1 mb-3 flex-1">
        {config.features.map((feature) => (
          <li key={feature} className="flex items-start gap-1">
            <Check className={cn("w-[14px] h-[14px] mt-[2px] shrink-0", display.accentClass)} />
            <span className="font-mohave text-body-sm text-text-2">{feature}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <Button
        variant={display.popular ? "accent" : "default"}
        size="lg"
        className="w-full"
        onClick={handleSubscribe}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="w-[16px] h-[16px] animate-spin" />
        ) : (
          t("locked.subscribe")
        )}
      </Button>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LockedPage() {
  const { t } = useDictionary("auth");
  const company = useAuthStore((s) => s.company);
  const companyId = company?.id;
  return (
    <div className="flex flex-col items-center min-h-screen px-2 py-5">
      {/* Logo */}
      <div className="text-center mb-2 text-text">
        <h1 className="leading-none">
          <span className="sr-only">{t("ops")}</span>
          <OpsLockup orientation="vertical" className="h-24 w-auto mx-auto" title="" />
        </h1>
        <p className="font-mono text-caption-sm text-text-3 uppercase tracking-[0.3em] mt-1">
          {t("commandCenter")}
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
        <h2 className="font-mohave text-display text-text mb-1">
          {t("locked.title")}
        </h2>
        <p className="font-mohave text-body text-text-2 leading-relaxed">
          {t("locked.description")}
        </p>
      </div>

      {/* Divider */}
      <div className="w-full max-w-[800px] flex items-center gap-2 my-3">
        <div className="flex-1 h-px bg-border" />
        <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-text-3">
          {t("locked.selectPlan")}
        </span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Pricing grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 w-full max-w-[900px] mb-4">
        <PricingCard tier="starter" companyId={companyId} />
        <PricingCard tier="team" companyId={companyId} />
        <PricingCard tier="business" companyId={companyId} />
      </div>

      {/* Footer */}
      <div className="text-center space-y-1">
        <p className="font-mohave text-body-sm text-text-3">
          {t("locked.guarantee")}
        </p>
        <div className="flex items-center justify-center gap-2">
          <a
            href="mailto:support@opsapp.co"
            className="inline-flex items-center gap-0.5 font-mohave text-body-sm text-text-2 hover:text-text underline underline-offset-4 transition-colors"
          >
            <Headphones className="w-[14px] h-[14px]" />
            {t("locked.contactSupport")}
          </a>
          <span className="text-text-mute">|</span>
          <a
            href="/login"
            className="font-mohave text-body-sm text-text-3 hover:text-text-2 underline underline-offset-4 transition-colors"
          >
            {t("locked.differentAccount")}
          </a>
        </div>

        {/* System fingerprint for defense-tech aesthetic */}
        <p className="font-mono text-micro text-text-mute tracking-wider mt-2 opacity-40">
          {t("locked.sysMessage")}
        </p>
      </div>
    </div>
  );
}
