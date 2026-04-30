/**
 * OPS Web — Add-on Hooks
 *
 * Reads:
 *   - companies.has_priority_support           (entitlement)
 *   - companies.data_setup_purchased           (entitlement, one-time)
 *   - data_setup_requests latest row by company (status & schedule)
 *
 * Mutations:
 *   - purchaseDataSetup()
 *   - purchasePrioritySupport(period)
 *
 * Realtime: a Supabase channel subscribes to INSERT/UPDATE on
 * `data_setup_requests` filtered by company_id, and to UPDATE on the
 * `companies` row. Channel falls through silently if realtime is not
 * available — TanStack's 30s refetchInterval is the safety net.
 */
"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store/auth-store";
import { getSupabaseClient } from "@/lib/supabase/client";
import { requireSupabase } from "@/lib/supabase/helpers";
import type { OpsAddon } from "@/lib/stripe/subscription-mapping";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DataSetupStatus =
  | "pending"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface DataSetupState {
  purchased: boolean;
  status: DataSetupStatus | null;
  scheduledAt: Date | null;
}

export interface PrioritySupportState {
  active: boolean;
  /**
   * Billing cadence cached from Stripe in `companies.priority_support_period`,
   * written by the webhook on every `customer.subscription.*` event for a
   * priority-support price. NULL when the subscription is inactive.
   */
  period: "monthly" | "annual" | null;
}

export interface AddOnsState {
  dataSetup: DataSetupState;
  prioritySupport: PrioritySupportState;
  isLoading: boolean;
  refetch: () => void;
  purchaseDataSetup: () => Promise<void>;
  purchasePrioritySupport: (period: "monthly" | "annual") => Promise<void>;
}

// ─── Query keys ──────────────────────────────────────────────────────────────

export const addOnQueryKeys = {
  all: ["addons"] as const,
  state: (companyId: string) => ["addons", "state", companyId] as const,
  prices: () => ["addons", "prices"] as const,
};

// ─── Service ─────────────────────────────────────────────────────────────────

interface AddOnRawState {
  hasPrioritySupport: boolean;
  prioritySupportPeriod: "monthly" | "annual" | null;
  dataSetupPurchased: boolean;
  dataSetupCompleted: boolean;
  scheduledAt: Date | null;
  latestStatus: DataSetupStatus | null;
}

