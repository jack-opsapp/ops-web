"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, ArrowRight } from "lucide-react";
import { signInWithGoogle, signInWithApple, signInWithEmail } from "@/lib/firebase/auth";
import { UserService } from "@/lib/api/services/user-service";
import { useAuthStore } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trackLogin } from "@/lib/analytics/analytics";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isLoadingApple, setIsLoadingApple] = useState(false);

  const setUser = useAuthStore((s) => s.setUser);
  const setCompany = useAuthStore((s) => s.setCompany);

  const anyLoading = isLoadingEmail || isLoadingGoogle || isLoadingApple;

  async function handleOAuthSignIn(
    provider: "google" | "apple",
    signInFn: typeof signInWithGoogle
  ) {
    setError(null);
    const setLoading = provider === "google" ? setIsLoadingGoogle : setIsLoadingApple;
    setLoading(true);
    try {
      const firebaseUser = await signInFn();
      const idToken = await firebaseUser.getIdToken();
      const result = await UserService.syncUser(
        idToken,
        firebaseUser.email || "",
        firebaseUser.displayName || undefined,
        firebaseUser.displayName?.split(" ")[0] || undefined,
        firebaseUser.displayName?.split(" ").slice(1).join(" ") || undefined,
        firebaseUser.photoURL || undefined
      );
      setUser(result.user);
      if (result.company) {
        setCompany(result.company);
      }
      trackLogin(provider);
      router.push(redirectTo);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      let message: string;
      if (code === "auth/unauthorized-domain") {
        message = "This domain is not authorized for sign-in. Contact support.";
      } else if (code === "auth/operation-not-allowed") {
        message = `${provider === "google" ? "Google" : "Apple"} sign-in is not enabled.`;
      } else {
        message = err instanceof Error ? err.message : `${provider} sign-in failed`;
      }
      console.error(`[Login] ${provider} sign-in error:`, code, err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter email and password");
      return;
    }
    setError(null);
    setIsLoadingEmail(true);
    try {
      const firebaseUser = await signInWithEmail(email, password);
      const idToken = await firebaseUser.getIdToken();
      const result = await UserService.syncUser(
        idToken,
        email,
        firebaseUser.displayName || undefined
      );
      setUser(result.user);
      if (result.company) {
        setCompany(result.company);
      }
      trackLogin("email");
      router.push(redirectTo);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sign-in failed";
      if (message.includes("INVALID_LOGIN_CREDENTIALS") || message.includes("invalid") || message.includes("auth/invalid-credential")) {
        setError("Invalid email or password");
      } else if (message.includes("too-many-requests") || message.includes("429")) {
        setError("Too many attempts. Please try again later.");
      } else {
        setError(message);
      }
    } finally {
      setIsLoadingEmail(false);
    }
  }

  return (
    <div className="flex flex-col">
      {/* Mobile logo — hidden on desktop (hero has branding) */}
      <div className="lg:hidden mb-6">
        <Image
          src="/images/ops-logo-white.png"
          alt="OPS"
          width={64}
          height={26}
          priority
        />
      </div>

      {/* Heading */}
      <div className="mb-6">
        <h1 className="font-bebas text-[36px] tracking-[0.1em] text-text-primary leading-none">
          Welcome back
        </h1>
        <p className="font-mohave text-body-sm text-text-tertiary mt-1">
          Sign in to manage your operations
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
            onClick={() => handleOAuthSignIn("google", signInWithGoogle)}
            disabled={anyLoading}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.2)] transition-all disabled:opacity-50"
          >
            <svg className="w-[18px] h-[18px] shrink-0" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            <span className="font-mohave text-body text-text-primary flex-1 text-left">
              Continue with Google
            </span>
            {isLoadingGoogle && (
              <span className="w-[16px] h-[16px] border-2 border-text-disabled border-t-ops-accent rounded-full animate-spin shrink-0" />
            )}
          </button>

          {/* Apple */}
          <button
            onClick={() => handleOAuthSignIn("apple", signInWithApple)}
            disabled={anyLoading}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.2)] transition-all disabled:opacity-50"
          >
            <svg className="w-[18px] h-[18px] shrink-0 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            <span className="font-mohave text-body text-text-primary flex-1 text-left">
              Continue with Apple
            </span>
            {isLoadingApple && (
              <span className="w-[16px] h-[16px] border-2 border-text-disabled border-t-ops-accent rounded-full animate-spin shrink-0" />
            )}
          </button>
        </div>

        {/* Divider */}
        <div className="separator-label font-kosugi text-[11px] uppercase tracking-widest">
          or
        </div>

        {/* Email toggle / form */}
        {!showEmailForm ? (
          <button
            onClick={() => setShowEmailForm(true)}
            disabled={anyLoading}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.2)] transition-all disabled:opacity-50"
          >
            <Mail className="w-[18px] h-[18px] text-text-tertiary shrink-0" />
            <span className="font-mohave text-body text-text-primary flex-1 text-left">
              Sign in with email
            </span>
            <ArrowRight className="w-[14px] h-[14px] text-text-disabled shrink-0" />
          </button>
        ) : (
          <form onSubmit={handleEmailSignIn} className="space-y-1.5 animate-fade-in">
            <Input
              type="email"
              label="Email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              prefixIcon={<Mail className="w-[16px] h-[16px]" />}
              disabled={anyLoading}
              autoComplete="email"
              autoFocus
            />
            <Input
              type={showPassword ? "text" : "password"}
              label="Password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              prefixIcon={<Lock className="w-[16px] h-[16px]" />}
              suffixIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-text-tertiary hover:text-text-secondary transition-colors"
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
              autoComplete="current-password"
            />
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={isLoadingEmail}
              disabled={isLoadingGoogle || isLoadingApple}
            >
              Sign In
            </Button>
            <button
              type="button"
              onClick={() => {
                setShowEmailForm(false);
                setError(null);
              }}
              className="w-full text-center font-kosugi text-[11px] text-text-disabled hover:text-text-tertiary transition-colors py-[4px]"
            >
              Back to other options
            </button>
          </form>
        )}
      </div>

      {/* Footer */}
      <p className="mt-4 font-mohave text-body-sm text-text-tertiary">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="text-ops-accent hover:text-ops-accent-hover underline underline-offset-4 transition-colors"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}
