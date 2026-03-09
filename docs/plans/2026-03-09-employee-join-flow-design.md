# Employee Join Flow — Design

**Date:** 2026-03-09
**Status:** Approved

## Problem

Invite emails link to `/join?code=xxx` but the page doesn't exist. The backend (invite storage, join-company API, role assignment) is mostly complete. The missing pieces are the join page, employee onboarding, role-less user handling, and admin notifications.

## Architecture

```
Invite email → /join?code=xxx
  → Fetch invite details (company name, role, validity)
  → Sign up or Log in (Firebase)
  → POST /api/auth/join-company (existing)
  → Redirect to /employee-setup
    → 4 steps (profile, phone, emergency contact, notifications)
    → Dashboard
      → If no role assigned: banner + notify admins
```

## 1. `/join` Page

Route: `src/app/(auth)/join/page.tsx`

- Reads `?code=` from URL
- Calls `GET /api/invites/[code]` — returns company name, logo, invited role name, validity status
- Displays: company logo, "You've been invited to join [Company Name]", role if pre-assigned
- Auth: Google, Apple, Email sign-up — same providers as `/register`. "Already have an account? Log in" link
- After auth: calls `POST /api/auth/join-company` with invite code (existing endpoint handles role assignment + invitation status update), then redirects to `/employee-setup`
- Error states: expired invite, already used, invalid code — each with messaging and "Contact your company admin" fallback

### New API: `GET /api/invites/[code]/route.ts`

Public endpoint (no auth required) that returns:
```ts
{
  valid: boolean;
  companyName: string;
  companyLogo: string | null;
  roleName: string | null;
  error?: "expired" | "used" | "not_found";
}
```

Looks up `team_invitations` by invite_code, joins company and role tables.

## 2. Employee Onboarding (`/employee-setup`)

Route: `src/app/(auth)/employee-setup/page.tsx`

Requires auth (redirect to `/join` or `/login` if not authenticated). Only accessible to users who haven't completed employee onboarding (check `setup_progress` JSON field on user).

### Steps

1. **Profile** — Photo upload + first/last name confirmation (pre-filled from auth provider if available)
2. **Phone** — Phone number input
3. **Emergency Contact** — Name, phone number, relationship (dropdown: Spouse, Parent, Sibling, Partner, Friend, Other)
4. **Notifications** — Push + email toggles (uses existing notification preferences system)

### Completion

- Updates user's `setup_progress` to mark employee onboarding complete
- Redirects to `/` (dashboard)
- If user has no assigned role (has "Unassigned" preset role), show persistent banner

## 3. Database Changes

### Migration: `add_emergency_contact_and_unassigned_role.sql`

**Users table** — add columns:
```sql
ALTER TABLE users
  ADD COLUMN emergency_contact_name TEXT,
  ADD COLUMN emergency_contact_phone TEXT,
  ADD COLUMN emergency_contact_relationship TEXT;
```

**Roles table** — add "Unassigned" preset role:
```sql
INSERT INTO roles (id, company_id, name, description, hierarchy, is_preset, is_system)
VALUES (
  gen_random_uuid(),
  NULL,
  'Unassigned',
  'Default role for users who have not been assigned a role. Read-only access to own assignments.',
  99,
  true,
  true
);
```

With minimal permissions:
- `projects.view` (scope: assigned)
- `tasks.view` (scope: assigned)
- `schedule.view` (scope: own)
- `profile.edit` (scope: own)

## 4. Role-less User Handling

### On Join Without Pre-assigned Role

1. User gets "Unassigned" preset role via `user_roles` table
2. Three notifications fire to all company users with `team.assign_roles` permission:
   - **In-app notification** — stored in notifications system, shown in bell icon
   - **Email** — via SendGrid: "[User Name] joined [Company] and needs a role assigned"
   - **Push notification** — with deep link payload for iOS: `ops://settings/team?user=[userId]`

### In-App Banner

Dashboard shows a persistent, non-dismissible banner for users with "Unassigned" role:

> "Your admin hasn't assigned you a role yet. Some features may be limited."

Banner auto-removes when user_roles is updated to a real role. Check on each dashboard render.

## 5. User Model Updates

Add to TypeScript `User` interface:
```ts
emergencyContactName: string | null;
emergencyContactPhone: string | null;
emergencyContactRelationship: string | null;
```

Update `user-service.ts` mapFromDb/mapToDb functions.

## 6. Middleware / Route Protection

- `/employee-setup` — requires auth, accessible only during onboarding
- `/join` — public page, but if already authenticated + already in a company, show "You're already part of [Company]" with option to go to dashboard
- Existing dashboard middleware should check if employee onboarding is complete and redirect to `/employee-setup` if not

## 7. Out of Scope

- In-app guided feature tour (separate effort, happens post-onboarding inside the app)
- Company switching (users can only belong to one company)
- Bulk invite status tracking UI
