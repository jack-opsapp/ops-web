"use client";

/**
 * OPS Web — Add-ons Section
 *
 * Two cards rendered below the plan list inside the Subscription tab:
 *   1. Data Setup (one-time payment add-on)
 *   2. Priority Support (recurring subscription add-on)
 *
 * Strict adherence to the spec v2 design system:
 *   - All tokens via Tailwind classes — NO hardcoded hex/spacing/radius
 *   - Glass-surface cards (rounded-panel)
 *   - Accent (`text-ops-accent`) used ONLY on the primary CTA
 *   - Cake Mono Light uppercase for titles + buttons + badges
 *   - JetBrains Mono for all numeric data with tabular-nums
 *   - Earth tones (olive/tan) for status pills only when carrying meaning
 *   - Tactical voice: `//` prefix on the section header, sentence-case body
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ArrowUpRight, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useAddOns,
  useAddOnPrices,
  type AddOnPriceMap,
  type DataSetupStatus,
} from "@/lib/hooks/use-addons";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPriceSlot(
  slot: AddOnPriceMap[keyof AddOnPriceMap],
  fallback: string
): string {
  if (!slot) return fallback;
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: slot.currency.toUpperCase(),
      maximumFractionDigits: slot.amount % 100 === 0 ? 0 : 2,
    });
    return formatter.format(slot.amount / 100);
  } catch {
    return `$${(slot.amount / 100).toFixed(slot.amount % 100 === 0 ? 0 : 2)}`;
  }
}

function formatScheduledDate(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({
  status,
}: {
  status: DataSetupStatus;
}) {
  const { t } = useDictionary("settings");

  const config: Record<
    DataSetupStatus,
    { label: string; tone: "neutral" | "olive" | "tan" }
  > = {
    pending: {
      label:
        t("addons.dataSetup.statusPending.pill") ?? "Pending",
      tone: "tan",
    },
    scheduled: {
      label:
        t("addons.dataSetup.statusScheduled.pill") ?? "Scheduled",
      tone: "tan",
    },
    in_progress: {
      label:
        t("addons.dataSetup.statusInProgress.pill") ?? "In progress",
      tone: "tan",
    },
    completed: {
      label:
        t("addons.dataSetup.statusCompleted.pill") ?? "Completed",
      tone: "olive",
    },
    cancelled: {
      label: "Cancelled",
      tone: "neutral",
    },
  };

  const { label, tone } = config[status];

  const toneClasses =
    tone === "olive"
      ? "text-olive bg-olive-soft border-olive-line"
      : tone === "tan"
      ? "text-tan bg-tan-soft border-tan-line"
      : "text-text-2 bg-[rgba(255,255,255,0.05)] border-line";

  return (
    <span
      className={cn(
        "inline-flex items-center px-1 py-[1px] rounded-chip",
        "font-mono text-micro uppercase tracking-wide",
        "border",
        toneClasses
      )}
    >
      {label}
    </span>
  );
}

// ─── Section badge ───────────────────────────────────────────────────────────

function AddonBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-[1px] rounded-chip",
        "font-cakemono font-light uppercase",
        "text-[10px] tracking-wider",
        "border border-line bg-[rgba(255,255,255,0.04)] text-text-3"
      )}
    >
      {children}
    </span>
  );
}

// ─── Data Setup card ─────────────────────────────────────────────────────────

function DataSetupCard({ prices }: { prices: AddOnPriceMap | undefined }) {
  const { t } = useDictionary("settings");
  const { dataSetup, purchaseDataSetup } = useAddOns();
  const [busy, setBusy] = useState(false);

  const priceFallback =
    t("addons.dataSetup.priceFallback") ?? "Contact us";
  const price = formatPriceSlot(prices?.dataSetup ?? null, priceFallback);

  async function handlePurchase() {
    setBusy(true);
    try {
      await purchaseDataSetup();
      // No toast on success — the page navigates to Stripe Checkout.
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      const failed =
        t("addons.toast.purchaseFailed") ?? "Couldn't start checkout";
      toast.error(failed, { description: message || undefined });
      setBusy(false);
    }
  }

  return (
    <article
      className={cn(
        "glass-surface rounded-panel p-3",
        "flex flex-col gap-2"
      )}
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <h4 className="font-cakemono font-light uppercase text-[15px] text-text leading-none">
            {t("addons.dataSetup.title") ?? "Data Setup"}
          </h4>
          <AddonBadge>
            {t("addons.dataSetup.badge") ?? "ONE-TIME"}
          </AddonBadge>
        </div>
        <div
          className={cn(
            "font-mono text-data-sm text-text",
            "tabular-nums tracking-tight whitespace-nowrap"
          )}
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {price}
        </div>
      </header>

      {/* Description */}
      <p className="font-mohave text-body-sm text-text-2 leading-snug">
        {t("addons.dataSetup.description") ??
          "We move your jobs, clients, and crew from the old software. You skip the data-entry weekend."}
      </p>

      {/* State surface */}
      {!dataSetup.purchased ? (
        <div className="pt-1">
          <Button
            variant="primary"
            size="sm"
            className="w-full gap-1.5"
            disabled={busy}
            onClick={handlePurchase}
          >
            {busy ? (
              <Loader2 className="w-[14px] h-[14px] animate-spin" />
            ) : (
              <ArrowUpRight className="w-[14px] h-[14px]" />
            )}
            {t("addons.dataSetup.purchase") ?? "Purchase"}
          </Button>
        </div>
      ) : (
        <div className="pt-1 space-y-1.5">
          <div className="flex items-center gap-1.5">
            {dataSetup.status && <StatusPill status={dataSetup.status} />}
          </div>
          <p className="font-mono text-micro text-text-3 leading-snug">
            {dataSetup.status === "scheduled" && dataSetup.scheduledAt
              ? (t("addons.dataSetup.statusScheduled.copy") ??
                "Migration set for {date}.").replace(
                  "{date}",
                  formatScheduledDate(dataSetup.scheduledAt)
                )
              : dataSetup.status === "completed"
              ? t("addons.dataSetup.statusCompleted.copy") ??
                "Your data is in. Welcome aboard."
              : dataSetup.status === "in_progress"
              ? t("addons.dataSetup.statusInProgress.copy") ??
                "Migration running now."
              : t("addons.dataSetup.statusPending.copy") ??
                "We'll be in touch within 24 hours to lock a date."}
          </p>
        </div>
      )}
    </article>
  );
}

