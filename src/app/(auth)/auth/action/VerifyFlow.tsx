"use client";

import * as React from "react";
import { applyActionCode } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/config";
import { SuccessState } from "./SuccessState";
import { HandlerError, type ErrorKind } from "./HandlerError";
import { handlerCopy } from "./copy";

type State =
  | { kind: "applying" }
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

interface VerifyFlowProps {
  oobCode: string;
}

export function VerifyFlow({ oobCode }: VerifyFlowProps) {
  const [state, setState] = React.useState<State>({ kind: "applying" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const auth = getFirebaseAuth();
        await applyActionCode(auth, oobCode);
        if (!cancelled) setState({ kind: "success" });
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

  if (state.kind === "applying") {
    return (
      <div>
        <h1
          className="font-mohave text-text-primary mb-2"
          style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
        >
          {handlerCopy.verify.headlineLoading}
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
        chip={handlerCopy.verify.successChip}
        headline={handlerCopy.verify.headlineSuccess}
        subline={handlerCopy.verify.sublineSuccess}
        from="email-verified"
      />
    );
  }

  return <HandlerError kind={state.error} />;
}
