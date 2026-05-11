"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldOff,
  UserX,
  Check,
  Headphones,
  Zap,
  Crown,
  Building2,
  Users,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  getLockoutReason,
  TIER_CONFIG,
  type SubscriptionTier,
} from "@/lib/subscription";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";
import { OpsLockup } from "@/components/brand";
import { useAuthStore, selectIsAdminOrOwner } from "@/lib/store/auth-store";
import { requireSupabase } from "@/lib/supabase/helpers";
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

// ─── Admin Name Hook (mirrors LockoutOverlay.useAdminNames) ──────────────────

function useAdminNames(adminIds: string[] | undefined) {
  const [admins, setAdmins] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!adminIds?.length) return;

    let cancelled = false;

    async function fetchAdminNames() {
      try {
        const supabase = requireSupabase();
        const { data } = await supabase
          .from("users")
          .select("id, first_name, last_name")
          .in("id", adminIds!);

        if (cancelled || !data) return;

        setAdmins(
          data.map((u: { id: string; first_name: string; last_name: string }) => ({
            id: u.id,
            name: [u.first_name, u.last_name].filter(Boolean).join(" ") || "Admin",
          }))
        );
      } catch {
        // Silently fail — admin names are cosmetic
      }
    }

    fetchAdminNames();
    return () => { cancelled = true; };
  }, [adminIds]);

  return admins;
}

// ─── Cooldown helpers (mirrors LockoutOverlay) ───────────────────────────────

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function getCooldownKey(userId: string): string {
  return `ops-lockout-request-${userId}`;
}

function isWithinCooldown(userId: string): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(getCooldownKey(userId));
  if (!stored) return false;
  try {
    const { timestamp } = JSON.parse(stored);
    return Date.now() - timestamp < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function setCooldown(userId: string, reason: "subscription_expired" | "unseated"): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    getCooldownKey(userId),
    JSON.stringify({ timestamp: Date.now(), reason })
  );
}

// ─── Request Button ──────────────────────────────────────────────────────────

function RequestButton({
  label,
  sentLabel,
  userId,
  adminIds,
  companyId,
  userName,
  reason,
}: {
  label: string;
  sentLabel: string;
  userId: string;
  adminIds: string[];
  companyId: string;
  userName: string;
  reason: "subscription_expired" | "unseated";
}) {
  const [sent, setSent] = useState(() => isWithinCooldown(userId));
  const [sending, setSending] = useState(false);

  const noAdmins = adminIds.length === 0;

  const handleRequest = useCallback(async () => {
    if (sent || sending || noAdmins) return;
    setSending(true);

    try {
      const supabase = requireSupabase();
      const isReactivation = reason === "subscription_expired";

      const rows = adminIds.map((adminId) => ({
        user_id: adminId,
        company_id: companyId,
        type: "role_needed" as const,
        title: isReactivation ? "Reactivation Request" : "Access Request",
        body: isReactivation
          ? `${userName} is requesting subscription reactivation`
          : `${userName} is requesting seat restoration`,
        is_read: false,
        persistent: true,
        action_url: isReactivation ? "/settings?tab=subscription" : "/team",
        action_label: isReactivation ? "Manage Subscription" : "Manage Team",
      }));

      const { error } = await supabase.from("notifications").insert(rows);
      if (!error) {
        setCooldown(userId, reason);
        setSent(true);
      }
    } catch {
      // Silently fail
    } finally {
      setSending(false);
    }
  }, [sent, sending, noAdmins, adminIds, companyId, userName, reason, userId]);

  if (noAdmins) return null;

  return (
    <Button
      variant="primary"
      size="lg"
      className="w-full"
      onClick={handleRequest}
      disabled={sent || sending}
    >
      {sent ? (
        <span className="flex items-center gap-1">
          <Check className="w-[16px] h-[16px]" />
          {sentLabel}
        </span>
      ) : sending ? (
        <span className="animate-pulse-live">{label}</span>
      ) : (
        label
      )}
    </Button>
  );
}

