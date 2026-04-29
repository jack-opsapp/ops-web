"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { applyActionCode, checkActionCode } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/config";
import { handlerCopy } from "./copy";
import { SuccessState } from "./SuccessState";
import { HandlerError, type ErrorKind } from "./HandlerError";
import { mapFirebaseError, type AuthErrorKind } from "./firebase-errors";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

type State =
  | { kind: "checking" }
  | { kind: "applying"; newEmail: string }
  | { kind: "success"; newEmail: string }
  | { kind: "error"; error: ErrorKind };

function toErrorKind(kind: AuthErrorKind): ErrorKind {
  if (kind === "weakPassword") return "unknown";
  return kind;
}

interface VerifyAndChangeEmailFlowProps {
  oobCode: string;
}

export function VerifyAndChangeEmailFlow({
  oobCode,
}: VerifyAndChangeEmailFlowProps) {
  const [state, setState] = React.useState<State>({ kind: "checking" });
  const reduced = useReducedMotion();
  const copy = handlerCopy.verifyAndChangeEmail;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const auth = getFirebaseAuth();
        const info = await checkActionCode(auth, oobCode);
        const newEmail = info.data.email ?? "your new email";
        if (cancelled) return;
        setState({ kind: "applying", newEmail });
        await applyActionCode(auth, oobCode);
        if (cancelled) return;
        setState({ kind: "success", newEmail });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          error: toErrorKind(mapFirebaseError(err)),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [oobCode]);

  if (state.kind === "checking" || state.kind === "applying") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          reduced
            ? { duration: 0 }
            : { duration: 0.35, ease: EASE_SMOOTH }
        }
      >
        <h1
          className="font-mohave text-text-primary mb-2"
          style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
        >
          {copy.headlineLoading}
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

  if (state.kind === "error") {
    return <HandlerError kind={state.error} />;
  }

  return (
    <SuccessState
      chip={copy.successChip}
      headline={copy.headlineSuccess}
      subline={copy.sublineSuccess(state.newEmail)}
      from="email-verified"
    />
  );
}
