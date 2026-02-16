# OPS Web — API Reference

> All requests go to `https://opsapp.co/version-test/api/1.1/`
> Auth: Bearer token via `Authorization` header (API token from `/wf/generate-api-token`)
> All deletes are soft deletes (PATCH with `deletedAt` timestamp)

---

## 1. Projects

**Service:** `src/lib/api/services/project-service.ts`
**Hooks:** `src/lib/hooks/use-projects.ts`

| Method | HTTP | Endpoint | Hook | Trigger |
|--------|------|----------|------|---------|
| `fetchProjects` | GET | `/obj/project` | `useProjects()` | Mount: Dashboard, Projects, Job Board, Pipeline, Map |
| `fetchUserProjects` | GET | `/obj/project` | `useUserProjects()` | Mount: filtered by userId in teamMembers |
| `fetchProject` | GET | `/obj/project/{id}` | `useProject(id)` | Mount: Project Detail page |
| `createProject` | POST | `/obj/project` | `useCreateProject()` | Form submit: CreateProjectModal, /projects/new |
| `updateProject` | PATCH | `/obj/project/{id}` | `useUpdateProject()` | Form submit: Project Detail edit |
| `updateProjectStatus` | PATCH | `/obj/project/{id}` | `useUpdateProjectStatus()` | Drag-drop: Pipeline, Job Board. Bulk action: Projects page |
| `deleteProject` | PATCH | `/obj/project/{id}` | `useDeleteProject()` | Button: Project Detail delete, Projects bulk delete |

**Query invalidation on mutation:**
- Create → invalidates project lists
- Update → invalidates project detail + lists (optimistic)
- Delete → invalidates all project caches (optimistic removal)

---

## 2. Tasks

**Service:** `src/lib/api/services/task-service.ts`
**Hooks:** `src/lib/hooks/use-tasks.ts`

| Method | HTTP | Endpoint | Hook | Trigger |
|--------|------|----------|------|---------|
| `fetchTasks` | GET | `/obj/task` | `useTasks()` | Mount: Dashboard (upcoming tasks) |
| `fetchProjectTasks` | GET | `/obj/task` | `useProjectTasks(projectId)` | Mount: Project Detail task list |
| `fetchTask` | GET | `/obj/task/{id}` | `useTask(id)` | Mount: task detail views |
| `createTask` | POST | `/obj/task` | `useCreateTask()` | Form submit: task creation |
| `createTaskWithEvent` | POST | `/obj/calendarevent` then `/obj/task` | `useCreateTaskWithEvent()` | Form submit: task with scheduled date (creates event first, links to task) |
| `updateTask` | PATCH | `/obj/task/{id}` | `useUpdateTask()` | Form submit: task edit |
| `updateTaskStatus` | PATCH | `/obj/task/{id}` | `useUpdateTaskStatus()` | Dropdown: task status change |
| `deleteTask` | PATCH | `/obj/task/{id}` + optionally `/obj/calendarevent/{id}` | `useDeleteTask()` | Button: task delete (also soft-deletes linked calendar event) |
| `reorderTasks` | PATCH | `/obj/task/{id}` (parallel) | `useReorderTasks()` | Drag: task list reorder (updates taskIndex on each) |

**Query invalidation on mutation:**
- Create → invalidates task lists + project lists
- Update → invalidates task detail + lists (optimistic)
- Status change → invalidates task lists + project lists (optimistic)
- Delete → invalidates task lists + calendar lists
- Reorder → invalidates task lists

---

## 3. Clients

**Service:** `src/lib/api/services/client-service.ts`
**Hooks:** `src/lib/hooks/use-clients.ts`

| Method | HTTP | Endpoint | Hook | Trigger |
|--------|------|----------|------|---------|
| `fetchClients` | GET | `/obj/client` | `useClients()` | Mount: Dashboard, Clients page, Pipeline |
| `fetchClient` | GET | `/obj/client/{id}` | `useClient(id)` | Mount: Client Detail page |
| `createClient` | POST | `/obj/client` | `useCreateClient()` | Form submit: CreateClientModal, /clients/new |
| `updateClient` | PATCH | `/obj/client/{id}` | `useUpdateClient()` | Form submit: Client Detail edit |
| `deleteClient` | PATCH | `/obj/client/{id}` | `useDeleteClient()` | Button: Client Detail delete |
| `fetchSubClients` | GET | `/obj/subclient` | `useSubClients(clientId)` | Mount: Client Detail contacts list |
| `createSubClient` | POST | `/obj/subclient` | `useCreateSubClient()` | Form submit: add contact on Client Detail |
| `updateSubClient` | PATCH | `/obj/subclient/{id}` | `useUpdateSubClient()` | Form submit: edit contact |
| `deleteSubClient` | PATCH | `/obj/subclient/{id}` | `useDeleteSubClient()` | Button: remove contact |

**Query invalidation on mutation:**
- Create client → invalidates client lists
- Update client → invalidates client detail + lists (optimistic)
- Delete client → invalidates all client caches
- SubClient mutations → invalidates sub-client list + parent client detail

---

## 4. Calendar Events

