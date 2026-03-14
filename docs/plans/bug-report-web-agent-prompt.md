# OPS-Web Agent Prompt: Web Bug Reporting Widget

## Your Task

Build an in-app bug reporting widget for OPS-Web. The widget is a floating button that opens a compact report form. The user types a description, picks a category, and submits. Everything else — browser info, console logs, breadcrumbs, network log, state snapshot, and a screenshot — is auto-captured.

Reports go to the Supabase `bug_reports` table. An admin panel already exists at `/bug-reports` to triage them.

## Supabase Table: `bug_reports`

Already exists. Key columns for web reports:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | Auto-generated |
| `company_id` | text | From auth store |
| `reporter_id` | text | Current user's account_holder_id |
| `description` | text | User-written |
| `category` | text | `bug`, `ui_issue`, `crash`, `feature_request`, `other` |
| `platform` | text | Always `web` |
| `app_version` | text | App version string (see sidebar for current version) |
| `os_name` | text | From `navigator.userAgent` parsing |
| `os_version` | text | From `navigator.userAgent` parsing |
| `browser` | text | e.g. `Chrome`, `Safari`, `Firefox` |
| `browser_version` | text | e.g. `122.0` |
| `viewport_width` | int | `window.innerWidth` |
| `viewport_height` | int | `window.innerHeight` |
| `screen_name` | text | Current page name from pathname |
| `url` | text | `window.location.href` |
| `network_type` | text | From `navigator.connection.effectiveType` if available |
| `console_logs` | jsonb | Array of intercepted console entries |
| `breadcrumbs` | jsonb | Array of user action breadcrumbs |
| `network_log` | jsonb | Array of recent fetch/XHR requests |
| `state_snapshot` | jsonb | Relevant Zustand store snapshots |
| `custom_metadata` | jsonb | Extra context |
| `screenshot_url` | text | After upload to `bug-reports` bucket |
| `reporter_name` | text | User's display name |
| `reporter_email` | text | User's email |
| `priority` | text | Default: `none` |
| `status` | text | Default: `new` |

**Storage bucket:** `bug-reports` (exists). Upload path: `{companyId}/{reportId}/screenshot.jpg`

## Architecture

### 1. Bug Report Context Service (`src/lib/services/bug-report-context.ts`)

A singleton that continuously captures context in the background. Initialize once in the app's root provider.

**Console Interceptor**
- Monkey-patch `console.log`, `console.warn`, `console.error`, `console.info`
- Keep a rolling buffer of the last 100 entries
- Each: `{ timestamp: string, level: "log"|"warn"|"error"|"info", message: string, stack?: string }`
- For errors, capture the stack trace
- Restore original console methods on cleanup

**Breadcrumb Tracker**
- Track: route changes (Next.js pathname), clicks (element tag + text content + closest `data-testid`), form submissions
- Keep last 50 breadcrumbs
- Each: `{ timestamp: string, type: "navigation"|"click"|"input"|"custom", label: string, metadata?: Record<string, unknown> }`
- Listen to `click` events on `document` (delegated)
- Listen to Next.js router events or `pathname` changes

**Network Logger**
- Intercept `fetch` by wrapping `window.fetch`
- Record last 30 requests
- Each: `{ timestamp: string, method: string, url: string, status: number, durationMs: number, requestSize?: number, responseSize?: number }`
- Strip Authorization and Cookie header values — log header names only
- Do NOT log request/response bodies

**State Snapshot**
- At report time, snapshot relevant Zustand stores: `useAuthStore` (user id, role, company id — NOT tokens), `useSidebarStore`, current pathname
- Exclude sensitive fields (tokens, passwords, full user objects)

**Screenshot**
- Use `html2canvas` (already common, zero-config) OR the simpler approach: `document.documentElement` → canvas → blob
- If `html2canvas` is not in deps, use the `toDataURL` approach or add it
- Capture at report-submit time
- Convert to JPEG blob at 0.7 quality

### 2. Floating Report Button (`src/components/ops/bug-report-widget.tsx`)

**Position:** Fixed, bottom-right, above the FAB if present. Use `z-[40]` (below sidebar `z-[45]`).

**Collapsed state:** Small circular button with `Bug` icon from lucide-react. Subtle — `rgba(255,255,255,0.06)` background, border `rgba(255,255,255,0.1)`. Tooltip on hover: "Report a Bug".

**Expanded state (on click):** Expands into a compact panel (320px wide, max 400px tall):
- Frosted glass surface: `rgba(10,10,10,0.85)` + `backdrop-blur(20px)` + border `rgba(255,255,255,0.12)`
- Header: "Report a Bug" — Mohave, text-primary
- Screenshot preview (small thumbnail, captured on open)
- Description textarea — 3 rows, placeholder "What went wrong?"
- Category picker — 5 buttons in a row (Bug, UI, Crash, Feature, Other), styled like SegmentedPicker
- Submit button — full width, accent background
- Cancel link — text-tertiary, below submit
- Animation: scale from button origin, 200ms, `ease-out`

### 3. Submission Flow

1. User clicks submit
2. Show loading state on button
3. Insert row into `bug_reports` via Supabase (using existing `BugReportService.createReport`)
4. Upload screenshot to storage bucket (using `BugReportService.uploadScreenshot`)
5. Update the row with `screenshot_url`
6. Show success toast via `sonner`
7. Collapse widget back to button state
8. On error: show inline error message with retry button

### 4. Integration Point

Add the `<BugReportWidget />` component to the dashboard layout (`src/components/layouts/dashboard-layout.tsx`) so it appears on every authenticated page.

Initialize the context service in the app's root provider or in the dashboard layout's `useEffect`.

## Existing Code to Use

- **Service:** `src/lib/api/services/bug-report-service.ts` — already has `createReport`, `uploadScreenshot`
- **Hooks:** `src/lib/hooks/use-bug-reports.ts` — already has `useCreateBugReport`
- **Auth:** `useAuthStore` for current user and company
- **Toast:** `import { toast } from "sonner"`
- **Icons:** `Bug` from `lucide-react`
- **i18n:** `src/i18n/dictionaries/en/bug-reports.json` exists but may need new keys for the widget
- **Design system:** `.interface-design/system.md` — follow it for all styling

## Design System Compliance

- Background: frosted glass (`rgba(10,10,10,0.85)` + backdrop-blur)
- Border: `1px solid rgba(255,255,255,0.12)`
- Border radius: 4px (panel), full (button)
- Fonts: Mohave for all text, Kosugi for section labels
- Colors: monochromatic. Accent `#597794` only on submit button
- Text alignment: LEFT only
- Animation: `ease-out`, 200ms transitions, no spring/bounce

## What NOT to Do

- Do NOT use third-party bug reporting libraries (no Sentry, no LogRocket, no BugSnag)
- Do NOT capture form input values in breadcrumbs (only element tag + class/testid)
- Do NOT log request/response bodies in network logger
- Do NOT include auth tokens or passwords in state snapshots
- Do NOT make the widget visually prominent — it should be subtle and unobtrusive

## Success Criteria

- Widget appears on every authenticated page
- Auto-captures console logs, breadcrumbs, network requests, and state
- Screenshot is captured when the widget opens
- Report submission takes under 5 seconds of user interaction
- Reports appear in the admin panel immediately
- No third-party dependencies added (except html2canvas if needed for screenshots)
- Widget follows the OPS design system precisely
