"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { HandlerShell } from "./HandlerShell";
import { HandlerError } from "./HandlerError";
import { ResetFlow } from "./ResetFlow";
import { VerifyFlow } from "./VerifyFlow";
import { RecoverFlow } from "./RecoverFlow";
import { SignInFlow } from "./SignInFlow";

type Mode = "resetPassword" | "verifyEmail" | "recoverEmail" | "signIn";

const VALID_MODES = new Set<Mode>([
  "resetPassword",
  "verifyEmail",
  "recoverEmail",
  "signIn",
]);

function isMode(v: string | null): v is Mode {
  return v != null && VALID_MODES.has(v as Mode);
}

function AuthActionInner() {
  const searchParams = useSearchParams();
  const rawMode = searchParams.get("mode");
  const oobCode = searchParams.get("oobCode");

  if (!isMode(rawMode) || !oobCode) {
    return (
      <HandlerShell eyebrow="Broken link">
        <HandlerError kind="malformed" />
      </HandlerShell>
    );
  }

  const mode: Mode = rawMode;

  return (
    <HandlerShell
      eyebrow={
        mode === "resetPassword"
          ? "Secure password reset"
          : mode === "verifyEmail"
          ? "Email verification"
          : mode === "recoverEmail"
          ? "Email recovery"
          : "Secure sign-in"
      }
    >
      {mode === "resetPassword" && <ResetFlow oobCode={oobCode} />}
      {mode === "verifyEmail" && <VerifyFlow oobCode={oobCode} />}
      {mode === "recoverEmail" && <RecoverFlow oobCode={oobCode} />}
      {mode === "signIn" && (
        <SignInFlow
          oobCode={oobCode}
          continueUrl={searchParams.get("continueUrl") ?? undefined}
        />
      )}
    </HandlerShell>
  );
}

export default function AuthActionPage() {
  return (
    <React.Suspense
      fallback={
        <HandlerShell eyebrow="Loading">
          <p
            className="font-kosugi uppercase text-text-tertiary"
            style={{ fontSize: "10px", letterSpacing: "1.2px" }}
          >
            • • •
          </p>
        </HandlerShell>
      }
    >
      <AuthActionInner />
    </React.Suspense>
  );
}
