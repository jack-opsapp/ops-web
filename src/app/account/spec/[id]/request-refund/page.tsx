/**
 * /account/spec/[id]/request-refund — Phase 1 customer Guarantee Refund request route.
 *
 * Server component. Verifies auth via cookie (Firebase / Supabase), loads the
 * spec_projects row with the service-role client, and authorizes the caller
 * against buyer_user_id OR account_holder_user_id. Non-members get a 404 to
 * avoid existence disclosure.
 *
 * Eligibility (active/expired/no-walkthrough/terminal/disputed) is computed
 * server-side and rendered as read-only context — the customer cannot
 * influence it. The form posts to /api/account/spec/[id]/request-refund
 * which recomputes eligibility before insert.
 *
 * Bible: 04_CUSTOMER_UX.md § /account/spec/[id]/request-refund,
 *        07_ROLLOUT.md § 9A.
 */

import { notFound, redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { computeRefundEligibility } from "@/lib/spec/refund-eligibility";
import { RefundRequestForm } from "./_components/refund-request-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Refund request — OPS SPEC",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

async function resolveCallerUserId(): Promise<{
  userId: string;
  email?: string;
} | null> {
  const cookieStore = await cookies();
  const headersList = await headers();

  const token =
    headersList.get("authorization")?.replace("Bearer ", "") ||
    cookieStore.get("__session")?.value ||
    cookieStore.get("ops-auth-token")?.value;

  if (!token) return null;

  let verified;
  try {
    verified = await verifyAuthToken(token);
  } catch {
    return null;
  }

  const user = (await findUserByAuth(
    verified.uid,
    verified.email,
    "id"
  )) as { id?: string } | null;

  if (!user?.id) return null;
  return { userId: user.id, email: verified.email };
}

export default async function RequestRefundPage({ params }: PageProps) {
  const { id } = await params;

  const caller = await resolveCallerUserId();
  if (!caller) {
    redirect(`/login?returnTo=/account/spec/${id}/request-refund`);
  }

  const db = getServiceRoleClient();
  const { data: project } = await db
    .from("spec_projects")
    .select(
      "id, tier, status, buyer_user_id, account_holder_user_id, customer_name, customer_email, walkthrough_completed_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (
    !project ||
    (project.buyer_user_id !== caller.userId &&
      project.account_holder_user_id !== caller.userId)
  ) {
    notFound();
  }

  // Active dispute check: any spec_payments row in 'disputed' status forfeits
  // the Guarantee window per 01_BUSINESS_MODEL.md § 3 and the dispute handler
  // in 07_ROLLOUT.md § 5.
  const { data: disputedPayments } = await db
    .from("spec_payments")
    .select("id")
    .eq("spec_project_id", id)
    .eq("status", "disputed")
    .limit(1);

  // An existing pending/processed/partial guarantee invocation blocks a new
  // one (mirror of the partial-unique index spec_refund_one_guarantee_per_project_idx).
  const { data: existingGuarantee } = await db
    .from("spec_refund_requests")
    .select("id")
    .eq("spec_project_id", id)
    .eq("is_guarantee_invocation", true)
    .in("status", ["pending", "processed", "partial"])
    .limit(1);

  const eligibility = computeRefundEligibility({
    walkthroughCompletedAt: project.walkthrough_completed_at,
    status: project.status,
    hasActiveDispute: (disputedPayments?.length ?? 0) > 0,
    now: new Date(),
  });

  const hasOpenGuarantee = (existingGuarantee?.length ?? 0) > 0;

  return (
    <main className="mx-auto max-w-[640px] px-6 py-16">
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-mute">
          {"// REFUND REQUEST"}
        </p>
        <h1 className="mt-3 font-cakemono font-light text-[28px] uppercase tracking-[0.04em] text-text">
          {project.tier.toUpperCase()} engagement
        </h1>
        <p className="mt-2 font-mohave font-light text-[15px] text-text-2">
          {project.customer_name ?? project.customer_email}
        </p>
      </header>

      <section className="glass-surface px-5 py-4 mb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-3 mb-3">
          {"// ELIGIBILITY"}
        </p>
        <EligibilityContext
          windowState={eligibility.windowState}
          windowClosesAt={eligibility.windowClosesAt}
          walkthroughCompletedAt={project.walkthrough_completed_at}
          isGuaranteeInvocation={eligibility.isGuaranteeInvocation}
          hasOpenGuarantee={hasOpenGuarantee}
        />
      </section>

      <RefundRequestForm
        projectId={project.id}
        backHref={`/account/spec/${project.id}`}
        hasOpenGuarantee={hasOpenGuarantee}
      />

      <p className="mt-10 font-mohave font-light text-[12px] leading-relaxed text-text-3 max-w-[520px]">
        Your request is reviewed by Jackson within 1 business day. The
        Guarantee Refund applies within 30 days of your delivery walkthrough.
        Outside that window, requests are reviewed at our discretion. Refund
        exclusions: chargeback or fraud, material misrepresentation, prohibited
        workflow, material breach, continued use of delivered modules after a
        refund, and time periods when SPEC was disabled for non-payment.
      </p>
    </main>
  );
}

function EligibilityContext({
  windowState,
  windowClosesAt,
  walkthroughCompletedAt,
  isGuaranteeInvocation,
  hasOpenGuarantee,
}: {
  windowState:
    | "active"
    | "expired"
    | "no_walkthrough"
    | "terminal"
    | "disputed";
  windowClosesAt: string | null;
  walkthroughCompletedAt: string | null;
  isGuaranteeInvocation: boolean;
  hasOpenGuarantee: boolean;
}) {
  const fmt = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  };

  const stateLabel: Record<typeof windowState, string> = {
    active: "GUARANTEE ACTIVE",
    expired: "GUARANTEE EXPIRED",
    no_walkthrough: "PRE-WALKTHROUGH",
    terminal: "ENGAGEMENT CLOSED",
    disputed: "DISPUTE OPEN",
  };

  const stateDescription: Record<typeof windowState, string> = {
    active:
      "You are within the 30-day window from your delivery walkthrough. A submitted request invokes the Guarantee Refund.",
    expired:
      "The 30-day Guarantee window has closed. We will review your request at our discretion as a goodwill case.",
    no_walkthrough:
      "Your delivery walkthrough has not been recorded yet. The 30-day Guarantee window starts when it does. Requests filed now are reviewed at our discretion.",
    terminal:
      "This engagement is already closed. Reach out directly if you believe this is in error.",
    disputed:
      "A payment dispute is open on this engagement. The Guarantee window is paused until the dispute resolves. Reach out directly.",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-cakemono font-light text-[14px] uppercase tracking-[0.08em] text-text">
          {stateLabel[windowState]}
        </span>
        {windowClosesAt && (
          <span className="font-mono text-[11px] tabular-nums text-text-2">
            CLOSES {fmt(windowClosesAt)}
          </span>
        )}
      </div>
      <p className="font-mohave font-light text-[13px] leading-relaxed text-text-2">
        {stateDescription[windowState]}
      </p>
      {walkthroughCompletedAt && (
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-3">
          [walkthrough delivered {fmt(walkthroughCompletedAt)}]
        </p>
      )}
      {hasOpenGuarantee && (
        <p className="mt-2 font-mono text-[11px] tracking-wide text-ops-amber">
          [a Guarantee refund request is already open for this engagement]
        </p>
      )}
      {isGuaranteeInvocation && !hasOpenGuarantee && (
        <p className="mt-2 font-mono text-[11px] tracking-wide text-ops-accent">
          [request will be filed as a Guarantee invocation]
        </p>
      )}
      {!isGuaranteeInvocation &&
        windowState !== "terminal" &&
        windowState !== "disputed" && (
          <p className="mt-2 font-mono text-[11px] tracking-wide text-text-3">
            [request will be filed as a goodwill case]
          </p>
        )}
    </div>
  );
}
