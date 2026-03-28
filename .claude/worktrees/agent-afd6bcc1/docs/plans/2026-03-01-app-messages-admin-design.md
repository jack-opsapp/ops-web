# App Messages Admin Panel — Design

## Context

The iOS app has a fully built app message system that reads from the Supabase `app_messages` table. Messages can block the app (non-dismissable) or show as overlays (dismissable). Currently the admin panel has a read-only display in the Feedback tab. This feature adds full CRUD management on a dedicated admin page.

## Data Model

Supabase table: `app_messages`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| active | Boolean | Controls visibility |
| title | Text | Message heading (required) |
| body | Text | Message content (required) |
| message_type | String | mandatory_update, optional_update, maintenance, announcement, info |
| dismissable | Boolean | If false, blocks app |
| target_user_types | Text[] | ["admin", "officeCrew", "fieldCrew"] or empty for all |
| app_store_url | Text | App Store link for update messages |
| created_at | Timestamp | Auto-generated |

## Architecture Decisions

- **Dedicated page** at `/admin/app-messages` with sidebar entry
- **One active message at a time** — activating a new message auto-deactivates all others
- **No live preview** — just the form fields
- **Safety confirmation** required when activating a non-dismissable message (blocks users)

## Page Layout

1. Header row: "App Messages" title + "Create Message" button
2. Messages table: Status badge, Title, Type, Target, Dismissable, Created. Row click opens edit sheet.
3. Create/Edit Sheet with fields: Title, Body, Message Type dropdown, Dismissable toggle, Target User Types multi-select, App Store URL (conditional), Active toggle
4. AlertDialog confirmation when activating non-dismissable messages

## API Routes

| Route | Method | Action |
|-------|--------|--------|
| `/api/admin/app-messages` | GET | List all |
| `/api/admin/app-messages` | POST | Create |
| `/api/admin/app-messages/[id]` | PUT | Update |
| `/api/admin/app-messages/[id]` | DELETE | Delete |

All routes use existing `requireAdmin` auth pattern.

## Auto-Deactivation

When setting active=true, the API deactivates all other messages first (single transaction).

## Files

- `src/app/admin/app-messages/page.tsx` — Server page
- `src/app/admin/app-messages/_components/app-messages-content.tsx` — Client CRUD component
- `src/app/api/admin/app-messages/route.ts` — GET + POST
- `src/app/api/admin/app-messages/[id]/route.ts` — PUT + DELETE
- `src/lib/admin/types.ts` — Expand AppMessage type
- `src/lib/admin/admin-queries.ts` — Add mutation functions
- `src/app/admin/_components/sidebar.tsx` — Add nav entry
