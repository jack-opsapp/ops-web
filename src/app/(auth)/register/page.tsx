"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, User } from "lucide-react";
import { signInWithGoogle, signInWithApple, signUpWithEmail } from "@/lib/firebase/auth";
import { UserService } from "@/lib/api/services/user-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trackSignUp } from "@/lib/analytics/analytics";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isLoadingApple, setIsLoadingApple] = useState(false);

  async function handleGoogleSignIn() {
    setError(null);
    setIsLoadingGoogle(true);
    try {
      await signInWithGoogle();
      trackSignUp("google");
      router.push("/onboarding");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Google sign-in failed";
      setError(message);
    } finally {
      setIsLoadingGoogle(false);
    }
  }

  async function handleAppleSignIn() {
    setError(null);
    setIsLoadingApple(true);
    try {
      await signInWithApple();
      trackSignUp("apple");
      router.push("/onboarding");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Apple sign-in failed";
      setError(message);
    } finally {
      setIsLoadingApple(false);
    }
  }

  async function handleEmailSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      setError("Please enter your full name");
      return;
    }
    if (!email || !password) {
      setError("Please fill in all fields");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setError(null);
    setIsLoadingEmail(true);
    try {
      const user = await signUpWithEmail(email, password);
      // Update display name after creation
      const { updateProfile } = await import("firebase/auth");
      await updateProfile(user, { displayName: fullName.trim() });

      // Sync user with Supabase via API route
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
        console.error("[Register] User sync failed:", syncError);
        // Continue anyway - auth provider will reconcile on next login
      }

      trackSignUp("email");
      router.push("/onboarding");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Registration failed";
      if (message.includes("auth/email-already-in-use")) {
        setError("An account already exists with this email");
      } else if (message.includes("auth/weak-password")) {
        setError("Password is too weak. Use at least 6 characters.");
      } else if (message.includes("auth/invalid-email")) {
        setError("Invalid email address");
      } else {
        setError(message);
      }
    } finally {
      setIsLoadingEmail(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      {/* Logo & Title */}
      <div className="text-center mb-4">
        <h1 className="font-bebas text-[56px] tracking-[0.2em] text-ops-accent leading-none">
          OPS
        </h1>
        <p className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-[0.3em] mt-1">
          Join OPS
        </p>
      </div>

      {/* Card */}
      <div className="w-full bg-background-panel border border-border rounded-lg p-3 space-y-3">
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
          disabled={isLoadingEmail || isLoadingApple}
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

        {/* Apple Sign-In */}
        <Button
          variant="secondary"
          size="lg"
          className="w-full gap-1.5 border-border-medium"
          onClick={handleAppleSignIn}
          loading={isLoadingApple}
          disabled={isLoadingEmail || isLoadingGoogle || isLoadingApple}
        >
          <svg className="w-[20px] h-[20px]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
          </svg>
          <span>Continue with Apple</span>
        </Button>

        {/* Divider */}
        <div className="separator-label font-kosugi text-[11px] uppercase tracking-widest">
          or create account with email
        </div>

        {/* Email form */}
        <form onSubmit={handleEmailSignUp} className="space-y-2">
          <Input
            type="text"
            label="Full Name"
            placeholder="John Smith"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            prefixIcon={<User className="w-[16px] h-[16px]" />}
            disabled={isLoadingEmail || isLoadingGoogle || isLoadingApple}
            autoComplete="name"
          />
          <Input
            type="email"
            label="Email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            prefixIcon={<Mail className="w-[16px] h-[16px]" />}
            disabled={isLoadingEmail || isLoadingGoogle || isLoadingApple}
            autoComplete="email"
          />
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              label="Password"
              placeholder="Min. 6 characters"
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
              disabled={isLoadingEmail || isLoadingGoogle || isLoadingApple}
              autoComplete="new-password"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={isLoadingEmail}
            disabled={isLoadingGoogle || isLoadingApple}
          >
            Create Account
          </Button>
        </form>
      </div>

      {/* Footer link */}
      <p className="mt-2 font-mohave text-body-sm text-text-tertiary">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-ops-accent hover:text-ops-accent-hover underline underline-offset-4 transition-colors"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