**Service:** `src/lib/api/services/calendar-service.ts`
**Hooks:** `src/lib/hooks/use-calendar.ts`

| Method | HTTP | Endpoint | Hook | Trigger |
|--------|------|----------|------|---------|
| `fetchEventsForDateRange` | GET | `/obj/calendarevent` | `useCalendarEventsForRange(start, end)` | Mount: Dashboard (current week), Calendar page (visible range) |
| `fetchCalendarEvents` | GET | `/obj/calendarevent` | `useCalendarEvents(options)` | Mount: filtered queries (by project, team member, etc.) |
| `fetchCalendarEvent` | GET | `/obj/calendarevent/{id}` | `useCalendarEvent(id)` | Mount: event detail |
| `createCalendarEvent` | POST | `/obj/calendarevent` | `useCreateCalendarEvent()` | Click: Calendar page create |
| `updateCalendarEvent` | PATCH | `/obj/calendarevent/{id}` | `useUpdateCalendarEvent()` | Form submit: Calendar event edit (optimistic) |
| `deleteCalendarEvent` | PATCH | `/obj/calendarevent/{id}` | `useDeleteCalendarEvent()` | Button: Calendar event delete |

**Query invalidation on mutation:**
- Create → invalidates calendar lists
- Update → invalidates calendar detail + lists (optimistic)
- Delete → invalidates calendar lists + task lists

---

## 5. Users / Team

**Service:** `src/lib/api/services/user-service.ts`
**Hooks:** `src/lib/hooks/use-users.ts`

| Method | HTTP | Endpoint | Hook | Trigger |
|--------|------|----------|------|---------|
| `fetchUsers` | GET | `/obj/user` | `useTeamMembers()` | Mount: Dashboard (crew status), Team page |
| `fetchUser` | GET | `/obj/user/{id}` | `useUser(id)` / `useCurrentUser()` | Mount: Settings Profile tab |
| `updateUser` | PATCH | `/obj/user/{id}` | `useUpdateUser()` | Form submit: Settings profile, photo upload callback |
| `updateUserRole` | PATCH | `/obj/user/{id}` | `useUpdateUserRole()` | Dropdown: Team page role change |
| `markTutorialCompleted` | PATCH | `/obj/user/{id}` | `useMarkTutorialCompleted()` | Button: tutorial completion |
| `sendInvite` | POST | `/wf/send_invite` | `useSendInvite()` | Form submit: Team page invite form |

**Auth-specific methods (called directly, not via hooks):**

| Method | HTTP | Endpoint | Called From |
|--------|------|----------|-------------|
| `loginWithGoogle` | POST | `/wf/login_google` | AuthProvider after Firebase Google sign-in |
| `loginWithToken` | POST | `/wf/generate-api-token` → GET `/obj/user/{id}` → GET `/obj/company/{id}` | Login page email/password submit (`useLogin()`) |
| `signup` | POST | `/wf/signup` | Register page form submit (`useSignup()`) + direct call after Firebase |
| `resetPassword` | POST | `/wf/reset_pw` | Login page forgot password (`useResetPassword()`) |
| `joinCompany` | POST | `/wf/join_company` | Onboarding company code entry (`useJoinCompany()`) |

**Query invalidation on mutation:**
- Update user → invalidates user detail, lists, current user (optimistic)
- Role change → invalidates user detail + lists
- Send invite → invalidates user lists

**Role detection order:** company.adminIds FIRST → employeeType → default to Field Crew

---

## 6. Company

**Service:** `src/lib/api/services/company-service.ts`
**Hooks:** `src/lib/hooks/use-company.ts`

| Method | HTTP | Endpoint | Hook | Trigger |
|--------|------|----------|------|---------|
| `fetchCompany` | GET | `/obj/company/{id}` | `useCompany()` / `useCompanyById(id)` | Mount: Settings page (all tabs) |
| `updateCompany` | PATCH | `/obj/company/{id}` | `useUpdateCompany()` | Form submit: Settings Company tab, logo upload callback |
| `updateDefaultProjectColor` | PATCH | `/obj/company/{id}` | `useUpdateDefaultProjectColor()` | Click: Settings color picker |
| `fetchSubscriptionInfo` | POST | `/wf/fetch_subscription_info` | `useSubscriptionInfo()` | Mount: Settings Subscription tab (staleTime: 30s) |
| `completeSubscription` | POST | `/wf/complete_subscription` | `useCompleteSubscription()` | Stripe payment flow completion |
| `cancelSubscription` | POST | `/wf/cancel_subscription` | `useCancelSubscription()` | Button: cancel subscription |
| `addSeatedEmployee` | PATCH | `/obj/company/{id}` | `useAddSeatedEmployee()` | Team management: add seat |
| `removeSeatedEmployee` | PATCH | `/obj/company/{id}` | `useRemoveSeatedEmployee()` | Team management: remove seat |

**S3 presigned URL methods:**

| Method | HTTP | Endpoint | Used By |
|--------|------|----------|---------|
| `getPresignedUrlProfile` | POST | `/wf/get_presigned_url_profile` | `useImageUpload()` — profile photo, company logo |
| `getPresignedUrlProject` | POST | `/wf/get_presigned_url` | `useImageUpload()` — project images |
| `registerProjectImages` | POST | `/wf/upload_project_images` | After S3 upload — registers URLs with Bubble |

