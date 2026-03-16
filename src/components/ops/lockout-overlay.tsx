"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ShieldOff, UserX, Check, Headphones, Zap, Crown, Building2, Users } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";
import { useAuthStore, selectIsAdminOrOwner } from "@/lib/store/auth-store";
import { requireSupabase } from "@/lib/supabase/helpers";
import {
  getLockoutReason,
  TIER_CONFIG,
  type LockoutReason,
  type SubscriptionTier,
} from "@/lib/subscription";
import {
  lockoutBackdropVariants,
  lockoutBackdropVariantsReduced,
  lockoutCardVariants,
  lockoutCardVariantsReduced,
} from "@/lib/utils/motion";

// ─── Constants ───────────────────────────────────────────────────────────────

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

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
  localStorage.setItem(getCooldownKey(userId), JSON.stringify({ timestamp: Date.now(), reason }));
}

// ─── Admin Name Hook ─────────────────────────────────────────────────────────

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

// ─── Realtime Company Listener ───────────────────────────────────────────────

function useRealtimeCompanyUpdates(companyId: string | undefined) {
  const setCompany = useAuthStore((s) => s.setCompany);

  useEffect(() => {
    if (!companyId) return;

    let channel: ReturnType<ReturnType<typeof requireSupabase>["channel"]> | null = null;

    try {
      const supabase = requireSupabase();
      channel = supabase
        .channel(`lockout-company-${companyId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "companies",
            filter: `id=eq.${companyId}`,
          },
          (payload) => {
            const row = payload.new as Record<string, unknown>;
            const currentCompany = useAuthStore.getState().company;
            if (!currentCompany) return;

            // Update all fields relevant to lockout evaluation
            const updatedCompany = {
              ...currentCompany,
              subscriptionStatus: row.subscription_status as typeof currentCompany.subscriptionStatus ?? currentCompany.subscriptionStatus,
              subscriptionPlan: row.subscription_plan as typeof currentCompany.subscriptionPlan ?? currentCompany.subscriptionPlan,
              trialEndDate: row.trial_end_date ? new Date(row.trial_end_date as string) : currentCompany.trialEndDate,
              maxSeats: (row.max_seats as number) ?? currentCompany.maxSeats,
              seatedEmployeeIds: (row.seated_employee_ids as string[]) ?? currentCompany.seatedEmployeeIds,
              adminIds: (row.admin_ids as string[]) ?? currentCompany.adminIds,
            };
            setCompany(updatedCompany);
          }
        )
        .subscribe();
    } catch {
      // Silently fail — realtime is a nicety, not a requirement
    }

    return () => {
      if (channel) {
        try {
          const supabase = requireSupabase();
          supabase.removeChannel(channel);
        } catch {
          // cleanup silently
        }
      }
    };
  }, [companyId, setCompany]);
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

  // If there are no admins to notify, don't show the button
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

// ─── Compact Pricing Card (Admin Expired State) ──────────────────────────────

const TIER_DISPLAY: Record<Exclude<SubscriptionTier, "trial">, {
  icon: React.ReactNode;
  accentClass: string;
  borderClass: string;
  badgeClass: string;
  popular?: boolean;
}> = {
  starter: {
    icon: <Zap className="w-[16px] h-[16px]" />,
    accentClass: "text-ops-accent",
    borderClass: "border-ops-accent/20 hover:border-ops-accent/40",
    badgeClass: "bg-ops-accent/10 text-ops-accent",
  },
  team: {
    icon: <Crown className="w-[16px] h-[16px]" />,
    accentClass: "text-ops-amber",
    borderClass: "border-ops-amber/30 hover:border-ops-amber/50",
    badgeClass: "bg-ops-amber/10 text-ops-amber",
    popular: true,
  },
  business: {
    icon: <Building2 className="w-[16px] h-[16px]" />,
    accentClass: "text-text-primary",
    borderClass: "border-border-medium hover:border-border-strong",
    badgeClass: "bg-text-primary/10 text-text-primary",
  },
};

function CompactPricingCard({ tier }: { tier: Exclude<SubscriptionTier, "trial"> }) {
  const { t } = useDictionary("auth");
  const config = TIER_CONFIG[tier];
  const display = TIER_DISPLAY[tier];
  const checkoutUrl = `/settings?tab=subscription&plan=${tier}`;

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-[4px] border bg-background-panel p-2.5 transition-all duration-200",
        display.borderClass,
        display.popular && "ring-1 ring-ops-amber/20"
      )}
    >
      {display.popular && (
        <div className="absolute -top-[10px] left-1/2 -translate-x-1/2">
          <span className="font-kosugi text-[9px] uppercase tracking-[0.2em] bg-ops-amber text-text-inverse px-1.5 py-0.5 rounded-sm whitespace-nowrap">
            {t("locked.mostPopular")}
          </span>
        </div>
      )}

      <div className="flex items-center gap-1 mb-1.5">
        <div className={cn("p-0.5 rounded bg-background-elevated", display.accentClass)}>
          {display.icon}
        </div>
        <h3 className="font-mohave text-body text-text-primary">{config.name}</h3>
      </div>

      <div className="flex items-baseline gap-0.5 mb-1.5">
        <span className="font-mono text-[28px] leading-none text-text-primary tracking-tight">
          ${config.price}
        </span>
        <span className="font-mohave text-caption-sm text-text-tertiary">/mo</span>
      </div>

      <div className={cn(
        "inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-mono mb-1.5 w-fit",
        display.badgeClass
      )}>
        {config.maxSeats} {t("locked.seatsIncluded")}
      </div>

      <ul className="flex flex-col gap-0.5 mb-2 flex-1">
        {config.features.slice(0, 3).map((feature) => (
          <li key={feature} className="flex items-start gap-0.5">
            <Check className={cn("w-[12px] h-[12px] mt-[2px] shrink-0", display.accentClass)} />
            <span className="font-mohave text-caption-sm text-text-secondary">{feature}</span>
          </li>
        ))}
      </ul>

      <a href={checkoutUrl} className="block">
        <Button
          variant={display.popular ? "accent" : "default"}
          size="sm"
          className="w-full"
        >
          {t("locked.subscribe")}
        </Button>
      </a>
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
      <span className="font-kosugi text-[11px] uppercase tracking-[0.15em] text-text-tertiary">
        {t("lockout.adminLabel")}:
      </span>
      <span className="font-mohave text-body text-text-primary font-medium">
        {primaryAdmin.name}
      </span>
      {othersCount > 0 && (
        <span className="font-mohave text-body-sm text-text-tertiary">
          (+{othersCount} {t("lockout.adminOthers")})
        </span>
      )}
    </div>
  );
}

// ─── Footer Links ────────────────────────────────────────────────────────────

function FooterLinks({ showDifferentAccount }: { showDifferentAccount?: boolean }) {
  const { t } = useDictionary("auth");

  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/[0.06]">
      <a
        href="mailto:support@opsapp.co"
        className="inline-flex items-center gap-0.5 font-mohave text-caption-sm text-ops-accent hover:text-ops-accent-hover underline underline-offset-4 transition-colors"
      >
        <Headphones className="w-[12px] h-[12px]" />
        {t("lockout.contactSupport")}
      </a>
      {showDifferentAccount && (
        <>
          <span className="text-text-disabled text-[10px]">|</span>
          <a
            href="/login"
            className="font-mohave text-caption-sm text-text-tertiary hover:text-text-secondary underline underline-offset-4 transition-colors"
          >
            {t("lockout.differentAccount")}
          </a>
        </>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/** Routes where the lockout overlay is suppressed for admins — they need access to fix the subscription. */
const LOCKOUT_EXEMPT_ROUTES = ["/settings"];

export function LockoutOverlay() {
  const { company, currentUser } = useAuthStore();
  const isAdmin = useAuthStore(selectIsAdminOrOwner);
  const { t } = useDictionary("auth");
  const prefersReducedMotion = useReducedMotion();
  const pathname = usePathname();

  const userId = currentUser?.id ?? null;
  const companyId = company?.id;
  const userName = currentUser
    ? [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") || "A team member"
    : "A team member";

  // Realtime listener for company changes
  useRealtimeCompanyUpdates(companyId);

  // Resolve admin display names
  const admins = useAdminNames(company?.adminIds);

  // Determine lockout reason
  const rawLockoutReason = useMemo(
    () => getLockoutReason(company, userId),
    [company, userId]
  );

  // Exempt admins on certain routes so they can fix the underlying issue:
  // - /settings: fix subscription (for subscription_expired)
  // - /team: manage seats (for unseated)
  const isExemptRoute = LOCKOUT_EXEMPT_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
  const isOnTeamPage = pathname === "/team" || pathname.startsWith("/team/");
  const lockoutReason = useMemo(() => {
    if (!rawLockoutReason) return null;
    // Admin on /settings with expired subscription → let them through to fix it
    if (isExemptRoute && isAdmin && rawLockoutReason === "subscription_expired") return null;
    // Admin on /team while unseated → let them through to add their seat
    if (isOnTeamPage && isAdmin && rawLockoutReason === "unseated") return null;
    return rawLockoutReason;
  }, [rawLockoutReason, isExemptRoute, isOnTeamPage, isAdmin]);

  // Pick animation variants based on reduced motion preference
  const backdropVariants = prefersReducedMotion
    ? lockoutBackdropVariantsReduced
    : lockoutBackdropVariants;
  const cardVariants = prefersReducedMotion
    ? lockoutCardVariantsReduced
    : lockoutCardVariants;

  return (
    <AnimatePresence>
      {lockoutReason && (
        <motion.div
          key="lockout-backdrop"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xl backdrop-saturate-150"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="lockout-heading"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <motion.div
            key="lockout-card"
            className="w-full max-w-[520px] mx-4 rounded-[4px] p-6 md:p-8 overflow-y-auto max-h-[90vh]"
            style={{
              background: "rgba(10, 10, 10, 0.70)",
              backdropFilter: "blur(20px) saturate(1.2)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* ── State 1: Subscription Expired — Admin ── */}
            {lockoutReason === "subscription_expired" && isAdmin && (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-full bg-ops-error/15">
                    <ShieldOff className="w-[20px] h-[20px] text-ops-error animate-pulse-live" />
                  </div>
                </div>

                <h2 id="lockout-heading" className="font-mohave text-display text-text-primary mb-1">
                  {t("lockout.expiredAdmin.title")}
                </h2>
                <p className="font-mohave text-body text-text-secondary leading-relaxed">
                  {t("lockout.expiredAdmin.body")}
                </p>

                {/* Divider */}
                <div className="flex items-center gap-2 my-4">
                  <div className="flex-1 h-px bg-white/[0.06]" />
                  <span className="font-kosugi text-[10px] uppercase tracking-[0.3em] text-text-tertiary">
                    {t("lockout.expiredAdmin.selectPlan")}
                  </span>
                  <div className="flex-1 h-px bg-white/[0.06]" />
                </div>

                {/* Compact pricing grid */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <CompactPricingCard tier="starter" />
                  <CompactPricingCard tier="team" />
                  <CompactPricingCard tier="business" />
                </div>

                <p className="font-mohave text-caption-sm text-text-tertiary mb-1">
                  {t("lockout.guarantee")}
                </p>

                <FooterLinks />

                <p className="font-mono text-[9px] text-text-disabled tracking-wider mt-2 opacity-40">
                  {t("lockout.expiredAdmin.sysMessage")}
                </p>
              </>
            )}

            {/* ── State 2: Subscription Expired — Non-Admin ── */}
            {lockoutReason === "subscription_expired" && !isAdmin && (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-full bg-ops-error/15">
                    <ShieldOff className="w-[20px] h-[20px] text-ops-error animate-pulse-live" />
                  </div>
                </div>

                <h2 id="lockout-heading" className="font-mohave text-display text-text-primary mb-1">
                  {t("lockout.expiredMember.title")}
                </h2>
                <p className="font-mohave text-body text-text-secondary leading-relaxed">
                  {t("lockout.expiredMember.body")}
                </p>

                <AdminDisplay admins={admins} />

                <RequestButton
                  label={t("lockout.expiredMember.requestReactivation")}
                  sentLabel={t("lockout.expiredMember.requestSent")}
                  userId={userId!}
                  adminIds={company?.adminIds ?? []}
                  companyId={companyId!}
                  userName={userName}
                  reason="subscription_expired"
                />

                <FooterLinks showDifferentAccount />

                <p className="font-mono text-[9px] text-text-disabled tracking-wider mt-2 opacity-40">
                  {t("lockout.expiredMember.sysMessage")}
                </p>
              </>
            )}

            {/* ── State 3: Unseated User — Admin/Owner (self-service) ── */}
            {lockoutReason === "unseated" && isAdmin && (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-full bg-ops-amber/15">
                    <Users className="w-[20px] h-[20px] text-ops-amber animate-pulse-live" />
                  </div>
                </div>

                <h2 id="lockout-heading" className="font-mohave text-display text-text-primary mb-1">
                  {t("lockout.unseatedAdmin.title")}
                </h2>
                <p className="font-mohave text-body text-text-secondary leading-relaxed">
                  {t("lockout.unseatedAdmin.body")}
                </p>

                <a href="/team" className="block mt-3">
                  <Button variant="primary" size="lg" className="w-full">
                    {t("lockout.unseatedAdmin.manageTeam")}
                  </Button>
                </a>

                <FooterLinks />

                <p className="font-mono text-[9px] text-text-disabled tracking-wider mt-2 opacity-40">
                  {t("lockout.unseatedAdmin.sysMessage")}
                </p>
              </>
            )}

            {/* ── State 4: Unseated User — Non-Admin ── */}
            {lockoutReason === "unseated" && !isAdmin && (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-full bg-ops-amber/15">
                    <UserX className="w-[20px] h-[20px] text-ops-amber animate-pulse-live" />
                  </div>
                </div>

                <h2 id="lockout-heading" className="font-mohave text-display text-text-primary mb-1">
                  {t("lockout.unseated.title")}
                </h2>
                <p className="font-mohave text-body text-text-secondary leading-relaxed">
                  {t("lockout.unseated.body")}
                </p>

                <AdminDisplay admins={admins} />

                <RequestButton
                  label={t("lockout.unseated.requestAccess")}
                  sentLabel={t("lockout.unseated.requestSent")}
                  userId={userId!}
                  adminIds={company?.adminIds ?? []}
                  companyId={companyId!}
                  userName={userName}
                  reason="unseated"
                />

                <FooterLinks showDifferentAccount />

                <p className="font-mono text-[9px] text-text-disabled tracking-wider mt-2 opacity-40">
                  {t("lockout.unseated.sysMessage")}
                </p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