async function fetchAddOnState(companyId: string): Promise<AddOnRawState> {
  const supabase = requireSupabase();

  const [{ data: company, error: companyErr }, { data: latestRequest }] =
    await Promise.all([
      supabase
        .from("companies")
        .select(
          "has_priority_support, priority_support_period, data_setup_purchased, data_setup_completed, data_setup_scheduled"
        )
        .eq("id", companyId)
        .maybeSingle(),
      supabase
        .from("data_setup_requests")
        .select("status, scheduled_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (companyErr) throw companyErr;

  const hasPrioritySupport =
    (company?.has_priority_support as boolean | null) ?? false;
  const rawPeriod = company?.priority_support_period as string | null;
  const prioritySupportPeriod =
    rawPeriod === "monthly" || rawPeriod === "annual" ? rawPeriod : null;
  const dataSetupPurchased =
    (company?.data_setup_purchased as boolean | null) ?? false;
  const dataSetupCompleted =
    (company?.data_setup_completed as boolean | null) ?? false;

  const scheduledFromCompany = company?.data_setup_scheduled
    ? new Date(company.data_setup_scheduled as string)
    : null;
  const scheduledFromRequest = latestRequest?.scheduled_at
    ? new Date(latestRequest.scheduled_at as string)
    : null;

  // The request row is the operational source of truth; companies.* is the
  // entitlement summary written by the webhook. Prefer the request row's
  // schedule when available so the UI lights up the moment ops books a date.
  const scheduledAt = scheduledFromRequest ?? scheduledFromCompany;

  // Derive status: companies.data_setup_completed takes precedence for the
  // entitlement-level summary, otherwise use the latest request's status.
  let latestStatus: DataSetupStatus | null = null;
  if (dataSetupCompleted) {
    latestStatus = "completed";
  } else if (latestRequest?.status) {
    latestStatus = latestRequest.status as DataSetupStatus;
  } else if (dataSetupPurchased) {
    // Edge case: entitlement column flipped but no request row yet (webhook
    // didn't get the row in fast enough). Show pending; the request row is
    // guaranteed to land within seconds.
    latestStatus = "pending";
  }

  return {
    hasPrioritySupport,
    prioritySupportPeriod,
    dataSetupPurchased,
    dataSetupCompleted,
    scheduledAt,
    latestStatus,
  };
}

// ─── Mutations ───────────────────────────────────────────────────────────────

async function startDataSetupCheckout(): Promise<string> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const token = await getIdToken();
  const { company } = useAuthStore.getState();
  if (!company) throw new Error("No company in auth store");

  const res = await fetch("/api/stripe/addon/data-setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ companyId: company.id }),
  });

  const json = (await res.json()) as { url?: string; code?: string; message?: string };
  if (!res.ok || !json.url) {
    throw new Error(json.message ?? "Failed to start data setup checkout");
  }
  return json.url;
}

async function startPrioritySupportCheckout(
  period: "monthly" | "annual"
): Promise<string> {
  const { getIdToken } = await import("@/lib/firebase/auth");
  const token = await getIdToken();
  const { company } = useAuthStore.getState();
  if (!company) throw new Error("No company in auth store");

  const res = await fetch("/api/stripe/addon/priority-support", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ companyId: company.id, period }),
  });

  const json = (await res.json()) as { url?: string; code?: string; message?: string };
  if (!res.ok || !json.url) {
    throw new Error(json.message ?? "Failed to start priority support checkout");
  }
  return json.url;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAddOns(): AddOnsState {
  const company = useAuthStore((s) => s.company);
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: addOnQueryKeys.state(companyId),
    queryFn: () => fetchAddOnState(companyId),
    enabled: !!companyId,
    // Mirror the subscription-info polling cadence — short enough that the
    // UI catches webhook flips without waiting on realtime, long enough to
    // not hammer the DB.
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Realtime: invalidate on any company / data_setup_requests change.
  useEffect(() => {
    if (!companyId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`addons-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "data_setup_requests",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: addOnQueryKeys.state(companyId),
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "companies",
          filter: `id=eq.${companyId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: addOnQueryKeys.state(companyId),
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);

  const purchaseDataSetupMutation = useMutation({
    mutationFn: () => startDataSetupCheckout(),
    onSuccess: (url) => {
      // Hard navigate — Stripe Checkout requires the actual page transition
      // (we want the user's session, not a popup).
      if (typeof window !== "undefined") window.location.href = url;
    },
  });

  const purchasePrioritySupportMutation = useMutation({
    mutationFn: (period: "monthly" | "annual") =>
      startPrioritySupportCheckout(period),
    onSuccess: (url) => {
      if (typeof window !== "undefined") window.location.href = url;
    },
  });

  return useMemo<AddOnsState>(
    () => ({
      dataSetup: {
        purchased: data?.dataSetupPurchased ?? false,
        status: data?.latestStatus ?? null,
        scheduledAt: data?.scheduledAt ?? null,
      },
      prioritySupport: {
        active: data?.hasPrioritySupport ?? false,
        period: data?.prioritySupportPeriod ?? null,
      },
      isLoading,
      refetch: () => {
        refetch();
      },
      purchaseDataSetup: () =>
        purchaseDataSetupMutation.mutateAsync().then(() => undefined),
      purchasePrioritySupport: (period) =>
        purchasePrioritySupportMutation
          .mutateAsync(period)
          .then(() => undefined),
    }),
    [data, isLoading, refetch, purchaseDataSetupMutation, purchasePrioritySupportMutation]
  );
}

// ─── Prices hook ─────────────────────────────────────────────────────────────

export interface AddOnPriceMap {
  dataSetup: { amount: number; currency: string } | null;
  prioritySupportMonthly: { amount: number; currency: string } | null;
  prioritySupportAnnual: { amount: number; currency: string } | null;
}

/**
 * Fetches live unit prices from /api/stripe/addon/prices. Cached at the
 * server edge for 1h; on the client TanStack holds it for the session.
 * Failures bubble up as null on each slot so the UI can render the
 * "—" fallback per the spec.
 */
export function useAddOnPrices(): {
  data: AddOnPriceMap | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: addOnQueryKeys.prices(),
    queryFn: async () => {
      const res = await fetch("/api/stripe/addon/prices");
      if (!res.ok) {
        return {
          dataSetup: null,
          prioritySupportMonthly: null,
          prioritySupportAnnual: null,
        } satisfies AddOnPriceMap;
      }
      return (await res.json()) as AddOnPriceMap;
    },
    staleTime: 60 * 60 * 1000, // 1h
  });
  return { data, isLoading };
}

// Re-export for convenience
export type { OpsAddon };
