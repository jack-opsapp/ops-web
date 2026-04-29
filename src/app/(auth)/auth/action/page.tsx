"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { HandlerShell } from "./HandlerShell";
import { HandlerError } from "./HandlerError";
import { ResetFlow } from "./ResetFlow";
import { VerifyFlow } from "./VerifyFlow";
import { RecoverFlow } from "./RecoverFlow";
import { SignInFlow } from "./SignInFlow";
import { VerifyAndChangeEmailFlow } from "./VerifyAndChangeEmailFlow";

type Mode =
  | "resetPassword"
  | "verifyEmail"
  | "recoverEmail"
  | "signIn"
  | "verifyAndChangeEmail";

const VALID_MODES = new Set<Mode>([
  "resetPassword",
  "verifyEmail",
  "recoverEmail",
  "signIn",
  "verifyAndChangeEmail",
]);

function isMode(v: string | null): v is Mode {
  return v != null && VALID_MODES.has(v as Mode);
}

function eyebrowFor(mode: Mode): string {
  if (mode === "resetPassword") return "Secure password reset";
  if (mode === "verifyEmail") return "Email verification";
  if (mode === "recoverEmail") return "Email recovery";
  if (mode === "signIn") return "Secure sign-in";
  return "Email change confirmation";
}

function AuthActionInner() {
  const sp = useSearchParams();
  const rawMode = sp.get("mode");
  const oobCode = sp.get("oobCode");
  const continueUrl = sp.get("continueUrl") ?? undefined;

  if (!isMode(rawMode) || !oobCode) {
    return (
      <HandlerShell eyebrow="Broken link">
        <HandlerError kind="malformed" />
      </HandlerShell>
    );
  }
  const mode: Mode = rawMode;
  return (
    <HandlerShell eyebrow={eyebrowFor(mode)}>
      {mode === "resetPassword" && <ResetFlow oobCode={oobCode} />}
      {mode === "verifyEmail" && <VerifyFlow oobCode={oobCode} />}
      {mode === "recoverEmail" && <RecoverFlow oobCode={oobCode} />}
      {mode === "signIn" && (
        <SignInFlow oobCode={oobCode} continueUrl={continueUrl} />
      )}
      {mode === "verifyAndChangeEmail" && (
        <VerifyAndChangeEmailFlow oobCode={oobCode} />
      )}
    </HandlerShell>
  );
}

export default function AuthActionPage() {
  return (
    <Suspense
      fallback={
        <HandlerShell eyebrow="Loading">
          <div />
        </HandlerShell>
      }
    >
      <AuthActionInner />
    </Suspense>
  );
}
