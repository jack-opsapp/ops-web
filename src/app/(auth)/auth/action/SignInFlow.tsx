"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  isSignInWithEmailLink,
  signInWithEmailLink,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/config";
import { HandlerError, type ErrorKind } from "./HandlerError";
import { handlerCopy } from "./copy";
import { mapFirebaseError, type AuthErrorKind } from "./firebase-errors";
import { validateContinueUrl, isAllowDev } from "@/lib/auth/continue-url";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;
const EMAIL_STORAGE_KEY = "opsEmailForSignIn";

type State =
  | { kind: "signing-in" }
  | { kind: "success" }
  | { kind: "error"; error: ErrorKind };

function toErrorKind(kind: AuthErrorKind): ErrorKind {
  if (kind === "weakPassword") return "unknown";
  return kind;
}

interface SignInFlowProps {
  oobCode: string;
  continueUrl?: string;
}

export function SignInFlow({ continueUrl }: SignInFlowProps) {
  const [state, setState] = React.useState<State>({ kind: "signing-in" });
  const reduced = useReducedMotion();

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const auth = getFirebaseAuth();
        const url = window.location.href;
        if (!isSignInWithEmailLink(auth, url)) {
          if (!cancelled) setState({ kind: "error", error: "malformed" });
          return;
        }
        let email = window.localStorage.getItem(EMAIL_STORAGE_KEY) ?? "";
        if (!email) {
          const input = window.prompt(
            "Confirm the email we sent this link to:",
          );
          email = input?.trim() ?? "";
        }
        if (!email) {
          if (!cancelled) setState({ kind: "error", error: "malformed" });
          return;
        }
        await signInWithEmailLink(auth, email, url);
        try {
          window.localStorage.removeItem(EMAIL_STORAGE_KEY);
        } catch {
          // localStorage may be unavailable in some contexts; ignore.
        }
        const result = validateContinueUrl(continueUrl, {
          allowDev: isAllowDev(),
        });
        const next = result.ok && result.url ? result.url : "/dashboard";
        if (!cancelled) {
          window.location.href = next;
          setState({ kind: "success" });
        }
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
  }, [continueUrl]);

  if (state.kind === "signing-in" || state.kind === "success") {
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
          {handlerCopy.signIn.headlineLoading}
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

  return <HandlerError kind={state.error} />;
}
