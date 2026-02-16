"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
import { signInWithGoogle, signInWithEmail } from "@/lib/firebase/auth";
import { UserService } from "@/lib/api/services/user-service";
import { useAuthStore } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  const redirectTo = searchParams.get("redirect") || "/projects";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);

  const setUser = useAuthStore((s) => s.setUser);
  const setCompany = useAuthStore((s) => s.setCompany);
  const login = useAuthStore((s) => s.login);

  async function handleGoogleSignIn() {
    setError(null);
    setIsLoadingGoogle(true);
    try {
      // 1. Firebase popup -> get user
      const firebaseUser = await signInWithGoogle();
      // 2. Get ID token
      const idToken = await firebaseUser.getIdToken();
      // 3. Call Bubble /wf/login_google (matches iOS)
      const result = await UserService.loginWithGoogle(
        idToken,
        firebaseUser.email || "",
        firebaseUser.displayName || "",
        firebaseUser.displayName?.split(" ")[0] || "",
        firebaseUser.displayName?.split(" ").slice(1).join(" ") || ""
      );
      // 4. Store user + company in auth store
      setUser(result.user);
      if (result.company) {
        setCompany(result.company);
      }
      router.push(redirectTo);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Google sign-in failed";
      setError(message);
    } finally {
      setIsLoadingGoogle(false);
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
      // 1. Call Bubble /wf/generate-api-token (matches iOS)
      const result = await UserService.loginWithToken(email, password);
      // 2. Store in auth store with token
      login(result.user, result.token);
      if (result.company) {
        setCompany(result.company);
      }
      // 3. Also sign into Firebase for session persistence
      try {
        await signInWithEmail(email, password);
      } catch {
        // Firebase sign-in is optional - Bubble auth is primary
      }
      router.push(redirectTo);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Sign-in failed";
      if (message.includes("INVALID_LOGIN_CREDENTIALS") || message.includes("invalid")) {
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
    <div className="flex flex-col items-center">
      {/* Logo */}
      <div className="text-center mb-4">
        <Image
          src="/images/ops-logo-white.png"
          alt="OPS"
          width={160}
          height={64}
          className="mx-auto"
          priority
        />
      </div>

      {/* Card */}
      <div className="w-full ultrathin-material-dark rounded-md p-3 space-y-3">
        {/* Error */}
        {error && (
          <div className="bg-ops-error-muted border border-ops-error/30 rounded px-1.5 py-1 animate-slide-up">
            <p className="font-mohave text-body-sm text-ops-error">{error}</p>
          </div>
        )}

        {/* Google Sign-In */}
        <Button
          variant="secondary"
          size="lg"
          className="w-full gap-1.5 border-border-medium"
          onClick={handleGoogleSignIn}
          loading={isLoadingGoogle}
          disabled={isLoadingEmail}
        >
          <svg className="w-[20px] h-[20px]" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          <span>Continue with Google</span>
        </Button>

        {/* Divider */}
        <div className="separator-label font-kosugi text-[11px] uppercase tracking-widest">
          or sign in with email
        </div>

        {/* Email form */}
        <form onSubmit={handleEmailSignIn} className="space-y-2">
          <Input
            type="email"
            label="Email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            prefixIcon={<Mail className="w-[16px] h-[16px]" />}
            disabled={isLoadingEmail || isLoadingGoogle}
            autoComplete="email"
          />
          <div className="relative">
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
              disabled={isLoadingEmail || isLoadingGoogle}
              autoComplete="current-password"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={isLoadingEmail}
            disabled={isLoadingGoogle}
          >
            Sign In
          </Button>
        </form>
      </div>

      {/* Footer link */}
      <p className="mt-2 font-mohave text-body-sm text-text-tertiary">
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
