"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCustomerHosted } from "./customer-context";
import {
  fetchCustomerMe,
  membershipView,
  signOutCustomer,
  type CustomerMe,
  type MembershipView,
} from "./customer-api";
import { fillCopy } from "@/lib/customer-identity/hosted-format";

type State =
  | { kind: "loading" }
  | { kind: "ready"; me: CustomerMe; view: MembershipView }
  /** The broker no longer knows this business (404): same page as an unknown link. */
  | { kind: "gone" }
  | { kind: "error" };

/**
 * P1 placeholder for the signed-in landing. Reads `/api/customer/me` and
 * renders the customer's reality for THIS company: full history, forward-only
 * (new activity only, until the business confirms), or nothing linked yet.
 * P3 replaces this with the rebuilt portal.
 */
export function HomePlaceholder() {
  const { handle, companyName, copy } = useCustomerHosted();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const signInPath = `/c/${handle}/signin`;

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const outcome = await fetchCustomerMe(handle);
    if (outcome.ok) {
      setState({
        kind: "ready",
        me: outcome.me,
        view: membershipView(outcome.me.membership.state),
      });
      return;
    }
    if (outcome.kind === "unauthenticated") {
      router.replace(signInPath);
      return;
    }
    if (outcome.kind === "unknown_handle") {
      setState({ kind: "gone" });
      return;
    }
    setState({ kind: "error" });
  }, [handle, router, signInPath]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    const outcome = await signOutCustomer(handle);
    if (outcome.ok) {
      router.replace(signInPath);
      return;
    }
    setSigningOut(false);
    setSignOutError(
      outcome.kind === "offline" ? copy["error.offline"] : copy["home.signOutFailed"]
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <div className="flex flex-col gap-0.5">
          <span className="cs-skeleton h-1.5 w-1/4 rounded-chip animate-pulse" />
          <span className="cs-skeleton h-2 w-1/2 rounded-chip animate-pulse" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="cs-skeleton h-3 w-5/12 rounded-chip animate-pulse" />
          <span className="cs-skeleton h-2 w-full rounded-chip animate-pulse" />
          <span className="cs-skeleton h-2 w-2/3 rounded-chip animate-pulse" />
        </div>
      </div>
    );
  }

  if (state.kind === "gone") {
    return (
      <div className="cs-fade-enter flex flex-col gap-1" data-membership-view="gone">
        <h1 className="font-cakemono font-light text-cake-display uppercase tracking-widest cs-text leading-none">
          {copy["notFound.title"]}
        </h1>
        <p className="font-mohave text-body cs-text-2">{copy["notFound.body"]}</p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="cs-fade-enter flex flex-col gap-2">
        <p role="alert" className="font-mohave text-body cs-error">
          {copy["home.loadError"]}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="cs-secondary h-control-36 self-start rounded px-2 font-cakemono font-light text-cake-button uppercase tracking-widest"
        >
          {copy["home.retry"]}
        </button>
      </div>
    );
  }

  const { me, view } = state;
  const title =
    view === "full"
      ? copy["home.full.title"]
      : view === "forward_only"
        ? copy["home.forward.title"]
        : copy["home.none.title"];
  const body = fillCopy(
    view === "full"
      ? copy["home.full.body"]
      : view === "forward_only"
        ? copy["home.forward.body"]
        : copy["home.none.body"],
    { company: companyName }
  );

  return (
    <div className="cs-step-enter flex flex-col gap-3" data-membership-view={view}>
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-micro uppercase tracking-widest cs-text-2">
          {copy["home.signedInAs"]}
        </span>
        {me.displayName ? (
          <span className="font-mohave text-body cs-text">{me.displayName}</span>
        ) : null}
        <span className="font-mono text-data-sm cs-text-2">{me.maskedEmail || "—"}</span>
      </div>

      <div className="border-t cs-line pt-3 flex flex-col gap-1">
        <h1 className="font-cakemono font-light text-cake-display uppercase tracking-widest cs-text leading-none">
          {title}
        </h1>
        <p className="font-mohave text-body cs-text-2">{body}</p>
      </div>

      <div className="flex flex-col gap-1 pt-1">
        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          className="cs-secondary h-control-36 self-start rounded px-2 font-cakemono font-light text-cake-button uppercase tracking-widest"
        >
          {signingOut ? copy["home.signingOut"] : copy["home.signOut"]}
        </button>
        {signOutError ? (
          <p role="alert" className="cs-fade-enter font-mohave text-body-sm cs-error">
            {signOutError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
