"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Eye, EyeOff, Mail, Lock, User, Loader2, AlertCircle } from "lucide-react";
import {
  signInWithGoogle,
  signInWithApple,
  signUpWithEmail,
  signInWithEmail,
  getIdToken,
} from "@/lib/firebase/auth";
import { UserService } from "@/lib/api/services/user-service";
import { useAuthStore } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface InviteData {
  valid: boolean;
  companyName: string;
  companyLogo: string | null;
  roleName: string | null;
  error?: "expired" | "used" | "not_found";
}

export default function JoinPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = searchParams.get("code");
  const { currentUser, isAuthenticated } = useAuthStore();
  const setUser = useAuthStore((s) => s.setUser);
  const setCompany = useAuthStore((s) => s.setCompany);

  const [invite, setInvite] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"signup" | "login">("signup");

  // Form fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isLoadingApple, setIsLoadingApple] = useState(false);

  const anyLoading = isSubmitting || isLoadingGoogle || isLoadingApple;

  // Fetch invite details on mount
  useEffect(() => {
    if (!code) {
      setInvite({
        valid: false,
        companyName: "",
        companyLogo: null,
        roleName: null,
        error: "not_found",
      });
      setLoading(false);
      return;
    }
    fetch(`/api/invites/${encodeURIComponent(code)}`)
      .then((res) => res.json())
      .then((data: InviteData) => setInvite(data))
      .catch(() =>
        setInvite({
          valid: false,
          companyName: "",
          companyLogo: null,
          roleName: null,
          error: "not_found",
        })
      )
      .finally(() => setLoading(false));
  }, [code]);

  // Join company after auth
  async function joinCompany() {
    if (!code) return;
    const token = await getIdToken();
    if (!token) throw new Error("Not authenticated");

    const res = await fetch("/api/auth/join-company", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token, companyCode: code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to join company");

    if (data.user) setUser(data.user);
    if (data.company) setCompany(data.company);

    router.push("/employee-setup");
  }

  async function handleGoogleSignIn() {
    setError(null);
    setIsLoadingGoogle(true);
    try {
      await signInWithGoogle();
      // Sync to Supabase for new users
      const token = await getIdToken();
      if (token) {
        try {
          await UserService.syncUser(token, "");
        } catch {
          /* may already exist */
        }
      }
      await joinCompany();
    } catch (err: unknown) {
      const errCode = (err as { code?: string })?.code;
      if (
        errCode === "auth/popup-closed-by-user" ||
        errCode === "auth/cancelled-popup-request"
      )
        return;
      setError(
        err instanceof Error ? err.message : "Google sign-in failed"
      );
    } finally {
      setIsLoadingGoogle(false);
    }
  }

  async function handleAppleSignIn() {
    setError(null);
    setIsLoadingApple(true);
    try {
      await signInWithApple();
      const token = await getIdToken();
      if (token) {
        try {
          await UserService.syncUser(token, "");
        } catch {
          /* may already exist */
        }
      }
      await joinCompany();
    } catch (err: unknown) {
      const errCode = (err as { code?: string })?.code;
      if (
        errCode === "auth/popup-closed-by-user" ||
        errCode === "auth/cancelled-popup-request"
      )
        return;
      setError(
        err instanceof Error ? err.message : "Apple sign-in failed"
      );
    } finally {
      setIsLoadingApple(false);
    }
  }

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (mode === "signup") {
        const nameParts = fullName.trim().split(" ");
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";
        const fbUser = await signUpWithEmail(email, password);
        // Update display name
        const { updateProfile } = await import("firebase/auth");
        await updateProfile(fbUser, { displayName: fullName.trim() });
        const token = await fbUser.getIdToken();
        await UserService.syncUser(token, email, fullName.trim(), firstName, lastName);
      } else {
        await signInWithEmail(email, password);
      }
      await joinCompany();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Authentication failed";
      if (message.includes("auth/email-already-in-use")) {
        setError("An account with this email already exists. Try logging in.");
      } else if (message.includes("auth/wrong-password") || message.includes("auth/invalid-credential")) {
        setError("Incorrect email or password.");
      } else {
        setError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Already authenticated + no company → auto-join ──────────────────────
  useEffect(() => {
    if (!loading && isAuthenticated && currentUser && !currentUser.companyId && invite?.valid && code) {
      joinCompany().catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to join company");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isAuthenticated, currentUser?.companyId, invite?.valid]);

  // ── Already authenticated + has company ─────────────────────────────────
  if (!loading && isAuthenticated && currentUser?.companyId) {
    return (
      <div className="flex flex-col items-center text-center space-y-4">
        <h1 className="font-bebas text-[36px] tracking-[0.1em] text-text-primary leading-none">
          Already on a team
        </h1>
        <p className="font-mohave text-body-sm text-text-tertiary">
          You&apos;re currently a member of your organization. To join a different
          company, contact your admin.
        </p>
        <Link href="/dashboard">
          <Button variant="primary" className="w-full">
            Go to Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-ops-accent animate-spin" />
      </div>
    );
  }

  // ── Error states ────────────────────────────────────────────────────────
  if (!invite?.valid) {
    const errorMessages: Record<string, { title: string; desc: string }> = {
      expired: {
        title: "Invite Expired",
        desc: "This invitation has expired. Ask your company admin to send a new one.",
      },
      used: {
        title: "Invite Already Used",
        desc: "This invitation has already been accepted.",
      },
      not_found: {
        title: "Invalid Invite",
        desc: "This invitation link is not valid. Check the link or contact your company admin.",
      },
    };
    const msg = errorMessages[invite?.error ?? "not_found"];

    return (
      <div className="flex flex-col items-center text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-red-400" />
        <h1 className="font-bebas text-[36px] tracking-[0.1em] text-text-primary leading-none">
          {msg.title}
        </h1>
        <p className="font-mohave text-body-sm text-text-tertiary">{msg.desc}</p>
        <p className="font-kosugi text-[11px] text-text-disabled">
          Contact your company admin for assistance.
        </p>
      </div>
    );
  }

  // ── Valid invite — show auth form ───────────────────────────────────────
  return (
    <div className="flex flex-col">
      {/* Mobile logo */}
      <div className="lg:hidden mb-6">
        <Image
          src="/images/ops-logo-white.png"
          alt="OPS"
          width={64}
          height={26}
          priority
        />
      </div>

      {/* Company info header */}
      <div className="mb-6 space-y-2">
        {invite.companyLogo && (
          <Image
            src={invite.companyLogo}
            alt={invite.companyName}
            width={48}
            height={48}
            className="rounded-lg"
          />
        )}
        <h1 className="font-bebas text-[36px] tracking-[0.1em] text-text-primary leading-none">
          Join {invite.companyName}
        </h1>
        <p className="font-mohave text-body-sm text-text-tertiary">
          You&apos;ve been invited to join {invite.companyName} on OPS
        </p>
        {invite.roleName && (
          <span className="inline-block font-kosugi text-[10px] text-ops-accent bg-ops-accent-muted px-2 py-1 rounded-full uppercase tracking-wider">
            You&apos;ll join as {invite.roleName}
          </span>
        )}
      </div>

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
            <span className="font-mohave text-body text-text-primary flex-1 text-left">
              Continue with Google
            </span>
            {isLoadingGoogle && (
              <span className="w-[16px] h-[16px] border-2 border-text-disabled border-t-ops-accent rounded-full animate-spin shrink-0" />
            )}
          </button>

          {/* Apple */}
          <button
            onClick={handleAppleSignIn}
            disabled={anyLoading}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.2)] transition-all disabled:opacity-50"
          >
            <svg className="w-[18px] h-[18px] shrink-0" viewBox="0 0 24 24" fill="currentColor">
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
        <div className="flex items-center gap-2 py-1">
          <div className="flex-1 h-px bg-[rgba(255,255,255,0.08)]" />
          <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
            or
          </span>
          <div className="flex-1 h-px bg-[rgba(255,255,255,0.08)]" />
        </div>

        {/* Email form */}
        <form onSubmit={handleEmailAuth} className="space-y-1.5">
          {mode === "signup" && (
            <Input
              type="text"
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              prefixIcon={<User className="w-4 h-4" />}
              disabled={anyLoading}
            />
          )}
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            prefixIcon={<Mail className="w-4 h-4" />}
            disabled={anyLoading}
          />
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              prefixIcon={<Lock className="w-4 h-4" />}
              disabled={anyLoading}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-disabled hover:text-text-secondary"
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={anyLoading}
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : mode === "signup" ? (
              "Create Account & Join"
            ) : (
              "Log In & Join"
            )}
          </Button>
        </form>

        {/* Toggle signup/login */}
        <p className="text-center font-kosugi text-[12px] text-text-disabled pt-1">
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setMode("login")}
                className="text-ops-accent hover:underline"
              >
                Log in
              </button>
            </>
          ) : (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => setMode("signup")}
                className="text-ops-accent hover:underline"
              >
                Sign up
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