**Query invalidation on mutation:**
- Update company → invalidates company detail (optimistic)
- Subscription changes → invalidates company + subscription caches

---

## 7. Task Types

**Service:** `src/lib/api/services/task-type-service.ts`
**Hooks:** `src/lib/hooks/use-task-types.ts`

| Method | HTTP | Endpoint | Hook | Trigger |
|--------|------|----------|------|---------|
| `fetchTaskTypes` | GET | `/obj/tasktype` | `useTaskTypes()` | Mount: task creation forms (type dropdown) |
| `fetchTaskType` | GET | `/obj/tasktype/{id}` | `useTaskType(id)` | Mount: task type detail |
| `createTaskType` | POST | `/obj/tasktype` | `useCreateTaskType()` | Form submit: admin settings |
| `updateTaskType` | PATCH | `/obj/tasktype/{id}` | `useUpdateTaskType()` | Form submit: admin settings (optimistic) |
| `deleteTaskType` | PATCH | `/obj/tasktype/{id}` | `useDeleteTaskType()` | Button: admin settings |
| `createDefaultTaskTypes` | POST | `/obj/tasktype` (×6) | `useCreateDefaultTaskTypes()` | Auto: company onboarding setup |

**Default types created:** Quote, Installation, Repair, Inspection, Consultation, Follow-up

---

## 8. Image Upload

**Service:** `src/lib/api/services/image-service.ts`
**Hooks:** `src/lib/hooks/use-image-upload.ts`

| Method | HTTP | Endpoint | Hook | Trigger |
|--------|------|----------|------|---------|
| `uploadImage` | POST → PUT | `/wf/get_upload_url` → S3 presigned PUT | `useImageUpload()` | Click: Settings profile photo, company logo |
| `uploadMultipleImages` | POST → PUT | `/wf/get_upload_url` → S3 (parallel) | `useMultiImageUpload()` | Click: project image gallery |

**Upload flow:** Get presigned URL from Bubble → compress image client-side (Canvas API) → PUT to S3 → return S3 URL → pass to update mutation

---

## How Syncing Works

### TanStack Query Cache Strategy

All data fetching uses TanStack Query v5 with these defaults:

| Setting | Value | Purpose |
|---------|-------|---------|
| `staleTime` | 5 minutes | Data considered fresh for 5min — no refetch on mount |
| `gcTime` | 30 minutes | Unused cache entries garbage collected after 30min |
| `refetchOnWindowFocus` | true | Refetches stale queries when user returns to tab |
| `refetchOnReconnect` | true | Refetches stale queries when internet reconnects |
| `retry` | 1 | One retry on failure |

### When Data Syncs

1. **On page mount** — if cached data is stale (>5min old), TanStack Query refetches in background while showing cached data immediately
2. **On window focus** — user switches back to the OPS tab → stale queries refetch automatically
3. **On reconnect** — browser comes back online → stale queries refetch
4. **After mutations** — every create/update/delete mutation calls `queryClient.invalidateQueries()` on related query keys, forcing immediate refetch
5. **Manual sync** — Command palette "Sync Data" action calls `queryClient.invalidateQueries()` on ALL queries
6. **Optimistic updates** — update/delete mutations immediately update the local cache before the API call completes. On error, they roll back to the previous state

### Sync Status Indicator (Top Bar)

The top bar shows real-time sync status:

| State | Condition | Icon |
|-------|-----------|------|
| **Synced** | `isFetching === 0` and `isMutating === 0` and online | Checkmark |
| **Syncing** | `isFetching > 0` and online | Spinning arrow |
| **Pending** | `isMutating > 0` and online | Clock |
| **Offline** | `navigator.onLine === false` | WifiOff |

### Connectivity Monitoring

`useConnectivity()` hook listens to browser `online`/`offline` events:
- **Goes offline** → persistent error toast: "No internet connection"
- **Comes back online** → success toast: "Back online" → TanStack auto-refetches stale queries

### Global 401 Handling

If any API call returns a 401 (BubbleUnauthorizedError):
1. Clears `ops-auth-token` and `__session` cookies
2. Clears auth store (Zustand)
3. Signs out of Firebase
4. Redirects to `/login` via `window.location.href`

### Rate Limiting

The Bubble API client includes rate limiting:
- Tracks request timestamps in a sliding window
- Delays requests if approaching Bubble's rate limit
- Retries on 429 responses with exponential backoff

---

## Query Key Structure

```
projects.lists       → all project list queries
projects.detail(id)  → single project by ID
tasks.lists          → all task list queries
tasks.detail(id)     → single task by ID
clients.lists        → all client list queries
clients.detail(id)   → single client by ID
calendar.lists       → all calendar event list queries
calendar.detail(id)  → single calendar event by ID
users.lists          → all user/team list queries
users.detail(id)     → single user by ID
users.current        → current logged-in user
company.detail(id)   → company by ID
company.subscription → subscription info
taskTypes.all        → all task types
taskTypes.detail(id) → single task type by ID
```