// ─── Priority Support card ──────────────────────────────────────────────────

function PrioritySupportCard({ prices }: { prices: AddOnPriceMap | undefined }) {
  const { t } = useDictionary("settings");
  const { prioritySupport, purchasePrioritySupport } = useAddOns();
  const { company, currentUser } = useAuthStore();
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  const [busy, setBusy] = useState(false);

  const priceFallback = t("addons.prioritySupport.priceFallback") ?? "—";
  const monthly = formatPriceSlot(
    prices?.prioritySupportMonthly ?? null,
    priceFallback
  );
  const annual = formatPriceSlot(
    prices?.prioritySupportAnnual ?? null,
    priceFallback
  );

  async function handlePurchase() {
    setBusy(true);
    try {
      await purchasePrioritySupport(period);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      const failed =
        t("addons.toast.purchaseFailed") ?? "Couldn't start checkout";
      toast.error(failed, { description: message || undefined });
      setBusy(false);
    }
  }

  function handleContactSupport() {
    if (typeof window === "undefined") return;
    const userName =
      currentUser?.firstName && currentUser?.lastName
        ? `${currentUser.firstName} ${currentUser.lastName}`.trim()
        : currentUser?.email ?? "OPS user";
    const companyName = company?.name ?? "OPS company";
    const planLabel = `Priority Support (${period === "annual" ? "annual" : "monthly"})`;
    const currentPage = window.location.href;
    const subject = `[OPS Priority] ${companyName}`;
    const body =
      `Hi Jack,\n\n` +
      `From: ${userName}\n` +
      `Company: ${companyName}\n` +
      `Plan: ${planLabel}\n` +
      `Page: ${currentPage}\n\n` +
      `What I need:\n\n`;
    const url = `mailto:jack@opsapp.co?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
  }

  async function handleManageBilling() {
    if (!company) return;
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const token = await getIdToken();
      const res = await fetch("/api/stripe/billing-portal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ companyId: company.id }),
      });
      const json = (await res.json()) as { url?: string; message?: string };
      if (!res.ok || !json.url) {
        throw new Error(json.message ?? "Failed to open billing portal");
      }
      // Same-tab redirect; the portal posts back to /settings?tab=subscription.
      window.location.href = json.url;
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      toast.error("Couldn't open billing portal", {
        description: message || undefined,
      });
    }
  }

  return (
    <article
      className={cn(
        "glass-surface rounded-panel p-3",
        "flex flex-col gap-2"
      )}
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <h4 className="font-cakemono font-light uppercase text-[15px] text-text leading-none">
            {t("addons.prioritySupport.title") ?? "Priority Support"}
          </h4>
          <AddonBadge>
            {t("addons.prioritySupport.badge") ?? "MONTHLY / ANNUAL"}
          </AddonBadge>
        </div>
        <div
          className={cn(
            "font-mono text-data-sm text-text",
            "tabular-nums tracking-tight whitespace-nowrap"
          )}
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {period === "annual" ? annual : monthly}
          <span className="text-text-mute ml-0.5">
            {period === "annual" ? "/yr" : "/mo"}
          </span>
        </div>
      </header>

      {/* Description */}
      <p className="font-mohave text-body-sm text-text-2 leading-snug">
        {t("addons.prioritySupport.description") ??
          "Front of the line. The founder picks up your message first, every time."}
      </p>

      {/* Period toggle (only when not yet active) */}
      {!prioritySupport.active && (
        <div className="flex items-center gap-1 pt-0.5">
          {(["monthly", "annual"] as const).map((p) => {
            const isActive = period === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={cn(
                  "font-mono text-micro uppercase tracking-wider",
                  "px-1.5 py-[3px] rounded-chip border transition-colors duration-150",
                  isActive
                    ? "bg-surface-active text-text border-[rgba(255,255,255,0.18)]"
                    : "border-transparent text-text-3 hover:text-text-2"
                )}
              >
                {p === "annual"
                  ? t("addons.prioritySupport.toggleAnnual") ?? "Annual"
                  : t("addons.prioritySupport.toggleMonthly") ?? "Monthly"}
              </button>
            );
          })}
        </div>
      )}

      {/* Action surface */}
      {prioritySupport.active ? (
        <div className="pt-1 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center px-1 py-[1px] rounded-chip",
                "font-mono text-micro uppercase tracking-wide",
                "border text-olive bg-olive-soft border-olive-line"
              )}
            >
              {t("addons.prioritySupport.activePill") ?? "Active"}
            </span>
            <span className="font-mono text-micro text-text-3">
              {t("addons.prioritySupport.activeCopy") ??
                "Email us — we'll be on it."}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-1.5">
            <Button
              variant="primary"
              size="sm"
              className="w-full sm:flex-1 gap-1.5"
              onClick={handleContactSupport}
            >
              {t("addons.prioritySupport.contactCta") ??
                "Contact priority support"}
            </Button>
            <button
              type="button"
              onClick={handleManageBilling}
              className={cn(
                "font-mono text-micro uppercase tracking-wider",
                "text-text-2 hover:text-text",
                "inline-flex items-center justify-center gap-1 px-1.5 py-[6px]"
              )}
            >
              {t("addons.prioritySupport.manageCta") ??
                "Manage in billing portal"}
              <ExternalLink className="w-[12px] h-[12px]" />
            </button>
          </div>
        </div>
      ) : (
        <div className="pt-1">
          <Button
            variant="primary"
            size="sm"
            className="w-full gap-1.5"
            disabled={busy}
            onClick={handlePurchase}
          >
            {busy ? (
              <Loader2 className="w-[14px] h-[14px] animate-spin" />
            ) : (
              <ArrowUpRight className="w-[14px] h-[14px]" />
            )}
            {t("addons.prioritySupport.purchase") ?? "Purchase"}
          </Button>
        </div>
      )}
    </article>
  );
}

// ─── Toast feedback for ?addon=…&result=… search params ─────────────────────

function useAddonResultToasts() {
  const { t } = useDictionary("settings");
  const searchParams = useSearchParams();
  const router = useRouter();
  const { refetch } = useAddOns();

  useEffect(() => {
    const addon = searchParams.get("addon");
    const result = searchParams.get("result");
    if (!addon || !result) return;

    if (result === "success") {
      const which =
        addon === "data_setup"
          ? t("addons.dataSetup.title") ?? "Data Setup"
          : t("addons.prioritySupport.title") ?? "Priority Support";
      toast.success(`${which} purchased`, {
        description:
          addon === "data_setup"
            ? t("addons.dataSetup.statusPending.copy") ??
              "We'll be in touch within 24 hours to lock a date."
            : t("addons.prioritySupport.activeCopy") ??
              "Email us — we'll be on it.",
      });
      // Webhook will lag a couple seconds in dev; force a refetch so the
      // card flips state without waiting for the polling cadence.
      refetch();
    } else if (result === "cancelled") {
      toast("Checkout cancelled");
    }

    // Strip the query so a refresh doesn't replay the toast.
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.delete("addon");
    params.delete("result");
    params.delete("session_id");
    const next = params.toString();
    router.replace(`/settings${next ? `?${next}` : "?tab=subscription"}`, {
      scroll: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ─── Public component ───────────────────────────────────────────────────────

export function AddonsSection() {
  const { t } = useDictionary("settings");
  const { data: prices, isLoading: pricesLoading } = useAddOnPrices();
  useAddonResultToasts();

  return (
    <section className="space-y-2">
      {/* Tactical section header */}
      <div className="flex items-center gap-2">
        <span
          className="font-mono text-micro uppercase tracking-wider text-text-mute select-none"
          aria-hidden="true"
        >
          //
        </span>
        <h3 className="font-cakemono font-light uppercase text-[15px] text-text leading-none">
          {t("addons.section.title") ?? "Add-ons"}
        </h3>
      </div>
      <p className="font-mohave text-body-sm text-text-3 leading-snug">
        {t("addons.section.subtitle") ??
          "Bolt on extra horsepower without changing plans."}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1">
        <DataSetupCard prices={pricesLoading ? undefined : prices} />
        <PrioritySupportCard prices={pricesLoading ? undefined : prices} />
      </div>
    </section>
  );
}

export default AddonsSection;