// ─── Pricing Card (admin expired state) ──────────────────────────────────────

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
  // checkout leaves the lockout in place.
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
      {display.popular && (
        <div className="absolute -top-[12px] left-1/2 -translate-x-1/2">
          <span className="font-mono text-micro uppercase tracking-[0.2em] bg-ops-amber text-text-inverse px-1.5 py-0.5 rounded-sm">
            {t("locked.mostPopular")}
          </span>
        </div>
      )}

      <div className="flex items-center gap-1 mb-2">
        <div className={cn("p-1 rounded bg-fill-neutral-dim", display.accentClass)}>
          {display.icon}
        </div>
        <div>
          <h3 className="font-mohave text-body-lg text-text">{config.name}</h3>
        </div>
      </div>

      <div className="flex items-baseline gap-0.5 mb-2">
        <span className="font-mono text-[36px] leading-none text-text tracking-tight">
          ${config.price}
        </span>
        <span className="font-mohave text-body-sm text-text-3">/mo</span>
      </div>

      <div className={cn("inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-caption-sm font-mono mb-2 w-fit", display.badgeClass)}>
        {config.maxSeats} {t("locked.seatsIncluded")}
      </div>

      <ul className="flex flex-col gap-1 mb-3 flex-1">
        {config.features.map((feature) => (
          <li key={feature} className="flex items-start gap-1">
            <Check className={cn("w-[14px] h-[14px] mt-[2px] shrink-0", display.accentClass)} />
            <span className="font-mohave text-body-sm text-text-2">{feature}</span>
          </li>
        ))}
      </ul>

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

// ─── Admin Display ───────────────────────────────────────────────────────────

