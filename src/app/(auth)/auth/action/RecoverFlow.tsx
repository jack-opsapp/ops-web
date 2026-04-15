"use client";

import * as React from "react";
import { applyActionCode, checkActionCode } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/config";
import { SuccessState } from "./SuccessState";
import { HandlerError, type ErrorKind } from "./HandlerError";
import { handlerCopy } from "./copy";

type State =
  | { kind: "checking" }
  | { kind: "confirm"; oldEmail: string; newEmail: string }
  | { kind: "applying"; oldEmail: string }
  | { kind: "success"; oldEmail: string }
  | { kind: "error"; error: ErrorKind };

function mapFirebaseError(code?: string): ErrorKind {
  if (!code) return "unknown";
  if (code === "auth/expired-action-code") return "expired";
  if (code === "auth/invalid-action-code") return "alreadyUsed";
  if (code === "auth/user-disabled") return "userDisabled";
  if (code === "auth/network-request-failed") return "network";
  return "unknown";
}

interface RecoverFlowProps {
  oobCode: string;
}

export function RecoverFlow({ oobCode }: RecoverFlowProps) {
  const [state, setState] = React.useState<State>({ kind: "checking" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const auth = getFirebaseAuth();
        const info = await checkActionCode(auth, oobCode);
        // For recoverEmail mode:
        //  info.data.email         → email to revert TO (the original)
        //  info.data.previousEmail → email the account was changed FROM
        const oldEmail = info.data.email ?? "(unknown)";
        const newEmail = info.data.previousEmail ?? "(unknown)";
        if (!cancelled) setState({ kind: "confirm", oldEmail, newEmail });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (!cancelled)
          setState({ kind: "error", error: mapFirebaseError(code) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [oobCode]);

  const handleRevert = React.useCallback(async () => {
    if (state.kind !== "confirm") return;
    setState({ kind: "applying", oldEmail: state.oldEmail });
    try {
      const auth = getFirebaseAuth();
      await applyActionCode(auth, oobCode);
      setState({ kind: "success", oldEmail: state.oldEmail });
    } catch (err) {
      const code = (err as { code?: string }).code;
      setState({ kind: "error", error: mapFirebaseError(code) });
    }
  }, [oobCode, state]);

  const handleReset = React.useCallback(async () => {
    if (state.kind !== "success") return;
    try {
      await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: state.oldEmail }),
      });
    } finally {
      window.location.href = "/login?reset=sent";
    }
  }, [state]);

  if (state.kind === "checking") {
    return (
      <div>
        <h1
          className="font-mohave text-text-primary mb-2"
          style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
        >
          {handlerCopy.recover.headlineLoading}
        </h1>
        <p
          className="font-kosugi uppercase text-text-tertiary mt-4"
          style={{ fontSize: "10px", letterSpacing: "1.2px" }}
        >
          • • •
        </p>
      </div>
    );
  }

  if (state.kind === "confirm" || state.kind === "applying") {
    return (
      <div>
        <h1
          className="font-mohave text-text-primary mb-2"
          style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
        >
          {handlerCopy.recover.headlineForm}
        </h1>
        <p
          className="font-mohave text-text-secondary mb-6"
          style={{ fontSize: "15px", lineHeight: "22px" }}
        >
          {handlerCopy.recover.bodyInfo(
            state.oldEmail,
            state.kind === "confirm" ? state.newEmail : state.oldEmail,
          )}
        </p>
        <button
          type="button"
          onClick={handleRevert}
          disabled={state.kind === "applying"}
          className="w-full rounded-sm font-kosugi uppercase"
          style={{
            minHeight: "60px",
            background: "#597794",
            color: "#FFFFFF",
            fontSize: "13px",
            letterSpacing: "1.8px",
            border: "1px solid #597794",
            opacity: state.kind === "applying" ? 0.6 : 1,
          }}
        >
          {state.kind === "applying"
            ? "• • •"
            : `${handlerCopy.recover.submitCta} →`}
        </button>
      </div>
    );
  }

  if (state.kind === "success") {
    return (
      <SuccessState
        chip={handlerCopy.recover.successChip}
        headline={handlerCopy.recover.headlineSuccess}
        subline={handlerCopy.recover.sublineSuccess(state.oldEmail)}
        from="email-recovered"
        extraCta={{
          label: handlerCopy.recover.resetCta,
          href: `#reset-${state.oldEmail}`,
        }}
      />
    );
  }

  return <HandlerError kind={state.error} />;
}
