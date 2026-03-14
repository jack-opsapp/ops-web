# iOS Agent Prompt: Shake-to-Report Bug Reporting

## Your Task

Build a shake-to-report bug reporting system in the OPS iOS app. When the user shakes their device, a bug report sheet slides up. The user types a short description, selects a category, and hits submit. Everything else is auto-captured behind the scenes — device info, console logs, breadcrumbs, network log, state snapshot, and a screenshot taken at the moment of shake.

Reports are submitted to the Supabase `bug_reports` table. Screenshots are uploaded to AWS S3. An admin panel already exists on the web side to triage these reports.

## Supabase Table: `bug_reports`

The table already exists. Key columns you'll be inserting into:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | Auto-generated |
| `company_id` | text | From current user's company |
| `reporter_id` | text | Current user's ID |
| `description` | text | User-written description |
| `category` | text | One of: `bug`, `ui_issue`, `crash`, `feature_request`, `other` |
| `platform` | text | Always `ios` for this agent |
| `app_version` | text | Bundle short version string |
| `build_number` | text | Bundle version |
| `os_name` | text | Always `iOS` |
| `os_version` | text | e.g. `18.3` |
| `device_model` | text | e.g. `iPhone16,1` |
| `screen_name` | text | Current view/screen name (see §Screen Name Tracking) |
| `network_type` | text | wifi/cellular/none |
| `battery_level` | real | 0.0-1.0 |
| `free_disk_mb` | real | Available disk in MB |
| `free_ram_mb` | real | Available RAM in MB |
| `console_logs` | jsonb | Array of recent console log entries |
| `breadcrumbs` | jsonb | Array of user action breadcrumbs |
| `network_log` | jsonb | Array of recent network requests |
| `state_snapshot` | jsonb | Current app state snapshot |
| `custom_metadata` | jsonb | Any extra context |
| `screenshot_url` | text | S3 URL after uploading screenshot |
| `additional_attachments` | jsonb | Array of additional attachment URLs |
| `reporter_name` | text | User's display name |
| `reporter_email` | text | User's email |
| `priority` | text | Default: `none` (admin sets this later) |
| `status` | text | Default: `new` |

**Web-only columns (set to null):** `browser`, `browser_version`, `viewport_width`, `viewport_height`, `url`. These exist on the table for web reports — do NOT try to populate them from iOS.

## Architecture Requirements

### 1. Shake Detection — UIWindow Subclass

**You MUST use a UIWindow subclass**, not a SwiftUI modifier. A modifier would require attachment to every view — the UIWindow approach catches shakes globally from any screen with zero per-view wiring.

```swift
class ShakeDetectingWindow: UIWindow {
    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        super.motionEnded(motion, with: event)
        if motion == .motionShake {
            NotificationCenter.default.post(name: .deviceDidShake, object: nil)
        }
    }
}
```

- Register `ShakeDetectingWindow` in the app's `@main` struct (or `SceneDelegate` if applicable)
- Listen for the `.deviceDidShake` notification in a top-level view (ContentView) to trigger the bug report sheet
- **Debounce:** Ignore shakes within 3 seconds of last trigger
- **Tutorial guard:** Do NOT trigger when `TutorialStateManager.isActive == true`. The tutorial state manager is an `@EnvironmentObject` — you can access it from wherever you listen for shakes. Check the current pattern in `OPS/OPS/Tutorial/State/TutorialStateManager.swift`.

### 2. Auto-Capture Service (`BugReportCaptureService`)

Build a singleton service (`static let shared`) that continuously collects context so it's ready at shake-time. Follow the existing service pattern: `@MainActor`, `static let shared`, `private init()`.

**Console Log Buffer — Extend DebugLogger**
- The app already has `DebugLogger` at `OPS/OPS/Utilities/DebugLogger.swift` — it's a singleton with print-based logging
- Add a rolling buffer (last 100 entries) to `DebugLogger` and a structured `log(_ message:level:category:)` method
- Each entry: `{ timestamp: String, level: String, message: String, category: String }`
- Migrate existing `print("[TAG] ...")` calls throughout the codebase to use the new `DebugLogger.shared.log()` method where feasible, but at minimum ensure all service-level logging flows through it
- Do NOT try to intercept `os_log` at runtime — it cannot be hooked. Do NOT redirect stdout via `freopen` — it's fragile and breaks Xcode console

