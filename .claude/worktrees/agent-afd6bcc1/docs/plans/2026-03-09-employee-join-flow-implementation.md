# Employee Join Flow — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the complete employee join flow — from invite link landing to employee onboarding to dashboard with role-aware access.

**Architecture:** Invite email links to `/join?code=xxx` which validates the invite, handles auth (sign-up or log-in), calls `POST /api/auth/join-company`, then redirects to a 4-step employee onboarding wizard (`/employee-setup`). Users without a pre-assigned role get an "Unassigned" system role with minimal permissions. Admin notifications fire via in-app, email, and push.

**Tech Stack:** Next.js 14 App Router, Firebase Auth, Supabase (Postgres), SendGrid, Zustand, TanStack Query, Tailwind CSS

---

### Task 1: Database Migration — Emergency Contact Fields + Unassigned Role

**Files:**
- Create: `src/app/api/migrations/add-emergency-contact-and-unassigned-role/route.ts`

**Step 1: Create the migration API route**

This is a one-time migration endpoint. After running, it can be deleted.

```ts
// src/app/api/migrations/add-emergency-contact-and-unassigned-role/route.ts
import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function POST() {
  const db = getServiceRoleClient();

  // 1. Add emergency contact columns to users table
  const { error: alterError } = await db.rpc("exec_sql", {
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
        ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
        ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT;
    `,
  });

  if (alterError) {
    // Fallback: try raw SQL if rpc not available
    const { error: rawError } = await db.from("users").select("emergency_contact_name").limit(0);
    if (rawError && rawError.message.includes("does not exist")) {
      // Columns don't exist — need to add via Supabase dashboard SQL editor
      return NextResponse.json({
        error: "Cannot add columns via API. Run this SQL in Supabase SQL Editor:",
        sql: `
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT;

-- Add Unassigned preset role
INSERT INTO roles (id, company_id, name, description, hierarchy, is_preset, is_system, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000006',
  NULL,
  'Unassigned',
  'Default role for users who have not been assigned a role. Read-only access to own assignments.',
  99,
  true,
  true,
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Add minimal permissions for Unassigned role
INSERT INTO role_permissions (role_id, permission, scope) VALUES
  ('00000000-0000-0000-0000-000000000006', 'projects.view', 'assigned'),
  ('00000000-0000-0000-0000-000000000006', 'tasks.view', 'assigned'),
  ('00000000-0000-0000-0000-000000000006', 'calendar.view', 'own'),
  ('00000000-0000-0000-0000-000000000006', 'profile.edit', 'own')
ON CONFLICT DO NOTHING;

-- Add employee_onboarding step to setup_progress schema
-- (No schema change needed — setup_progress is a JSONB column, we just add new keys)
        `,
      }, { status: 400 });
    }
  }

  return NextResponse.json({ success: true });
}
```

**Step 2: Run the migration**

Execute the SQL in the Supabase SQL Editor (the migration endpoint provides the exact SQL). This adds:
- 3 emergency contact columns on `users`
- "Unassigned" role with UUID `00000000-0000-0000-0000-000000000006`
- 4 minimal permissions for the Unassigned role

**Step 3: Commit**

```bash
git add src/app/api/migrations/add-emergency-contact-and-unassigned-role/route.ts
git commit -m "feat: add migration for emergency contact fields and Unassigned role"
```

---

### Task 2: Update PRESET_ROLE_IDS and User TypeScript Model

**Files:**
- Modify: `src/lib/types/permissions.ts:40-46` (add UNASSIGNED to PRESET_ROLE_IDS)
- Modify: `src/lib/types/models.ts:388-418` (add emergency contact fields to User interface)
- Modify: `src/lib/types/models.ts:377-385` (add employee_onboarding step to SetupProgress)

**Step 1: Add UNASSIGNED preset role ID**

In `src/lib/types/permissions.ts`, update `PRESET_ROLE_IDS`:

```ts
export const PRESET_ROLE_IDS = {
  ADMIN: "00000000-0000-0000-0000-000000000001",
  OWNER: "00000000-0000-0000-0000-000000000002",
  OFFICE: "00000000-0000-0000-0000-000000000003",
  OPERATOR: "00000000-0000-0000-0000-000000000004",
  CREW: "00000000-0000-0000-0000-000000000005",
  UNASSIGNED: "00000000-0000-0000-0000-000000000006",
} as const;
```

**Step 2: Add emergency contact fields to User interface**

In `src/lib/types/models.ts`, add these fields to the `User` interface after `deviceToken`:

```ts
emergencyContactName: string | null;
emergencyContactPhone: string | null;
emergencyContactRelationship: string | null;
```

**Step 3: Add employee_onboarding step to SetupProgress**

In `src/lib/types/models.ts`, update `SetupProgress`:

```ts
export interface SetupProgress {
  steps: {
    identity?: boolean;
    company?: boolean;
    starfield?: boolean;
    employee_onboarding?: boolean;
  };
  starfield_answers?: Record<string, string | number>;
}
```

**Step 4: Commit**

```bash
git add src/lib/types/permissions.ts src/lib/types/models.ts
git commit -m "feat: add Unassigned role ID, emergency contact fields, employee onboarding step"
```

---

### Task 3: Update User Service mapFromDb / mapToDb

**Files:**
- Modify: `src/lib/api/services/user-service.ts:16-48` (mapFromDb)
- Modify: `src/lib/api/services/user-service.ts:50-79` (mapToDb)
- Modify: `src/app/api/auth/join-company/route.ts:37-68` (mapUserFromDb — duplicate mapper)

**Step 1: Add emergency contact mapping to user-service.ts mapFromDb**

After `deviceToken` line (42), add:

```ts
emergencyContactName: (row.emergency_contact_name as string) ?? null,
emergencyContactPhone: (row.emergency_contact_phone as string) ?? null,
emergencyContactRelationship: (row.emergency_contact_relationship as string) ?? null,
```

**Step 2: Add emergency contact mapping to user-service.ts mapToDb**

After the `fabActions` mapping (77), add:

```ts
if (data.emergencyContactName !== undefined) row.emergency_contact_name = data.emergencyContactName;
if (data.emergencyContactPhone !== undefined) row.emergency_contact_phone = data.emergencyContactPhone;
if (data.emergencyContactRelationship !== undefined) row.emergency_contact_relationship = data.emergencyContactRelationship;
```

**Step 3: Update join-company route's mapUserFromDb**

In `src/app/api/auth/join-company/route.ts`, add the same 3 fields to `mapUserFromDb` after `deviceToken`:

```ts
emergencyContactName: (row.emergency_contact_name as string) ?? null,
emergencyContactPhone: (row.emergency_contact_phone as string) ?? null,
emergencyContactRelationship: (row.emergency_contact_relationship as string) ?? null,
```

**Step 4: Commit**

```bash
git add src/lib/api/services/user-service.ts "src/app/api/auth/join-company/route.ts"
git commit -m "feat: add emergency contact fields to user mappers"
```

---

### Task 4: Invite Lookup API — `GET /api/invites/[code]`

**Files:**
- Create: `src/app/api/invites/[code]/route.ts`

**Step 1: Create the invite lookup endpoint**

This is a public endpoint (no auth required) that returns invite details for the join page.

```ts
// src/app/api/invites/[code]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

