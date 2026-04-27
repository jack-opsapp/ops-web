"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/config";
import { PasswordInput } from "./PasswordInput";
import { SuccessState } from "./SuccessState";
import { HandlerError, type ErrorKind } from "./HandlerError";
import { handlerCopy } from "./copy";
import { mapFirebaseError, type AuthErrorKind } from "./firebase-errors";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;
const NETWORK_TIMEOUT_MS = 10_000;

type State =
  | { kind: "checking" }
  | { kind: "form"; email: string; weakReason?: string }
  | { kind: "submitting"; email: string }
  | { kind: "success" }
  | { kind: "error"; error: ErrorKind; email?: string };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject({ code: "auth/network-request-failed" }),
        ms,
      ),
    ),
  ]);
}

function toErrorKind(kind: AuthErrorKind): ErrorKind {
  if (kind === "weakPassword") return "unknown";
  return kind;
}

interface ResetFlowProps {
  oobCode: string;
}

export function ResetFlow({ oobCode }: ResetFlowProps) {
  const [state, setState] = React.useState<State>({ kind: "checking" });
  const reduced = useReducedMotion();

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const auth = getFirebaseAuth();
        const email = await withTimeout(
          verifyPasswordResetCode(auth, oobCode),
          NETWORK_TIMEOUT_MS,
        );
        if (!cancelled) setState({ kind: "form", email });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            error: toErrorKind(mapFirebaseError(err)),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [oobCode]);

  const handleSubmit = React.useCallback(
    async (password: string) => {
      if (state.kind !== "form") return;
      const email = state.email;
      setState({ kind: "submitting", email });
      try {
        const auth = getFirebaseAuth();
        await withTimeout(
          confirmPasswordReset(auth, oobCode, password),
          NETWORK_TIMEOUT_MS,
        );
        setState({ kind: "success" });
      } catch (err) {
        const kind = mapFirebaseError(err);
        if (kind === "weakPassword") {
          setState({
            kind: "form",
            email,
            weakReason: handlerCopy.errors.weakPassword,
          });
          return;
        }
        setState({
          kind: "error",
          error: toErrorKind(kind),
          email,
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

  const fade = (delay = 0) =>
    reduced ? { duration: 0 } : { duration: 0.35, ease: EASE_SMOOTH, delay };

  if (state.kind === "checking") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={fade()}
      >
        <h1
          className="font-mohave text-text-primary mb-2"
          style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
        >
          {handlerCopy.reset.headlineForm}
        </h1>
        <p
          className="font-mono uppercase text-text-3 mt-4"
          style={{ fontSize: "10px", letterSpacing: "0.12em" }}
        >
          [{handlerCopy.reset.loadingCheck}...]
        </p>
      </motion.div>
    );
  }

  if (state.kind === "form" || state.kind === "submitting") {
    const weak = state.kind === "form" ? state.weakReason : undefined;
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={fade()}
      >
        <h1
          className="font-mohave text-text-primary mb-2"
          style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
        >
          {handlerCopy.reset.headlineForm}
        </h1>
        <div className="mb-6">
          <label
            className="font-mono uppercase text-text-3 block mb-1"
            style={{ fontSize: "10px", letterSpacing: "0.12em" }}
          >
            {handlerCopy.reset.accountLabel}
          </label>
          <p
            className="font-mohave text-text-2"
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
        {weak ? (
          <p
            role="alert"
            className="font-mono uppercase mt-3"
            style={{
              color: "#B58289",
              fontSize: "11px",
              letterSpacing: "0.12em",
            }}
          >
            [{weak}]
          </p>
        ) : null}
      </motion.div>
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