**Breadcrumb Tracker**
- Record user actions: screen views, button taps, navigation events, sheet presentations
- Keep last 50 breadcrumbs
- Each: `{ timestamp: String, type: String, label: String, metadata: [String: String]? }`
- For screen views: hook into the screen name tracking system (see §Screen Name Tracking below) so that every screen change becomes a breadcrumb automatically
- For button taps: provide a `.breadcrumb("tapped_save")` ViewModifier that views can opt into
- For sheet presentations: record when sheets open/close

**Network Logger — Repository-Layer Instrumentation**
- Do NOT use `URLProtocol` interception. Supabase-swift manages its own URLSession internally, and `URLProtocol` doesn't reliably intercept `async/await` URLSession calls.
- Instead, add logging at the **repository layer**. The app has 60+ repository files in `OPS/OPS/Network/Supabase/Repositories/`. Add a lightweight wrapper/hook that records metadata before and after each Supabase call.
- Alternatively, add a `logNetworkCall(method:url:statusCode:durationMs:)` method on the capture service and call it from key repositories.
- Record last 30 requests
- Each: `{ timestamp: String, method: String, url: String, statusCode: Int, durationMs: Int, requestSize: Int?, responseSize: Int? }`
- Strip sensitive headers — log only header names, not values. Do NOT log request/response bodies.

**State Snapshot**
- Capture current app state at shake-time from `AppState` and `DataController`
- Include: `currentScreenName`, logged-in user role, `activeProjectID`, `activeTaskID`, connection status (from `ConnectivityMonitor`), pending sync count (from `SyncQueue.pendingCount`)
- Access pattern: `AppState` is an `@EnvironmentObject`. `DataController` is also an `@EnvironmentObject`. `SyncQueue` is accessible via the sync engine.
- Do NOT include sensitive data (passwords, Firebase tokens, full user records)

**Screenshot**
- Capture the current screen as a UIImage at shake-time using `UIApplication.shared.connectedScenes` → `UIWindowScene` → render the key window's layer
- Convert to JPEG at 0.7 quality
- Show the screenshot in the report sheet so the user can see what was captured

### 3. Screen Name Tracking

The app does NOT currently track the current screen by name. You must add this.

**Implementation:** Add a `@Published var currentScreenName: String` property to `AppState` (at `OPS/OPS/AppState.swift`). Set it via a reusable `.onAppear` ViewModifier that updates `AppState.currentScreenName`.

Create a modifier like:
```swift
extension View {
    func trackScreen(_ name: String) -> some View {
        self.onAppear {
            // Update AppState.currentScreenName
        }
    }
}
```

Apply `.trackScreen("Home")`, `.trackScreen("JobBoard")`, `.trackScreen("Schedule")`, etc. to the top-level body of each main screen view. Reference the app's tab structure in `ContentView.swift` to identify all screens.

This feeds into both the `screen_name` column in bug reports AND the breadcrumb tracker.

### 4. Bug Report Sheet UI

When shake is detected:
1. Capture screenshot immediately (before showing sheet)
2. Present a sheet via a `@Published var showingBugReport: Bool` on `AppState`, attached as a `.sheet()` on `ContentView` (same pattern as `showingGlobalCompletionChecklist` at ContentView.swift:425)
3. Sheet contents:
   - Screenshot preview (small, tappable to enlarge in a fullscreen overlay)
   - Description text field (multi-line, placeholder: "What went wrong?")
   - Category picker (segmented style): Bug, UI Issue, Crash, Feature Request, Other
   - Submit button
   - Cancel button
4. Use `OPSStyle` design tokens — reference `OPS/OPS/Styles/OPSStyle.swift`:
   - Background: `OPSStyle.Colors.cardBackgroundDark`
   - Text: `OPSStyle.Colors.primaryText`, `OPSStyle.Colors.secondaryText`
   - Accent: `OPSStyle.Colors.primaryAccent`
   - Typography: `OPSStyle.Typography.*` (do NOT use raw font names — use the tokens)
   - Borders: `OPSStyle.Colors.cardBorder`
   - Spacing: `OPSStyle.Layout.spacing*`
   - Corner radius: `OPSStyle.Layout.cornerRadius`
5. The sheet should be minimal — the user should be in and out in under 10 seconds

### 5. Submission Flow — S3 for Screenshots

**All images in the iOS app are stored on AWS S3. Never use Supabase Storage.**

The upload pattern is in `OPS/OPS/Network/S3UploadService.swift`. Follow the existing pattern:

1. Insert the bug report row into Supabase via `SupabaseService.shared.client` (the Supabase client uses Firebase JWT auth — see `OPS/OPS/Network/Supabase/SupabaseService.swift`)
2. Upload screenshot to S3 using `S3UploadService.shared`. Add a new method:
   ```swift
   func uploadBugReportScreenshot(_ image: UIImage, reportId: String, companyId: String) async throws -> String
   ```
   - S3 object key: `company-{companyId}/bug-reports/{reportId}/screenshot.jpg`
   - JPEG quality: 0.7
   - Follow the existing `uploadToS3(imageData:objectKey:)` private method pattern
3. Update the bug report row with the `screenshot_url` (the full S3 URL returned by the upload)
4. Show success confirmation (brief toast or checkmark animation)
5. Dismiss the sheet

### 6. Offline Queueing

Do NOT integrate with `SyncEngine`/`SyncQueue` — the sync queue is SwiftData-backed and purpose-built for entity CRUD operations with coalescing. Bug reports are fire-and-forget, not entity syncs.

Instead, build a lightweight standalone queue:
- Use a simple `[BugReportPayload]` array persisted to a JSON file in the app's documents directory (not UserDefaults — reports with screenshots can be large)
- On connectivity restoration (observe `ConnectivityMonitor.isConnected`), drain the queue
- Store the screenshot as a temporary file alongside the JSON, upload it when draining
- Delete queued items after successful submission
- Cap the offline queue at 10 reports to prevent unbounded disk usage

### 7. Supabase Client Access Pattern

The app uses Firebase Auth with Supabase. The Supabase client is accessed via:
```swift
SupabaseService.shared.client
```
This client auto-attaches the Firebase JWT via its `accessToken` callback. See `OPS/OPS/Network/Supabase/SupabaseService.swift` for the full pattern.

For inserting the bug report:
```swift
try await SupabaseService.shared.client
    .from("bug_reports")
    .insert(reportPayload)
    .execute()
```

Follow the repository pattern in `OPS/OPS/Network/Supabase/Repositories/` for examples of structured Supabase calls.

## What NOT to Do

- Do NOT use any third-party bug reporting SDKs (no Instabug, no Sentry, no Firebase Crashlytics)
- Do NOT capture keystrokes or text input content in breadcrumbs
- Do NOT log full request/response bodies in the network log — only metadata
- Do NOT store auth tokens, passwords, or PII in state snapshots
- Do NOT use Supabase Storage for image uploads — all images go to S3
- Do NOT use `URLProtocol` for network interception — use repository-layer instrumentation
- Do NOT try to intercept `os_log` or redirect stdout — extend `DebugLogger` instead
- Do NOT integrate with `SyncEngine`/`SyncQueue` for offline queueing — use a standalone lightweight queue
- Do NOT use raw font names — use `OPSStyle.Typography.*` tokens

## Files to Reference

| File | What to learn from it |
|------|----------------------|
| `OPS/OPS/Styles/OPSStyle.swift` | Design tokens (colors, typography, layout, icons) |
| `OPS/OPS/AppState.swift` | Global app state, sheet presentation pattern (add `showingBugReport` and `currentScreenName` here) |
| `OPS/OPS/ContentView.swift` | Global sheet attachment point (line ~425 shows the pattern) |
| `OPS/OPS/Network/Supabase/SupabaseService.swift` | Supabase client access (Firebase JWT bridge) |
| `OPS/OPS/Network/S3UploadService.swift` | S3 upload pattern (add `uploadBugReportScreenshot` method here) |
| `OPS/OPS/Network/Supabase/Repositories/` | Repository pattern for Supabase calls |
| `OPS/OPS/Utilities/DebugLogger.swift` | Existing logger to extend with rolling buffer |
| `OPS/OPS/Services/` | Singleton service pattern (`static let shared`, `@MainActor`) |
| `OPS/OPS/Tutorial/State/TutorialStateManager.swift` | Tutorial active state check (`isActive` property) |
| `OPS/OPS/Network/Sync/SyncQueue.swift` | Reference only — do NOT use for bug reports |
| `OPS/OPS/Network/ConnectivityMonitor.swift` | Network state observation for offline queueing |

## Success Criteria

- Shake from any screen triggers the bug report sheet (via UIWindow subclass)
- Does NOT trigger during tutorial flows (`TutorialStateManager.isActive`)
- Screenshot is captured before the sheet appears
- Screen name is tracked and included in the report
- Auto-captured context is comprehensive but excludes sensitive data
- Screenshot uploads to S3, not Supabase Storage
- Report appears in the web admin panel (`/bug-reports`) immediately after submission
- Offline reports queue and submit when connectivity returns
- The entire user interaction takes under 10 seconds
- No third-party dependencies added
- All UI uses `OPSStyle` design tokens