function AdminDisplay({
  admins,
}: {
  admins: { id: string; name: string }[];
}) {
  const { t } = useDictionary("auth");

  if (admins.length === 0) return null;

  const primaryAdmin = admins[0];
  const othersCount = admins.length - 1;

  return (
    <div className="flex items-center gap-1 mt-2 mb-3">
      <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-text-3">
        {t("lockout.adminLabel")}:
      </span>
      <span className="font-mohave text-body text-text font-medium">
        {primaryAdmin.name}
      </span>
      {othersCount > 0 && (
        <span className="font-mohave text-body-sm text-text-3">
          (+{othersCount} {t("lockout.adminOthers")})
        </span>
      )}
    </div>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function PageFooter({ sysMessageKey }: { sysMessageKey: string }) {
  const { t } = useDictionary("auth");
  return (
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
      <p className="font-mono text-micro text-text-mute tracking-wider mt-2 opacity-40">
        {t(sysMessageKey)}
      </p>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LockedPage() {
  const { t } = useDictionary("auth");
  const company = useAuthStore((s) => s.company);
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAdmin = useAuthStore(selectIsAdminOrOwner);

  const companyId = company?.id;
  const userId = currentUser?.id ?? null;
  const userName = currentUser
    ? [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") || "A team member"
    : "A team member";

  // Compute actual lockout reason. Returns null if not locked at all,
  // or "subscription_expired" / "unseated" otherwise.
  const lockoutReason = useMemo(
    () => getLockoutReason(company, userId),
    [company, userId]
  );

  const admins = useAdminNames(company?.adminIds);

  // Default state: no concrete reason yet (auth/company still loading, or no
  // lockout at all). Fall back to the expired-admin pricing layout — same as
  // the legacy behavior — so the page is never blank, but the heading is
  // generic and we don't claim a specific reason we haven't proven.
  const showAdminExpired =
    lockoutReason === "subscription_expired" && isAdmin;
  const showMemberExpired =
    lockoutReason === "subscription_expired" && !isAdmin;
  const showAdminUnseated = lockoutReason === "unseated" && isAdmin;
  const showMemberUnseated = lockoutReason === "unseated" && !isAdmin;
  const showFallbackPricing =
    !showAdminExpired &&
    !showMemberExpired &&
    !showAdminUnseated &&
    !showMemberUnseated;

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

      {/* Status icon — color depends on reason */}
      <div className="flex items-center gap-1 mb-2">
        <div
          className={cn(
            "p-1 rounded-full",
            lockoutReason === "unseated"
              ? "bg-ops-amber/15"
              : "bg-ops-error/15"
          )}
        >
          {showAdminUnseated && (
            <Users className="w-[24px] h-[24px] text-ops-amber" />
          )}
          {showMemberUnseated && (
            <UserX className="w-[24px] h-[24px] text-ops-amber" />
          )}
          {(showAdminExpired || showMemberExpired || showFallbackPricing) && (
            <ShieldOff className="w-[24px] h-[24px] text-ops-error" />
          )}
        </div>
      </div>

      {/* ── State A: Admin / Owner with expired subscription ── */}
      {(showAdminExpired || showFallbackPricing) && (
        <>
          <div className="text-center mb-1 max-w-[600px]">
            <h2 className="font-mohave text-display text-text mb-1">
              {t(
                showAdminExpired
                  ? "lockout.expiredAdmin.title"
                  : "locked.title"
              )}
            </h2>
            <p className="font-mohave text-body text-text-2 leading-relaxed">
              {t(
                showAdminExpired
                  ? "lockout.expiredAdmin.body"
                  : "locked.description"
              )}
            </p>
          </div>

          <div className="w-full max-w-[800px] flex items-center gap-2 my-3">
            <div className="flex-1 h-px bg-border" />
            <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-text-3">
              {t("locked.selectPlan")}
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 w-full max-w-[900px] mb-4">
            <PricingCard tier="starter" companyId={companyId} />
            <PricingCard tier="team" companyId={companyId} />
            <PricingCard tier="business" companyId={companyId} />
          </div>

          <PageFooter
            sysMessageKey={
              showAdminExpired
                ? "lockout.expiredAdmin.sysMessage"
                : "locked.sysMessage"
            }
          />
        </>
      )}

      {/* ── State B: Non-admin / non-owner with expired subscription ── */}
      {showMemberExpired && (
        <div className="w-full max-w-[520px] flex flex-col">
          <div className="text-center mb-1">
            <h2 className="font-mohave text-display text-text mb-1">
              {t("lockout.expiredMember.title")}
            </h2>
            <p className="font-mohave text-body text-text-2 leading-relaxed">
              {t("lockout.expiredMember.body")}
            </p>
          </div>

          <AdminDisplay admins={admins} />

          {userId && companyId && (
            <RequestButton
              label={t("lockout.expiredMember.requestReactivation")}
              sentLabel={t("lockout.expiredMember.requestSent")}
              userId={userId}
              adminIds={company?.adminIds ?? []}
              companyId={companyId}
              userName={userName}
              reason="subscription_expired"
            />
          )}

          <div className="mt-4">
            <PageFooter sysMessageKey="lockout.expiredMember.sysMessage" />
          </div>
        </div>
      )}

      {/* ── State C: Admin / Owner who is unseated ── */}
      {showAdminUnseated && (
        <div className="w-full max-w-[520px] flex flex-col">
          <div className="text-center mb-1">
            <h2 className="font-mohave text-display text-text mb-1">
              {t("lockout.unseatedAdmin.title")}
            </h2>
            <p className="font-mohave text-body text-text-2 leading-relaxed">
              {t("lockout.unseatedAdmin.body")}
            </p>
          </div>

          <a href="/team" className="block mt-3">
            <Button variant="primary" size="lg" className="w-full">
              {t("lockout.unseatedAdmin.manageTeam")}
            </Button>
          </a>

          <div className="mt-4">
            <PageFooter sysMessageKey="lockout.unseatedAdmin.sysMessage" />
          </div>
        </div>
      )}

      {/* ── State D: Non-admin who is unseated ── */}
      {showMemberUnseated && (
        <div className="w-full max-w-[520px] flex flex-col">
          <div className="text-center mb-1">
            <h2 className="font-mohave text-display text-text mb-1">
              {t("lockout.unseated.title")}
            </h2>
            <p className="font-mohave text-body text-text-2 leading-relaxed">
              {t("lockout.unseated.body")}
            </p>
          </div>

          <AdminDisplay admins={admins} />

          {userId && companyId && (
            <RequestButton
              label={t("lockout.unseated.requestAccess")}
              sentLabel={t("lockout.unseated.requestSent")}
              userId={userId}
              adminIds={company?.adminIds ?? []}
              companyId={companyId}
              userName={userName}
              reason="unseated"
            />
          )}

          <div className="mt-4">
            <PageFooter sysMessageKey="lockout.unseated.sysMessage" />
          </div>
        </div>
      )}
    </div>
  );
}