interface InviteResponse {
  valid: boolean;
  companyName: string;
  companyLogo: string | null;
  roleName: string | null;
  error?: "expired" | "used" | "not_found";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { code: string } }
) {
  const code = params.code;
  if (!code) {
    return NextResponse.json(
      { valid: false, companyName: "", companyLogo: null, roleName: null, error: "not_found" } satisfies InviteResponse,
      { status: 400 }
    );
  }

  const db = getServiceRoleClient();

  // Look up invitation by invite_code
  const { data: invitation, error } = await db
    .from("team_invitations")
    .select(`
      id,
      status,
      expires_at,
      role_id,
      company_id,
      companies!inner (
        id,
        name,
        logo_url,
        external_id
      )
    `)
    .eq("invite_code", code)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // If not found by invite_code, try finding company by external_id
  // (the invite email may use company external_id as the code)
  if (!invitation) {
    const { data: company } = await db
      .from("companies")
      .select("id, name, logo_url, external_id")
      .eq("external_id", code)
      .is("deleted_at", null)
      .maybeSingle();

    if (company) {
      // Company found — this is a generic join link (no specific invitation)
      return NextResponse.json({
        valid: true,
        companyName: company.name,
        companyLogo: company.logo_url,
        roleName: null,
      } satisfies InviteResponse);
    }

    return NextResponse.json(
      { valid: false, companyName: "", companyLogo: null, roleName: null, error: "not_found" } satisfies InviteResponse,
      { status: 404 }
    );
  }

  const company = invitation.companies as unknown as { id: string; name: string; logo_url: string | null };

  // Check if invitation was already used
  if (invitation.status === "accepted") {
    return NextResponse.json(
      { valid: false, companyName: company.name, companyLogo: company.logo_url, roleName: null, error: "used" } satisfies InviteResponse,
      { status: 410 }
    );
  }

  // Check if invitation expired
  if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json(
      { valid: false, companyName: company.name, companyLogo: company.logo_url, roleName: null, error: "expired" } satisfies InviteResponse,
      { status: 410 }
    );
  }

  // Look up role name if role_id is set
  let roleName: string | null = null;
  if (invitation.role_id) {
    const { data: role } = await db
      .from("roles")
      .select("name")
      .eq("id", invitation.role_id)
      .maybeSingle();
    roleName = role?.name ?? null;
  }

  return NextResponse.json({
    valid: true,
    companyName: company.name,
    companyLogo: company.logo_url,
    roleName,
  } satisfies InviteResponse);
}
```

**Step 2: Commit**

```bash
git add "src/app/api/invites/[code]/route.ts"
git commit -m "feat: add GET /api/invites/[code] endpoint for invite lookup"
```

---

### Task 5: `/join` Page — Invite Landing

**Files:**
- Create: `src/app/(auth)/join/page.tsx`

**Step 1: Create the join page**

This page reads `?code=` from the URL, fetches invite details, shows company info, and provides auth options (Google, Apple, Email sign-up, or Log in). After auth, it calls `POST /api/auth/join-company` and redirects to `/employee-setup`.

Reference `src/app/(auth)/register/page.tsx` for auth provider patterns (signInWithGoogle, signInWithApple, signUpWithEmail).
Reference `src/app/(auth)/login/page.tsx` for the login flow (signInWithEmail).

Key implementation details:
- Use `useSearchParams()` to get `?code=` param
- Fetch `GET /api/invites/${code}` on mount to get company name, logo, role, validity
- Show error states for expired/used/invalid codes
- Auth section: same Google/Apple/Email buttons as register page
- "Already have an account? Log in" link that switches to login mode (email + password form)
- After successful Firebase auth, call `UserService.syncUser()` (for new users) then call `POST /api/auth/join-company` with `{ idToken, companyCode: code }`
- On success: update auth store with returned user + company, redirect to `/employee-setup`
- If user is already authenticated AND already in a company, show "You're already part of [Company]" with dashboard link

Design notes (follow OPS design system — dark theme, Mohave headings, Kosugi body):
- Full-screen centered card like register/login pages
- Company logo at top (if available), OPS logo fallback
- "You've been invited to join [Company Name]" heading
- Role badge if pre-assigned: "You'll join as [Role Name]"
- Auth provider buttons (Google, Apple) + email form
- Error state: red-tinted card with error message + "Contact your company admin" text

```tsx
// src/app/(auth)/join/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Eye, EyeOff, Mail, Lock, User, Loader2, AlertCircle } from "lucide-react";
import { signInWithGoogle, signInWithApple, signUpWithEmail, signInWithEmail, getIdToken } from "@/lib/firebase/auth";
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
  const { currentUser, setUser, setCompany } = useAuthStore();

  const [invite, setInvite] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"signup" | "login">("signup");

  // Sign-up fields
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
      setInvite({ valid: false, companyName: "", companyLogo: null, roleName: null, error: "not_found" });
      setLoading(false);
      return;
    }
    fetch(`/api/invites/${encodeURIComponent(code)}`)
      .then((res) => res.json())
      .then((data: InviteData) => setInvite(data))
      .catch(() => setInvite({ valid: false, companyName: "", companyLogo: null, roleName: null, error: "not_found" }))
      .finally(() => setLoading(false));
  }, [code]);

  // If user is already authenticated and has a company, show message
  if (!loading && currentUser?.companyId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-[400px] bg-background-card border border-border rounded-lg p-6 text-center space-y-4">
          <h1 className="font-mohave text-heading text-text-primary">
            You're already part of a company
          </h1>
          <p className="font-kosugi text-body-sm text-text-secondary">
            You're currently a member of your organization. To join a different company, contact your admin.
          </p>
          <Link href="/dashboard">
            <Button variant="primary" className="w-full">Go to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

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

    // Update auth store
    if (data.user) setUser(data.user);
    if (data.company) setCompany(data.company);

    router.push("/employee-setup");
  }

  async function handleGoogleSignIn() {
    setError(null);
    setIsLoadingGoogle(true);
    try {
      await signInWithGoogle();
      // For new users, sync to Supabase
      const token = await getIdToken();
      if (token) {
        try { await UserService.syncUser(token); } catch { /* may already exist */ }
      }
      await joinCompany();
    } catch (err: unknown) {
      const errCode = (err as { code?: string })?.code;
      if (errCode === "auth/popup-closed-by-user" || errCode === "auth/cancelled-popup-request") return;
      setError(err instanceof Error ? err.message : "Google sign-in failed");
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
        try { await UserService.syncUser(token); } catch { /* may already exist */ }
      }
      await joinCompany();
    } catch (err: unknown) {
      const errCode = (err as { code?: string })?.code;
      if (errCode === "auth/popup-closed-by-user" || errCode === "auth/cancelled-popup-request") return;
      setError(err instanceof Error ? err.message : "Apple sign-in failed");
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
        const [firstName, ...rest] = fullName.trim().split(" ");
        const lastName = rest.join(" ") || "";
        await signUpWithEmail(email, password);
        const token = await getIdToken();
        if (token) {
          await UserService.syncUser(token, email, firstName, lastName);
        }
      } else {
        await signInWithEmail(email, password);
      }
      await joinCompany();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-ops-accent animate-spin" />
      </div>
    );
  }

  // Error states
  if (!invite?.valid) {
    const errorMessages: Record<string, { title: string; desc: string }> = {
      expired: { title: "Invite Expired", desc: "This invitation has expired. Ask your company admin to send a new one." },
      used: { title: "Invite Already Used", desc: "This invitation has already been accepted." },
      not_found: { title: "Invalid Invite", desc: "This invitation link is not valid. Check the link or contact your company admin." },
    };
    const msg = errorMessages[invite?.error ?? "not_found"];

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-[400px] bg-background-card border border-red-500/30 rounded-lg p-6 text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
          <h1 className="font-mohave text-heading text-text-primary">{msg.title}</h1>
          <p className="font-kosugi text-body-sm text-text-secondary">{msg.desc}</p>
          <p className="font-kosugi text-[11px] text-text-disabled">
            Contact your company admin for assistance.
          </p>
        </div>
      </div>
    );
  }

  // Valid invite — show auth options
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-[400px] bg-background-card border border-border rounded-lg p-6 space-y-6">
        {/* Company info */}
        <div className="text-center space-y-3">
          {invite.companyLogo ? (
            <Image
              src={invite.companyLogo}
              alt={invite.companyName}
              width={64}
              height={64}
              className="mx-auto rounded-lg"
            />
          ) : (
            <Image
              src="/images/ops-logo-white.svg"
              alt="OPS"
              width={48}
              height={48}
              className="mx-auto"
            />
          )}
          <div>
            <h1 className="font-mohave text-heading text-text-primary">
              Join {invite.companyName}
            </h1>
            <p className="font-kosugi text-body-sm text-text-secondary mt-1">
              You've been invited to join {invite.companyName} on OPS
            </p>
            {invite.roleName && (
              <span className="inline-block mt-2 font-kosugi text-[10px] text-ops-accent bg-ops-accent-muted px-2 py-1 rounded-full uppercase tracking-wider">
                You'll join as {invite.roleName}
              </span>
            )}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
            <p className="font-kosugi text-[12px] text-red-400">{error}</p>
          </div>
        )}

        {/* OAuth buttons */}
        <div className="space-y-2">
          <button
            onClick={handleGoogleSignIn}
            disabled={anyLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white text-gray-800 rounded-lg font-mohave text-body-sm hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {isLoadingGoogle ? <Loader2 className="w-5 h-5 animate-spin" /> : (
              <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            )}
            Continue with Google
          </button>

          <button
            onClick={handleAppleSignIn}
            disabled={anyLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-black border border-[rgba(255,255,255,0.15)] text-white rounded-lg font-mohave text-body-sm hover:bg-[#1a1a1a] transition-colors disabled:opacity-50"
          >
            {isLoadingApple ? <Loader2 className="w-5 h-5 animate-spin" /> : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
            )}
            Continue with Apple
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="font-kosugi text-[11px] text-text-disabled uppercase">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Email form */}
        <form onSubmit={handleEmailAuth} className="space-y-3">
          {mode === "signup" && (
            <Input
              type="text"
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              icon={<User className="w-4 h-4" />}
              disabled={anyLoading}
            />
          )}
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            icon={<Mail className="w-4 h-4" />}
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
              icon={<Lock className="w-4 h-4" />}
              disabled={anyLoading}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-disabled hover:text-text-secondary"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <Button type="submit" variant="primary" className="w-full" disabled={anyLoading}>
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
        <p className="text-center font-kosugi text-[12px] text-text-disabled">
          {mode === "signup" ? (
            <>Already have an account?{" "}
              <button onClick={() => setMode("login")} className="text-ops-accent hover:underline">
                Log in
              </button>
            </>
          ) : (
            <>Don't have an account?{" "}
              <button onClick={() => setMode("signup")} className="text-ops-accent hover:underline">
                Sign up
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add "src/app/(auth)/join/page.tsx"
git commit -m "feat: add /join page for invite link landing"
```

---

### Task 6: Employee Setup Store

**Files:**
- Create: `src/stores/employee-setup-store.ts`

**Step 1: Create the Zustand store for employee onboarding state**

```ts
// src/stores/employee-setup-store.ts
import { create } from "zustand";

export type EmployeeSetupPhase = "profile" | "phone" | "emergency" | "notifications" | "complete";

interface EmployeeSetupState {
  phase: EmployeeSetupPhase;
  // Profile step
  firstName: string;
  lastName: string;
  profileImageURL: string | null;
  // Phone step
  phone: string;
  // Emergency contact step
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  // Notifications step
  pushEnabled: boolean;
  emailEnabled: boolean;

  // Actions
  setPhase: (phase: EmployeeSetupPhase) => void;
  setProfile: (data: { firstName: string; lastName: string; profileImageURL: string | null }) => void;
  setPhone: (phone: string) => void;
  setEmergencyContact: (data: { name: string; phone: string; relationship: string }) => void;
  setNotifications: (data: { push: boolean; email: boolean }) => void;
  reset: () => void;
}

const initialState = {
  phase: "profile" as EmployeeSetupPhase,
  firstName: "",
  lastName: "",
  profileImageURL: null as string | null,
  phone: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
  pushEnabled: true,
  emailEnabled: true,
};

export const useEmployeeSetupStore = create<EmployeeSetupState>((set) => ({
  ...initialState,

  setPhase: (phase) => set({ phase }),

  setProfile: (data) => set({
    firstName: data.firstName,
    lastName: data.lastName,
    profileImageURL: data.profileImageURL,
  }),

  setPhone: (phone) => set({ phone }),

  setEmergencyContact: (data) => set({
    emergencyContactName: data.name,
    emergencyContactPhone: data.phone,
    emergencyContactRelationship: data.relationship,
  }),

  setNotifications: (data) => set({
    pushEnabled: data.push,
    emailEnabled: data.email,
  }),

  reset: () => set(initialState),
}));
```

**Step 2: Commit**

```bash
git add src/stores/employee-setup-store.ts
git commit -m "feat: add employee setup Zustand store"
```

---

### Task 7: Employee Setup API — Save Progress + Complete

**Files:**
- Create: `src/app/api/employee-setup/progress/route.ts`
- Create: `src/app/api/employee-setup/complete/route.ts`

**Step 1: Create progress endpoint**

Saves employee onboarding data incrementally.

```ts
// src/app/api/employee-setup/progress/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

export async function POST(req: NextRequest) {
  try {
    const { idToken, ...fields } = await req.json();
    if (!idToken) return NextResponse.json({ error: "Missing idToken" }, { status: 401 });

    const firebaseUser = await verifyAuthToken(idToken);
    const db = getServiceRoleClient();

    // Find user
    const { data: user } = await db
      .from("users")
      .select("id, setup_progress")
      .eq("auth_id", firebaseUser.uid)
      .is("deleted_at", null)
      .maybeSingle();

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Build update payload from allowed fields
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (fields.firstName !== undefined) update.first_name = fields.firstName;
    if (fields.lastName !== undefined) update.last_name = fields.lastName;
    if (fields.phone !== undefined) update.phone = fields.phone;
    if (fields.profileImageURL !== undefined) update.profile_image_url = fields.profileImageURL;
    if (fields.emergencyContactName !== undefined) update.emergency_contact_name = fields.emergencyContactName;
    if (fields.emergencyContactPhone !== undefined) update.emergency_contact_phone = fields.emergencyContactPhone;
    if (fields.emergencyContactRelationship !== undefined) update.emergency_contact_relationship = fields.emergencyContactRelationship;

    const { error: updateError } = await db
      .from("users")
      .update(update)
      .eq("id", user.id);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
```

**Step 2: Create complete endpoint**

Marks employee onboarding as complete and triggers admin notifications if user has no role.

```ts
// src/app/api/employee-setup/complete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { PRESET_ROLE_IDS } from "@/lib/types/permissions";

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json();
    if (!idToken) return NextResponse.json({ error: "Missing idToken" }, { status: 401 });

    const firebaseUser = await verifyAuthToken(idToken);
    const db = getServiceRoleClient();

    // Find user
    const { data: user } = await db
      .from("users")
      .select("id, company_id, first_name, last_name, setup_progress")
      .eq("auth_id", firebaseUser.uid)
      .is("deleted_at", null)
      .maybeSingle();

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Mark employee onboarding complete in setup_progress
    const currentProgress = (user.setup_progress as Record<string, unknown>) ?? { steps: {} };
    const steps = (currentProgress.steps as Record<string, boolean>) ?? {};
    steps.employee_onboarding = true;
    currentProgress.steps = steps;

    await db
      .from("users")
      .update({
        setup_progress: currentProgress,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    // Check if user has an assigned role (other than Unassigned)
    const { data: userRole } = await db
      .from("user_roles")
      .select("role_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const hasRealRole = userRole && userRole.role_id !== PRESET_ROLE_IDS.UNASSIGNED;

    if (!hasRealRole && user.company_id) {
      // Assign "Unassigned" role if no role exists
      if (!userRole) {
        await db.from("user_roles").upsert({
          user_id: user.id,
          role_id: PRESET_ROLE_IDS.UNASSIGNED,
          assigned_at: new Date().toISOString(),
          assigned_by: null,
        }, { onConflict: "user_id" });
      }

      // Fire notifications to admins (in-app, email, push)
      // This is handled by a separate internal function — see Task 10
      try {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/role-needed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            userName: `${user.first_name} ${user.last_name}`.trim(),
            companyId: user.company_id,
          }),
        });
      } catch (notifErr) {
        console.error("[employee-setup/complete] Failed to send role-needed notifications:", notifErr);
      }
    }

    return NextResponse.json({ success: true, needsRole: !hasRealRole });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
```

**Step 3: Commit**

```bash
git add src/app/api/employee-setup/progress/route.ts src/app/api/employee-setup/complete/route.ts
git commit -m "feat: add employee setup progress and complete API endpoints"
```

---

### Task 8: `/employee-setup` Page — 4-Step Onboarding Wizard

**Files:**
- Create: `src/app/(auth)/employee-setup/page.tsx`

**Step 1: Create the employee setup page**

4-step wizard: Profile → Phone → Emergency Contact → Notifications.

Reference `src/app/(onboarding)/setup/page.tsx` for the wizard pattern (phase-based state machine with Zustand store).
Reference `src/components/ops/image-upload.tsx` for profile photo upload component.

Key implementation:
- Each step saves to server via `POST /api/employee-setup/progress`
- On final step completion, calls `POST /api/employee-setup/complete`
- Pre-populates firstName/lastName from auth store if available
- Uses `useEmployeeSetupStore` for local state
- Progress bar shows 1/4, 2/4, 3/4, 4/4
- Step animations: slide-in from right

```tsx
// src/app/(auth)/employee-setup/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Phone,
  Heart,
  Bell,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageUpload } from "@/components/ops/image-upload";
import { useAuthStore } from "@/lib/store/auth-store";
import { useEmployeeSetupStore } from "@/stores/employee-setup-store";
import { getIdToken } from "@/lib/firebase/auth";
import { cn } from "@/lib/utils/cn";

const STEPS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "phone", label: "Phone", icon: Phone },
  { id: "emergency", label: "Emergency Contact", icon: Heart },
  { id: "notifications", label: "Notifications", icon: Bell },
] as const;

const RELATIONSHIP_OPTIONS = [
  "Spouse",
  "Parent",
  "Sibling",
  "Partner",
  "Friend",
  "Other",
];

async function saveProgress(fields: Record<string, unknown>) {
  const token = await getIdToken();
  if (!token) return;
  await fetch("/api/employee-setup/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token, ...fields }),
  });
}

