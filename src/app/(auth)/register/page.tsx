"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OpsLockup } from "@/components/brand";
import { Eye, EyeOff, Mail, Lock, User, Loader2 } from "lucide-react";
import {
  signInWithGoogle,
  signInWithApple,
  signUpWithEmail,
  consumeRedirectContext,
  peekRedirectContext,
} from "@/lib/firebase/auth";
import { UserService } from "@/lib/api/services/user-service";
import { useAuthStore } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trackSignUp } from "@/lib/analytics/analytics";
import { useDictionary } from "@/i18n/client";
import { JoinTeamPrompt } from "@/components/auth/join-team-prompt";

export default function RegisterPage() {
  const { t } = useDictionary("auth");
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isLoadingApple, setIsLoadingApple] = useState(false);

  const anyLoading = isLoadingEmail || isLoadingGoogle || isLoadingApple;

  const currentUser = useAuthStore((s) => s.currentUser);
  const isLoadingAuth = useAuthStore((s) => s.isLoading);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // ── OAuth return detection ────────────────────────────────────────────────
  // After Google/Apple redirect returns, AuthProvider runs syncUser and only
  // then does the effect below fire `router.push`. Without this flag we'd
  // render the pre-auth form during that 1–2s window. Peek (not consume) so
  // the existing effect still owns the single consume + route transition.
  const [isReturningFromOAuth, setIsReturningFromOAuth] = useState(false);
  useEffect(() => {
    const ctx = peekRedirectContext();
    if (ctx?.origin === "register") setIsReturningFromOAuth(true);
  }, []);

  // Escape hatch for stale context: if AuthProvider has finished its initial
  // check and there's no Firebase user, the peek was reading a ctx left by an
  // abandoned OAuth. AuthProvider clears the ctx on its side; we clear our
  // local flag so the form renders instead of the spinner.
  useEffect(() => {
    if (!isLoadingAuth && !isAuthenticated) {
      setIsReturningFromOAuth(false);
    }
  }, [isLoadingAuth, isAuthenticated]);

  // When the user returns from a Google/Apple redirect that originated here,
  // AuthProvider has already synced them and populated the store. Run the
  // sign-up side-effects (analytics + route-to-account-type) now.
  useEffect(() => {
    if (!currentUser) return;
    const ctx = consumeRedirectContext();
    if (!ctx || ctx.origin !== "register") return;

    trackSignUp(ctx.provider);
    router.push("/account-type");
  }, [currentUser, router]);

  async function handleGoogleSignIn() {
    setError(null);
    setIsLoadingGoogle(true);
    try {
      await signInWithGoogle({ origin: "register", provider: "google" });
      // Production (redirect): unreachable — browser navigated before resolve.
      // Development (popup): resolved on success; stay in loading state until
      // the consume-effect fires on currentUser and routes away.
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      // Dev popup cancellation — silent reset, no error UI.
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        setIsLoadingGoogle(false);
        return;
      }
      const message = code === "auth/popup-blocked"
        ? t("register.popupBlocked")
        : err instanceof Error ? err.message : t("register.error.googleFailed");
      setError(message);
      setIsLoadingGoogle(false);
    }
  }

  async function handleAppleSignIn() {
    setError(null);
    setIsLoadingApple(true);
    try {
      await signInWithApple({ origin: "register", provider: "apple" });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        setIsLoadingApple(false);
        return;
      }
      const message = code === "auth/popup-blocked"
        ? t("register.popupBlocked")
        : err instanceof Error ? err.message : t("register.error.appleFailed");
      setError(message);
      setIsLoadingApple(false);
    }
  }

  async function handleEmailSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      setError(t("register.error.noName"));
      return;
    }
    if (!email || !password) {
      setError(t("register.error.emptyFields"));
      return;
    }
    if (password.length < 6) {
      setError(t("register.error.weakPassword"));
      return;
    }
    setError(null);
    setIsLoadingEmail(true);
    try {
      const user = await signUpWithEmail(email, password);
      // Update display name after creation
      const { updateProfile } = await import("firebase/auth");
      await updateProfile(user, { displayName: fullName.trim() });

      // Sync user with Supabase via API route. If this fails, we MUST roll
      // back the Firebase account — otherwise the user is left in a
      // half-created state where Firebase has them but Supabase doesn't,
      // which blocks all future signup/login attempts for this email.
      const idToken = await user.getIdToken();
      try {
        await UserService.syncUser(
          idToken,
          email,
          fullName.trim(),
          fullName.trim().split(" ")[0],
          fullName.trim().split(" ").slice(1).join(" ")
        );
      } catch (syncError) {
        console.error("[Register] User sync failed, rolling back Firebase account:", syncError);

        try {
          await fetch("/api/auth/rollback-signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken }),
          });
        } catch (rollbackErr) {
          console.error("[Register] Rollback call failed:", rollbackErr);
        }

        // Sign the client-side Firebase session out so the user isn't left
        // in a zombie "authenticated but nonexistent" state.
        const { signOut: clientSignOut } = await import("@/lib/firebase/auth");
        await clientSignOut().catch(() => {});

        setError(
          syncError instanceof Error
            ? `Signup failed: ${syncError.message}. Please try again.`
            : "Signup failed. Please try again."
        );
        setIsLoadingEmail(false);
        return;
      }

      trackSignUp("email");
      router.push("/account-type");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("register.error.registrationFailed");
      if (message.includes("auth/email-already-in-use")) {
        setError(t("register.error.emailExists"));
      } else if (message.includes("auth/weak-password")) {
        setError(t("register.error.passwordWeak"));
      } else if (message.includes("auth/invalid-email")) {
        setError(t("register.error.invalidEmail"));
      } else {
        setError(message);
      }
    } finally {
      setIsLoadingEmail(false);
    }
  }

  // ── Returning from OAuth redirect → bridge the sync-in-flight window ───
  // Covers the span between Firebase auth resolving and the effect above
  // consuming the redirect context + firing router.push. Prevents the
  // pre-auth form flash after Google/Apple return.
  if (isReturningFromOAuth) {
    return (
      <div className="flex flex-col items-center text-center space-y-5 py-8">
        <Loader2 className="w-10 h-10 text-text-2 animate-spin" />
        <div className="space-y-2">
          <h1 className="font-cakemono text-[28px] font-light tracking-wide text-text leading-none uppercase">
            {t("register.signingUpTitle")}
          </h1>
          <p className="font-mohave text-body-sm text-text-3">
            {t("register.signingUpSubtitle")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Mobile logo — hidden on desktop (hero has branding) */}
      <div className="lg:hidden mb-6 text-text">
        <OpsLockup orientation="horizontal" className="h-6 w-auto" title={t("ops")} />
      </div>

      {/* Heading */}
      <div className="mb-6">
        <h1 className="font-cakemono font-light text-[32px] tracking-[0.08em] uppercase text-text leading-none">
          {t("register.title")}
        </h1>
        <p className="font-mohave text-body-sm text-text-3 mt-1">
          {t("register.subtitle")}
        </p>
      </div>

      {/* Auth card */}
      <div className="space-y-2">
        {/* Error */}
        {error && (
          <div className="bg-ops-error-muted border border-ops-error/30 rounded px-1.5 py-1 animate-slide-up">
            <p className="font-mohave text-body-sm text-ops-error">{error}</p>
          </div>
        )}

        {/* OAuth buttons */}
        <div className="space-y-1">
          {/* Google */}
          <button
            onClick={handleGoogleSignIn}
            disabled={anyLoading}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.2)] transition-all disabled:opacity-50"
          >
            <svg className="w-[18px] h-[18px] shrink-0" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            <span className="font-mohave text-body text-text flex-1 text-left">
              {t("register.continueGoogle")}
            </span>
            {isLoadingGoogle && (
              <span className="w-[16px] h-[16px] border-2 border-text-disabled border-t-text-2 rounded-full animate-spin shrink-0" />
            )}
          </button>

          {/* Apple */}
          <button
            onClick={handleAppleSignIn}
            disabled={anyLoading}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.2)] transition-all disabled:opacity-50"
          >
            <svg className="w-[18px] h-[18px] shrink-0 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            <span className="font-mohave text-body text-text flex-1 text-left">
              {t("register.continueApple")}
            </span>
            {isLoadingApple && (
              <span className="w-[16px] h-[16px] border-2 border-text-disabled border-t-text-2 rounded-full animate-spin shrink-0" />
            )}
          </button>
        </div>

        {/* Divider */}
        <div className="separator-label font-mono text-[11px] uppercase tracking-widest">
          {t("register.orEmail")}
        </div>

        {/* Email form */}
        <form onSubmit={handleEmailSignUp} className="space-y-1.5">
          <Input
            type="text"
            label={t("register.fullName")}
            placeholder={t("register.namePlaceholder")}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            prefixIcon={<User className="w-[16px] h-[16px]" />}
            disabled={anyLoading}
            autoComplete="name"
          />
          <Input
            type="email"
            label={t("register.email")}
            placeholder={t("register.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            prefixIcon={<Mail className="w-[16px] h-[16px]" />}
            disabled={anyLoading}
            autoComplete="email"
          />
          <Input
            type={showPassword ? "text" : "password"}
            label={t("register.password")}
            placeholder={t("register.passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            prefixIcon={<Lock className="w-[16px] h-[16px]" />}
            suffixIcon={
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-text-3 hover:text-text-2 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="w-[16px] h-[16px]" />
                ) : (
                  <Eye className="w-[16px] h-[16px]" />
                )}
              </button>
            }
            disabled={anyLoading}
            autoComplete="new-password"
          />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={isLoadingEmail}
            disabled={isLoadingGoogle || isLoadingApple}
          >
            {t("register.createAccount")}
          </Button>
        </form>
      </div>

      {/* Join existing team */}
      <div className="mt-4 pt-4 border-t border-border">
        <JoinTeamPrompt />
      </div>

      {/* Footer link */}
      <p className="mt-3 font-mohave text-body-sm text-text-3">
        {t("register.hasAccount")}{" "}
        <Link
          href="/login"
          className="text-text-2 hover:text-text underline underline-offset-4 transition-colors"
        >
          {t("register.signIn")}
        </Link>
      </p>
    </div>
  );
}
