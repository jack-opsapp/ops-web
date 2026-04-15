"use client";

import * as React from "react";
import {
  isSignInWithEmailLink,
  signInWithEmailLink,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/config";
import { SuccessState } from "./SuccessState";
import { HandlerError, type ErrorKind } from "./HandlerError";
import { handlerCopy } from "./copy";

type State =
  | { kind: "signing-in" }
  | { kind: "success" }
  | { kind: "error"; error: ErrorKind };

function mapFirebaseError(code?: string): ErrorKind {
  if (!code) return "unknown";
  if (code === "auth/expired-action-code") return "expired";
  if (code === "auth/invalid-action-code") return "alreadyUsed";
  if (code === "auth/user-disabled") return "userDisabled";
  if (code === "auth/network-request-failed") return "network";
  return "unknown";
}

interface SignInFlowProps {
  oobCode: string;
  continueUrl?: string;
}

export function SignInFlow({}: SignInFlowProps) {
  // Email-link sign-in is NOT currently enabled in OPS Firebase Auth config.
  // This component is here so the handler page supports the mode if it's
  // ever turned on. Today it falls through to a clean "link broken" state.
  const [state, setState] = React.useState<State>({ kind: "signing-in" });

  React.useEffect(() => {
    (async () => {
      try {
        const auth = getFirebaseAuth();
        const url = window.location.href;
        if (!isSignInWithEmailLink(auth, url)) {
          setState({ kind: "error", error: "malformed" });
          return;
        }
        let email = window.sessionStorage.getItem("emailForSignIn") ?? "";
        if (!email) {
          const input = window.prompt(
            "Confirm the email we sent this link to:",
          );
          email = input?.trim() ?? "";
        }
        if (!email) {
          setState({ kind: "error", error: "malformed" });
          return;
        }
        await signInWithEmailLink(auth, email, url);
        window.sessionStorage.removeItem("emailForSignIn");
        setState({ kind: "success" });
      } catch (err) {
        const code = (err as { code?: string }).code;
        setState({ kind: "error", error: mapFirebaseError(code) });
      }
    })();
  }, []);

  if (state.kind === "signing-in") {
    return (
      <div>
        <h1
          className="font-mohave text-text-primary mb-2"
          style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
        >
          {handlerCopy.signIn.headlineLoading}
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

  if (state.kind === "success") {
    return (
      <SuccessState
        chip={handlerCopy.signIn.successChip}
        headline={handlerCopy.signIn.headlineSuccess}
        subline="Heading to OPS."
        from="email-link-signin"
      />
    );
  }

  return <HandlerError kind={state.error} />;
}