async function completeSetup(): Promise<{ needsRole: boolean }> {
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch("/api/employee-setup/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token }),
  });
  if (!res.ok) throw new Error("Failed to complete setup");
  return res.json();
}

export default function EmployeeSetupPage() {
  const router = useRouter();
  const { currentUser } = useAuthStore();
  const store = useEmployeeSetupStore();

  const [currentStep, setCurrentStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // Pre-populate from auth store
  useEffect(() => {
    if (currentUser && !store.firstName) {
      store.setProfile({
        firstName: currentUser.firstName || "",
        lastName: currentUser.lastName || "",
        profileImageURL: currentUser.profileImageURL || null,
      });
      if (currentUser.phone) store.setPhone(currentUser.phone);
    }
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect if not authenticated
  useEffect(() => {
    if (!currentUser) router.push("/login");
  }, [currentUser, router]);

  // Redirect if already completed employee onboarding
  useEffect(() => {
    if (currentUser?.setupProgress?.steps?.employee_onboarding) {
      router.push("/dashboard");
    }
  }, [currentUser, router]);

  const step = STEPS[currentStep];

  async function handleNext() {
    setIsSaving(true);
    try {
      // Save current step data
      switch (step.id) {
        case "profile":
          await saveProgress({
            firstName: store.firstName,
            lastName: store.lastName,
            profileImageURL: store.profileImageURL,
          });
          break;
        case "phone":
          await saveProgress({ phone: store.phone });
          break;
        case "emergency":
          await saveProgress({
            emergencyContactName: store.emergencyContactName,
            emergencyContactPhone: store.emergencyContactPhone,
            emergencyContactRelationship: store.emergencyContactRelationship,
          });
          break;
        case "notifications":
          // Complete setup on final step
          await completeSetup();
          store.reset();
          router.push("/dashboard");
          return;
      }

      setCurrentStep((prev) => prev + 1);
    } catch (err) {
      console.error("Failed to save step:", err);
    } finally {
      setIsSaving(false);
    }
  }

  function handleBack() {
    if (currentStep > 0) setCurrentStep((prev) => prev - 1);
  }

  // Step validation
  function isStepValid(): boolean {
    switch (step.id) {
      case "profile":
        return !!store.firstName.trim() && !!store.lastName.trim();
      case "phone":
        return !!store.phone.trim();
      case "emergency":
        return true; // Emergency contact is optional
      case "notifications":
        return true; // Notifications step always valid
      default:
        return false;
    }
  }

  if (!currentUser) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-[480px] space-y-6">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-kosugi text-[11px] text-text-disabled uppercase tracking-wider">
              Step {currentStep + 1} of {STEPS.length}
            </span>
            <span className="font-kosugi text-[11px] text-text-tertiary">
              {step.label}
            </span>
          </div>
          <div className="h-[3px] bg-background-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-ops-accent rounded-full transition-all duration-500"
              style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Step icons */}
        <div className="flex items-center justify-center gap-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isDone = i < currentStep;
            const isActive = i === currentStep;
            return (
              <div
                key={s.id}
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                  isDone && "bg-ops-accent/20",
                  isActive && "bg-ops-accent-muted border-2 border-ops-accent",
                  !isDone && !isActive && "bg-background-elevated"
                )}
              >
                {isDone ? (
                  <Check className="w-4 h-4 text-ops-accent" />
                ) : (
                  <Icon className={cn("w-4 h-4", isActive ? "text-ops-accent" : "text-text-disabled")} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="bg-background-card border border-border rounded-lg p-6 space-y-4 animate-slide-up" key={step.id}>
          {step.id === "profile" && (
            <>
              <h2 className="font-mohave text-heading text-text-primary">Your Profile</h2>
              <p className="font-kosugi text-body-sm text-text-secondary">
                Set up your profile photo and confirm your name.
              </p>
              <div className="flex justify-center">
                <ImageUpload
                  value={store.profileImageURL}
                  onChange={(url) => store.setProfile({ ...store, profileImageURL: url })}
                  size="lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="First Name"
                  value={store.firstName}
                  onChange={(e) => store.setProfile({ ...store, firstName: e.target.value })}
                  icon={<User className="w-4 h-4" />}
                />
                <Input
                  placeholder="Last Name"
                  value={store.lastName}
                  onChange={(e) => store.setProfile({ ...store, lastName: e.target.value })}
                />
              </div>
            </>
          )}

          {step.id === "phone" && (
            <>
              <h2 className="font-mohave text-heading text-text-primary">Phone Number</h2>
              <p className="font-kosugi text-body-sm text-text-secondary">
                Your phone number helps your team reach you in the field.
              </p>
              <Input
                type="tel"
                placeholder="(555) 123-4567"
                value={store.phone}
                onChange={(e) => store.setPhone(e.target.value)}
                icon={<Phone className="w-4 h-4" />}
              />
            </>
          )}

          {step.id === "emergency" && (
            <>
              <h2 className="font-mohave text-heading text-text-primary">Emergency Contact</h2>
              <p className="font-kosugi text-body-sm text-text-secondary">
                Optional but recommended for field safety.
              </p>
              <Input
                placeholder="Contact Name"
                value={store.emergencyContactName}
                onChange={(e) => store.setEmergencyContact({
                  name: e.target.value,
                  phone: store.emergencyContactPhone,
                  relationship: store.emergencyContactRelationship,
                })}
                icon={<User className="w-4 h-4" />}
              />
              <Input
                type="tel"
                placeholder="Contact Phone"
                value={store.emergencyContactPhone}
                onChange={(e) => store.setEmergencyContact({
                  name: store.emergencyContactName,
                  phone: e.target.value,
                  relationship: store.emergencyContactRelationship,
                })}
                icon={<Phone className="w-4 h-4" />}
              />
              <select
                value={store.emergencyContactRelationship}
                onChange={(e) => store.setEmergencyContact({
                  name: store.emergencyContactName,
                  phone: store.emergencyContactPhone,
                  relationship: e.target.value,
                })}
                className="w-full bg-background-input border border-border rounded-lg px-3 py-2 font-kosugi text-body-sm text-text-primary focus:border-ops-accent focus:outline-none"
              >
                <option value="" className="text-text-disabled">Relationship</option>
                {RELATIONSHIP_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </>
          )}

          {step.id === "notifications" && (
            <>
              <h2 className="font-mohave text-heading text-text-primary">Notifications</h2>
              <p className="font-kosugi text-body-sm text-text-secondary">
                Choose how you'd like to be notified about schedule changes and updates.
              </p>
              <div className="space-y-3">
                <label className="flex items-center justify-between py-2 cursor-pointer">
                  <div className="flex items-center gap-3">
                    <Bell className="w-5 h-5 text-text-secondary" />
                    <div>
                      <p className="font-mohave text-body text-text-primary">Push Notifications</p>
                      <p className="font-kosugi text-[11px] text-text-disabled">Schedule changes, task assignments</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => store.setNotifications({ push: !store.pushEnabled, email: store.emailEnabled })}
                    className={cn(
                      "w-11 h-6 rounded-full transition-colors relative",
                      store.pushEnabled ? "bg-ops-accent" : "bg-background-elevated"
                    )}
                  >
                    <div className={cn(
                      "w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform",
                      store.pushEnabled ? "translate-x-[22px]" : "translate-x-0.5"
                    )} />
                  </button>
                </label>

                <label className="flex items-center justify-between py-2 cursor-pointer">
                  <div className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    <div>
                      <p className="font-mohave text-body text-text-primary">Email Notifications</p>
                      <p className="font-kosugi text-[11px] text-text-disabled">Weekly summaries, important alerts</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => store.setNotifications({ push: store.pushEnabled, email: !store.emailEnabled })}
                    className={cn(
                      "w-11 h-6 rounded-full transition-colors relative",
                      store.emailEnabled ? "bg-ops-accent" : "bg-background-elevated"
                    )}
                  >
                    <div className={cn(
                      "w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform",
                      store.emailEnabled ? "translate-x-[22px]" : "translate-x-0.5"
                    )} />
                  </button>
                </label>
              </div>
            </>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={currentStep === 0 || isSaving}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>

          <Button
            variant="primary"
            onClick={handleNext}
            disabled={!isStepValid() || isSaving}
            className="gap-2"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : currentStep === STEPS.length - 1 ? (
              <>
                Get Started
                <Check className="w-4 h-4" />
              </>
            ) : (
              <>
                Next
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add "src/app/(auth)/employee-setup/page.tsx"
git commit -m "feat: add employee setup 4-step onboarding wizard"
```

---

### Task 9: Admin Notification API — Role Needed

**Files:**
- Create: `src/app/api/notifications/role-needed/route.ts`
- Create: `src/lib/email/templates/role-needed.ts`

**Step 1: Create the role-needed email template**

```ts
// src/lib/email/templates/role-needed.ts
import { emailLayout, emailButton } from "./layout";

export function roleNeededTemplate(params: {
  userName: string;
  companyName: string;
  assignUrl: string;
  accentColor: string;
  logoUrl: string | null;
}): string {
  const body = `
    <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#e5e5e5;">
      New team member needs a role
    </h1>
    <p style="margin:0 0 24px 0;font-size:15px;color:#a7a7a7;line-height:1.5;">
      <strong style="color:#e5e5e5;">${params.userName}</strong> has joined
      ${params.companyName} and needs a role assigned.
      Until a role is assigned, they'll have limited access.
    </p>
    ${emailButton({ url: params.assignUrl, label: "Assign Role", accentColor: params.accentColor })}
    <p style="margin:24px 0 0 0;font-size:12px;color:#6b7280;line-height:1.5;">
      Go to Settings → Team to manage roles and permissions.
    </p>`;

  return emailLayout({
    companyName: params.companyName,
    accentColor: params.accentColor,
    logoUrl: params.logoUrl,
    body,
  });
}
```

**Step 2: Create the notification API endpoint**

This endpoint creates in-app notifications, sends emails, and sends push notifications to all users with `team.assign_roles` permission.

```ts
// src/app/api/notifications/role-needed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { roleNeededTemplate } from "@/lib/email/templates/role-needed";
import sgMail from "@sendgrid/mail";

export async function POST(req: NextRequest) {
  try {
    const { userId, userName, companyId } = await req.json();
    if (!userId || !userName || !companyId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = getServiceRoleClient();

    // Get company info
    const { data: company } = await db
      .from("companies")
      .select("name, logo_url")
      .eq("id", companyId)
      .maybeSingle();

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    // Find all users who have the team.assign_roles permission
    // Query: role_permissions where permission = 'team.assign_roles'
    //        → join user_roles to get users
    //        → filter by company_id
    const { data: rolePerms } = await db
      .from("role_permissions")
      .select("role_id")
      .eq("permission", "team.assign_roles");

    const roleIds = (rolePerms ?? []).map((rp) => rp.role_id);

    if (roleIds.length === 0) {
      return NextResponse.json({ success: true, notified: 0 });
    }

    const { data: userRoles } = await db
      .from("user_roles")
      .select("user_id")
      .in("role_id", roleIds);

    const adminUserIds = [...new Set((userRoles ?? []).map((ur) => ur.user_id))];

    if (adminUserIds.length === 0) {
      return NextResponse.json({ success: true, notified: 0 });
    }

    // Get admin user details (email, device_token)
    const { data: admins } = await db
      .from("users")
      .select("id, email, device_token")
      .in("id", adminUserIds)
      .eq("company_id", companyId)
      .is("deleted_at", null);

    if (!admins || admins.length === 0) {
      return NextResponse.json({ success: true, notified: 0 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";
    const assignUrl = `${appUrl}/settings?tab=team`;

    // 1. In-app notifications
    const notificationRows = admins.map((admin) => ({
      user_id: admin.id,
      company_id: companyId,
      type: "role_needed",
      title: `${userName} needs a role`,
      body: `${userName} joined ${company.name} and needs a role assigned.`,
      is_read: false,
      metadata: JSON.stringify({ targetUserId: userId }),
    }));

    await db.from("notifications").insert(notificationRows);

    // 2. Email notifications
    const sendgridKey = process.env.SENDGRID_API_KEY;
    if (sendgridKey) {
      sgMail.setApiKey(sendgridKey);
      const fromEmail = process.env.SENDGRID_FROM_EMAIL ?? "noreply@opsapp.co";

      const emailPromises = admins
        .filter((a) => a.email)
        .map((admin) => {
          const html = roleNeededTemplate({
            userName,
            companyName: company.name,
            assignUrl,
            accentColor: "#417394",
            logoUrl: company.logo_url,
          });

          return sgMail.send({
            to: admin.email!,
            from: { email: fromEmail, name: "OPS" },
            subject: `${userName} joined ${company.name} and needs a role`,
            html,
          });
        });

      await Promise.allSettled(emailPromises);
    }

    // 3. Push notifications (OneSignal)
    const oneSignalAppId = process.env.ONESIGNAL_APP_ID;
    const oneSignalApiKey = process.env.ONESIGNAL_REST_API_KEY;

    if (oneSignalAppId && oneSignalApiKey) {
      const deviceTokens = admins
        .map((a) => a.device_token)
        .filter((t): t is string => !!t);

      if (deviceTokens.length > 0) {
        try {
          await fetch("https://onesignal.com/api/v1/notifications", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Basic ${oneSignalApiKey}`,
            },
            body: JSON.stringify({
              app_id: oneSignalAppId,
              include_player_ids: deviceTokens,
              headings: { en: "New team member" },
              contents: { en: `${userName} joined and needs a role assigned.` },
              data: {
                type: "role_needed",
                userId,
                deepLink: `ops://settings/team?user=${userId}`,
              },
              ios_badgeType: "Increase",
              ios_badgeCount: 1,
            }),
          });
        } catch (pushErr) {
          console.error("[role-needed] Push notification failed:", pushErr);
        }
      }
    }

    return NextResponse.json({ success: true, notified: admins.length });
  } catch (err) {
    console.error("[role-needed] Error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
```

**Step 3: Commit**

```bash
git add src/app/api/notifications/role-needed/route.ts src/lib/email/templates/role-needed.ts
git commit -m "feat: add role-needed notification system (in-app, email, push)"
```

---

### Task 10: Update Notification Type + Service

**Files:**
- Modify: `src/lib/api/services/notification-service.ts:7` (expand type union)

**Step 1: Update AppNotification type to support role_needed**

Change line 7 from:

```ts
type: "mention";
```

to:

```ts
type: "mention" | "role_needed";
```

Also update the `fetchUnread` mapper (line 65):

```ts
type: row.type as "mention" | "role_needed",
```

**Step 2: Commit**

```bash
git add src/lib/api/services/notification-service.ts
git commit -m "feat: add role_needed notification type"
```

---

### Task 11: Unassigned Role Banner in Dashboard Layout

**Files:**
- Create: `src/components/ops/unassigned-role-banner.tsx`
- Modify: `src/components/layouts/dashboard-layout.tsx:108` (add banner before children)

**Step 1: Create the banner component**

```tsx
// src/components/ops/unassigned-role-banner.tsx
"use client";

import { AlertCircle } from "lucide-react";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { PRESET_ROLE_IDS } from "@/lib/types/permissions";

export function UnassignedRoleBanner() {
  const userRoleId = usePermissionStore((s) => s.roleId);

  // Only show if user has the Unassigned role
  if (userRoleId !== PRESET_ROLE_IDS.UNASSIGNED) return null;

  return (
    <div className="bg-ops-amber/10 border-b border-ops-amber/20 px-4 py-2 flex items-center gap-3">
      <AlertCircle className="w-4 h-4 text-ops-amber shrink-0" />
      <p className="font-kosugi text-[12px] text-ops-amber">
        Your admin hasn't assigned you a role yet. Some features may be limited.
      </p>
    </div>
  );
}
```

**Step 2: Add banner to dashboard layout**

In `src/components/layouts/dashboard-layout.tsx`, add import:

```ts
import { UnassignedRoleBanner } from "@/components/ops/unassigned-role-banner";
```

Then insert `<UnassignedRoleBanner />` right after `<ContentHeader />` and before the `<div className="flex-1 overflow-y-auto ...">`:

```tsx
<ContentHeader />
<UnassignedRoleBanner />
<div className="flex-1 overflow-y-auto overflow-x-auto p-3 relative z-[1]">
```

**Step 3: Verify permissions store exposes roleId**

Check that `src/lib/store/permissions-store.ts` exposes `roleId` in its state. If not, add a selector. The banner checks `roleId === PRESET_ROLE_IDS.UNASSIGNED` to decide whether to render.

**Step 4: Commit**

```bash
git add src/components/ops/unassigned-role-banner.tsx src/components/layouts/dashboard-layout.tsx
git commit -m "feat: add unassigned role banner to dashboard"
```

---

### Task 12: Update Middleware for New Routes

**Files:**
- Modify: `src/middleware.ts:5` (add `/join` to auth routes handling)
- Modify: `src/middleware.ts:22` (add `/employee-setup` to protected routes)

**Step 1: Add `/employee-setup` to protected routes**

`/employee-setup` requires auth (like `/setup`), so add it to `protectedPrefixes`:

```ts
const protectedPrefixes = [
  "/dashboard",
  "/projects",
  "/calendar",
  "/clients",
  "/job-board",
  "/team",
  "/map",
  "/pipeline",
  "/invoices",
  "/accounting",
  "/settings",
  "/admin",
  "/testing-grounds",
  "/setup",
  "/employee-setup",
];
```

**Step 2: `/join` stays public**

`/join` is NOT in `authRoutes` (we don't want authenticated users redirected away from it) and NOT in `protectedPrefixes` (it needs to be accessible without auth). It's already handled correctly since it's not in either list — public routes pass through.

However, we need special handling: authenticated users with a company should still be able to access `/join` but the page itself handles showing "already in a company" message. No middleware change needed for `/join`.

**Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: add /employee-setup to protected routes in middleware"
```

---

### Task 13: Update join-company API to Handle Missing Role Assignment

**Files:**
- Modify: `src/app/api/auth/join-company/route.ts:271-296` (add Unassigned role fallback)

**Step 1: Assign Unassigned role when no invitation role exists**

After the invitation handling block (line ~296), add fallback to assign the Unassigned role if no role was assigned through the invitation:

```ts
// After the invitation block, check if user has any role assigned
const { data: existingRole } = await db
  .from("user_roles")
  .select("role_id")
  .eq("user_id", userRow.id)
  .maybeSingle();

// If no role assigned (no invitation role, no existing role), assign Unassigned
if (!existingRole) {
  const { PRESET_ROLE_IDS } = await import("@/lib/types/permissions");
  await db.from("user_roles").upsert({
    user_id: userRow.id as string,
    role_id: PRESET_ROLE_IDS.UNASSIGNED,
    assigned_at: new Date().toISOString(),
    assigned_by: null,
  }, { onConflict: "user_id" });
}
```

**Step 2: Commit**

```bash
git add "src/app/api/auth/join-company/route.ts"
git commit -m "feat: assign Unassigned role as fallback when joining without invitation role"
```

---

### Task 14: Add sendRoleNeeded to SendGrid Service

**Files:**
- Modify: `src/lib/email/sendgrid.ts` (add import + export function)

**Step 1: Add role-needed template import and send function**

Add to imports:

```ts
import { roleNeededTemplate } from "./templates/role-needed";
```

Add function after `sendTeamInvite`:

```ts
export async function sendRoleNeeded(params: {
  email: string;
  userName: string;
  companyName: string;
  assignUrl: string;
  accentColor?: string;
  logoUrl?: string | null;
}): Promise<void> {
  ensureInitialized();

  const html = roleNeededTemplate({
    userName: params.userName,
    companyName: params.companyName,
    assignUrl: params.assignUrl,
    accentColor: params.accentColor ?? "#417394",
    logoUrl: params.logoUrl ?? null,
  });

  await sgMail.send({
    to: params.email,
    from: { email: getFromEmail(), name: "OPS" },
    subject: `${params.userName} joined ${params.companyName} and needs a role`,
    html,
  });
}
```

**Step 2: Commit**

```bash
git add src/lib/email/sendgrid.ts
git commit -m "feat: add sendRoleNeeded email function"
```

---

### Task 15: Update useSetupGate Hook for Employee Onboarding

**Files:**
- Modify: `src/hooks/useSetupGate.ts` (add employee_onboarding check)

**Step 1: Add employee onboarding step to the gate**

The current `useSetupGate` checks `identity` and `company`. For employees who join via invite, they skip the company step (they already have a company from joining). Add logic:

```ts
// src/hooks/useSetupGate.ts
"use client";

import { useAuthStore } from "@/lib/store/auth-store";

export function useSetupGate() {
  const { currentUser } = useAuthStore();

  const missingSteps: ("identity" | "company" | "employee_onboarding")[] = [];
  const progress = currentUser?.setupProgress;

  // Identity: skip if user already has first+last name (e.g. Bubble import)
  const hasIdentity =
    progress?.steps?.identity ||
    (currentUser?.firstName && currentUser?.lastName);
  if (!hasIdentity) missingSteps.push("identity");

  // Company: skip if user already belongs to a company (e.g. joined via invite)
  const hasCompany =
    progress?.steps?.company ||
    !!currentUser?.companyId;
  if (!hasCompany) missingSteps.push("company");

  // Employee onboarding: only required if user joined via invite (has company but no company setup step)
  // If they have a company but haven't done employee_onboarding and haven't done the company step
  // (meaning they joined via invite, not as company creator), they need employee onboarding
  const joinedViaInvite = !!currentUser?.companyId && !progress?.steps?.company;
  const needsEmployeeOnboarding = joinedViaInvite && !progress?.steps?.employee_onboarding;
  if (needsEmployeeOnboarding) missingSteps.push("employee_onboarding");

  return {
    isComplete: missingSteps.length === 0,
    missingSteps,
    needsEmployeeOnboarding,
  };
}
```

**Step 2: Commit**

```bash
git add src/hooks/useSetupGate.ts
git commit -m "feat: add employee onboarding check to setup gate"
```

---

### Task 16: Add Employee Onboarding Redirect in Dashboard Layout

**Files:**
- Modify: `src/components/layouts/dashboard-layout.tsx` (add redirect for incomplete employee onboarding)

**Step 1: Add setup gate check**

Import and use the setup gate to redirect users who need employee onboarding:

Add import:
```ts
import { useSetupGate } from "@/hooks/useSetupGate";
import { useRouter } from "next/navigation";
```

At the top of `DashboardLayout`, add:

```tsx
const { needsEmployeeOnboarding } = useSetupGate();
const router = useRouter();

useEffect(() => {
  if (needsEmployeeOnboarding) {
    router.push("/employee-setup");
  }
}, [needsEmployeeOnboarding, router]);
```

**Step 2: Commit**

```bash
git add src/components/layouts/dashboard-layout.tsx
git commit -m "feat: redirect to employee setup if onboarding incomplete"
```

---

### Task 17: Update Send-Invite API to Include Invite Code in Email

**Files:**
- Modify: `src/app/api/auth/send-invite/route.ts` (verify invite URL format)

**Step 1: Verify the invite email sends the correct join URL**

Check that `send-invite` generates the join URL correctly. The email should link to `/join?code=INVITE_CODE` where INVITE_CODE is the unique per-invitation code (not the company external_id).

Look at the existing `send-invite/route.ts` to verify it stores an `invite_code` field in `team_invitations` and passes it to the email template. If it currently uses `external_id`, update to generate a unique invite code per invitation and store it.

If the invite code field doesn't exist in team_invitations, the invite lookup API (Task 4) already handles fallback to company `external_id`. Verify this works end-to-end.

**Step 2: Commit (if changes needed)**

```bash
git add "src/app/api/auth/send-invite/route.ts"
git commit -m "fix: ensure invite email uses correct join URL format"
```

---

### Task 18: Integration Testing

**Step 1: Test the invite lookup API**

```bash
# Test with a valid company external_id (replace with real value)
curl http://localhost:3000/api/invites/YOUR_COMPANY_CODE
# Expected: { valid: true, companyName: "...", ... }

# Test with invalid code
curl http://localhost:3000/api/invites/invalid-code-123
# Expected: 404 { valid: false, error: "not_found" }
```

**Step 2: Test the join flow end-to-end**

1. Navigate to `/join?code=YOUR_COMPANY_CODE`
2. Verify company name and logo display
3. Sign up with a new account
4. Verify redirect to `/employee-setup`
5. Complete all 4 steps
6. Verify redirect to dashboard
7. If no role was pre-assigned, verify the amber "unassigned role" banner appears
8. Verify admin receives in-app notification

**Step 3: Test error states**

1. Navigate to `/join` with no code → "Invalid Invite" error
2. Navigate to `/join?code=expired-code` → "Invite Expired" error
3. Navigate to `/join?code=used-code` → "Invite Already Used" error
4. Already authenticated with company → "Already part of company" message

**Step 4: Test role assignment flow**

1. Admin navigates to Settings → Team
2. Finds the unassigned user
3. Assigns a role
4. User's banner disappears on next page load

---

### Task 19: Verify Build

**Step 1: Run the build**

```bash
cd /Users/jacksonsweet/Desktop/OPS\ LTD./OPS-Web && npm run build
```

Fix any TypeScript errors. Common issues to watch for:
- Missing imports (getIdToken, signInWithEmail)
- ImageUpload prop types
- Input component prop differences
- Notification type mismatches

**Step 2: Fix any errors and commit**

```bash
git add -A
git commit -m "fix: resolve build errors in employee join flow"
```

---

### Task 20: Final Review and Cleanup

**Step 1: Remove migration endpoint**

Delete `src/app/api/migrations/add-emergency-contact-and-unassigned-role/route.ts` (one-time use, SQL should already be run).

**Step 2: Final commit**

```bash
git add -A
git commit -m "chore: remove one-time migration endpoint, finalize employee join flow"
```
