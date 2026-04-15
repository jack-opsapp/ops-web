"use client";

import * as React from "react";
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/config";
import { PasswordInput } from "./PasswordInput";
import { SuccessState } from "./SuccessState";
import { HandlerError, type ErrorKind } from "./HandlerError";
import { handlerCopy } from "./copy";

type State =
  | { kind: "checking" }
  | { kind: "form"; email: string }
  | { kind: "submitting"; email: string }
  | { kind: "success" }
  | { kind: "error"; error: ErrorKind; email?: string };

function mapFirebaseError(code?: string): ErrorKind {
  if (!code) return "unknown";
  if (code === "auth/expired-action-code") return "expired";
  if (code === "auth/invalid-action-code") return "alreadyUsed";
  if (code === "auth/user-disabled") return "userDisabled";
  if (code === "auth/network-request-failed") return "network";
  return "unknown";
}

interface ResetFlowProps {
  oobCode: string;
}

export function ResetFlow({ oobCode }: ResetFlowProps) {
  const [state, setState] = React.useState<State>({ kind: "checking" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const auth = getFirebaseAuth();
        const email = await verifyPasswordResetCode(auth, oobCode);
        if (!cancelled) setState({ kind: "form", email });
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

  const handleSubmit = React.useCallback(
    async (password: string) => {
      if (state.kind !== "form") return;
      setState({ kind: "submitting", email: state.email });
      try {
        const auth = getFirebaseAuth();
        await confirmPasswordReset(auth, oobCode, password);
        setState({ kind: "success" });
      } catch (err) {
        const code = (err as { code?: string }).code;
        setState({
          kind: "error",
          error: mapFirebaseError(code),
          email: state.email,
        });
      }
    },
    [oobCode, state],
  );

  const handleRequestNew = React.useCallback(async () => {
    const email = (state.kind === "error" && state.email) || undefined;
    if (!email) {
      window.location.href = "/login?forgot=1";
      return;
    }
    try {
      await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      window.location.href = "/login?reset=sent";
    } catch {
      window.location.href = "/login?forgot=1";
    }
  }, [state]);

  if (state.kind === "checking") {
    return (
      <div>
        <h1
          className="font-mohave text-text-primary mb-2"
          style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
        >
          {handlerCopy.reset.headlineForm}
        </h1>
        <p
          className="font-kosugi uppercase text-text-tertiary mt-4"
          style={{ fontSize: "10px", letterSpacing: "1.2px" }}
        >
          {handlerCopy.reset.loadingCheck} • • •
        </p>
      </div>
    );
  }

  if (state.kind === "form" || state.kind === "submitting") {
    return (
      <div>
        <h1
          className="font-mohave text-text-primary mb-2"
          style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
        >
          {handlerCopy.reset.headlineForm}
        </h1>
        <div className="mb-6">
          <label
            className="font-kosugi uppercase text-text-tertiary block"
            style={{ fontSize: "10px", letterSpacing: "1.2px" }}
          >
            {handlerCopy.reset.accountLabel}
          </label>
          <p
            className="font-mohave text-text-secondary"
            style={{ fontSize: "14px", lineHeight: "20px" }}
          >
            {state.email}
          </p>
        </div>
        <PasswordInput
          onSubmit={handleSubmit}
          submitting={state.kind === "submitting"}
          loadingLabel={handlerCopy.reset.loadingSubmit}
        />
      </div>
    );
  }

  if (state.kind === "success") {
    return (
      <SuccessState
        chip={handlerCopy.reset.successChip}
        headline={handlerCopy.reset.successHeadline}
        subline={handlerCopy.reset.successSubline}
        from="password-reset"
      />
    );
  }

  return <HandlerError kind={state.error} onPrimary={handleRequestNew} />;
}
