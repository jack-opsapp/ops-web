"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  applyActionCode,
  checkActionCode,
  sendPasswordResetEmail,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/config";
import { SuccessState } from "./SuccessState";
import { HandlerError, type ErrorKind } from "./HandlerError";
import { handlerCopy } from "./copy";
import { mapFirebaseError, type AuthErrorKind } from "./firebase-errors";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

type State =
  | { kind: "checking" }
  | { kind: "confirm"; oldEmail: string; newEmail: string }
  | { kind: "applying"; oldEmail: string }
  | { kind: "success"; oldEmail: string }
  | { kind: "error"; error: ErrorKind };

function toErrorKind(kind: AuthErrorKind): ErrorKind {
  if (kind === "weakPassword") return "unknown";
  return kind;
}

interface RecoverFlowProps {
  oobCode: string;
}

export function RecoverFlow({ oobCode }: RecoverFlowProps) {
  const [state, setState] = React.useState<State>({ kind: "checking" });
  const reduced = useReducedMotion();

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

  const handleRevert = React.useCallback(async () => {
    if (state.kind !== "confirm") return;
    setState({ kind: "applying", oldEmail: state.oldEmail });
    try {
      const auth = getFirebaseAuth();
      await applyActionCode(auth, oobCode);
      setState({ kind: "success", oldEmail: state.oldEmail });
    } catch (err) {
      setState({
        kind: "error",
        error: toErrorKind(mapFirebaseError(err)),
      });
    }
  }, [oobCode, state]);

  const handleReset = React.useCallback(async () => {
    if (state.kind !== "success") return;
    try {
      const auth = getFirebaseAuth();
      await sendPasswordResetEmail(auth, state.oldEmail);
    } finally {
      window.location.href = "/login?reset=sent";
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
          {handlerCopy.recover.headlineLoading}
        </h1>
        <p
          className="font-mono uppercase text-text-3 mt-4"
          style={{ fontSize: "10px", letterSpacing: "0.12em" }}
        >
          [working...]
        </p>
      </motion.div>
    );
  }

  if (state.kind === "confirm" || state.kind === "applying") {
    const newEmail =
      state.kind === "confirm" ? state.newEmail : state.oldEmail;
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
          {handlerCopy.recover.headlineForm}
        </h1>
        <p
          className="font-mohave text-text-2 mb-6"
          style={{ fontSize: "15px", lineHeight: "22px" }}
        >
          {handlerCopy.recover.bodyInfo(state.oldEmail, newEmail)}
        </p>
        <button
          type="button"
          onClick={handleRevert}
          disabled={state.kind === "applying"}
          className="w-full rounded font-cakemono font-light uppercase text-ops-accent border border-ops-accent transition-colors duration-200 hover:bg-ops-accent hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            minHeight: "60px",
            fontSize: "13px",
            letterSpacing: "0.16em",
          }}
        >
          {state.kind === "applying"
            ? "..."
            : `${handlerCopy.recover.submitCta} →`}
        </button>
      </motion.div>
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
          onClick: handleReset,
        }}
      />
    );
  }

  return <HandlerError kind={state.error} />;
}
