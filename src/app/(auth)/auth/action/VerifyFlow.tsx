"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { applyActionCode } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/config";
import { SuccessState } from "./SuccessState";
import { HandlerError, type ErrorKind } from "./HandlerError";
import { handlerCopy } from "./copy";
import { mapFirebaseError, type AuthErrorKind } from "./firebase-errors";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

type State =
  | { kind: "applying" }
  | { kind: "success" }
  | { kind: "error"; error: ErrorKind };

function toErrorKind(kind: AuthErrorKind): ErrorKind {
  if (kind === "weakPassword") return "unknown";
  return kind;
}

interface VerifyFlowProps {
  oobCode: string;
}

export function VerifyFlow({ oobCode }: VerifyFlowProps) {
  const [state, setState] = React.useState<State>({ kind: "applying" });
  const reduced = useReducedMotion();

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const auth = getFirebaseAuth();
        await applyActionCode(auth, oobCode);
        if (!cancelled) setState({ kind: "success" });
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

  if (state.kind === "applying") {
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
          {handlerCopy.verify.headlineLoading}
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

  if (state.kind === "success") {
    return (
      <SuccessState
        chip={handlerCopy.verify.successChip}
        headline={handlerCopy.verify.headlineSuccess}
        subline={handlerCopy.verify.sublineSuccess}
        from="email-verified"
      />
    );
  }

  return <HandlerError kind={state.error} />;
}
