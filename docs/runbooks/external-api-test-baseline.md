# External API Post-Merge Test Baseline

**Recorded:** 2026-07-24
**Branch:** `feat/lead-intake-api`
**Worktree:** `/Users/jacksonsweet/Projects/OPS/ops-web/.worktrees/lead-intake-api`
**Accepted baseline commit:** `b4fe78042e629b461c5d8d38f6f82083c1101b23`
**Merged `origin/main`:** `998211dfa910a2ff7a16462b68fd191f8974b4a2`
**Status:** accepted known-red comparison baseline for Tasks 1–19

## Final implementation readback

The final machine-readable full-suite run on 2026-07-27 reported:

```text
Test Files  3 failed | 1090 passed | 1 skipped (1094)
Tests       13 failed | 10001 passed | 5 skipped (10019)
```

Every External Lead API test passed. The remaining failures are confined to
files unchanged from current `origin/main`:

- `tests/integration/uploads-presign.test.ts`: the same eight `403` failures
  recorded below;
- `tests/unit/components/create-estimate-form.test.tsx`: three failures because
  its `@/lib/hooks` mock does not expose `useDefaultTaxRate`;
- `tests/unit/i18n/inbox-parity.test.ts`: the same two missing Spanish-key
  failures recorded below.

The two historical email failures recorded below now pass in focused runs.
This final run used the repository-local pnpm install because the bundled
runtime has no npm executable; the historical accepted result remains below
as provenance rather than being rewritten.

## Merge evidence

The prepared worktree was clean at the recorded planning base
`5f066c5aff0d8c5960f8418213756037e963d731`. `origin/main` was fetched and
merged without a conflict. The merge commit has parents
`5f066c5aff0d8c5960f8418213756037e963d731` and
`998211dfa910a2ff7a16462b68fd191f8974b4a2`. The committed design
(`92775580`) and plan remain in history.

The four merged upstream commits are:

1. `998211df fix(build): isolate unchanged email template sync`
2. `fd6de6a1 chore(deploy): retry lifecycle release after provider recovery`
3. `5b4868d7 fix(email): refresh trusted lead summaries safely`
4. `cdb494f6 fix(email): harden commercial lifecycle evidence`

## Runtime and command

The plan's logical command was:

```bash
npm test -- --run
```

The bundled runtime has no `npm` executable. The two historical accepted runs
therefore used the following literal expanded invocation, with official npm
`11.6.2` downloaded outside the repository:

```bash
export PATH="/Users/jacksonsweet/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
/Users/jacksonsweet/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  /private/tmp/ops-task0-npm.JU50aS/package/bin/npm-cli.js test -- --run
```

That exact temporary npm CLI still existed when this fix-round evidence was
recorded, but `/private/tmp` is ephemeral. It is historical evidence, not the
stable future command. The reproducible repository-local equivalent is:

```bash
export PATH="/Users/jacksonsweet/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
/Users/jacksonsweet/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  ./node_modules/vitest/vitest.mjs --run
```

The runtime is Node `v24.14.0`. No dependency or repository file changed to
run the historical or stable command.

The repository declares Node `22.x`; the connected Vercel project reports Node
`24.x`. Both satisfy Supabase's current Node 22-or-later requirement. The CI
workflow still selects Node 20, whose Supabase client support ended
2026-06-30. That is a separate implementation-readiness gap; Task 0 did not
change CI.

## Accepted full-suite result

The second unchanged full run is the comparison baseline:

```text
Test Files  4 failed | 951 passed | 1 skipped (956)
Tests       12 failed | 9068 passed | 5 skipped (9085)
Duration    82.42s
Exit code   1
```

This is the same four-file, 12-test known-red shape recorded before the merge.
The passing-test count increased from 8,680 to 9,068 because the merged upstream
history added tests; it did not introduce a deterministic new failure.

## Exact accepted failures

### `tests/integration/uploads-presign.test.ts` — eight failures

All eight requests returned `403` before the asserted content-type or extension
result:

| Test                                                                                             | Error                                    |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `content-type validation > allows image/jpeg for an arbitrary image folder`                      | `AssertionError: expected 403 to be 200` |
| `content-type validation > allows application/json for the training_data/ folder prefix`         | `AssertionError: expected 403 to be 200` |
| `content-type validation > rejects application/json when folder is NOT training_data/`           | `AssertionError: expected 403 to be 400` |
| `content-type validation > rejects image/gif everywhere (not on the allowlist)`                  | `AssertionError: expected 403 to be 400` |
| `content-type validation > rejects application/javascript even when path is training_data/`      | `AssertionError: expected 403 to be 400` |
| `file extension inference > preserves the original extension when present`                       | `AssertionError: expected 403 to be 200` |
| `file extension inference > falls back to .json when filename has no extension and type is JSON` | `AssertionError: expected 403 to be 200` |
| `file extension inference > falls back to .jpg when filename has no extension and type is image` | `AssertionError: expected 403 to be 200` |

### `tests/unit/email/email-opportunity-title-live-pattern.test.ts` — one failure

Test:

```text
SyncEngine live email opportunity title pattern
> labels sent-folder safety-net leads from the external recipient when the
  operator uses a Gmail mailbox
```

Error:

```text
AssertionError: expected [ Array(1) ] to deeply equal []
Received:
["[sync-engine] atomic company mailbox opportunity returned no result"]
```

### `tests/unit/email/sync-engine-ai-provider-isolation.test.ts` — one failure

Test:

```text
sync-engine AI-provider isolation — Step 5
> defers durably on a provider outage and counts the deferral
```

Error:

```text
AssertionError: expected the source slice to contain
"markUnmatchedThreadsPendingLeadScan(unmatchedContexts, connection);"
```

The call exists, but current formatting spans multiple lines. This is a brittle
source-text assertion, not absent runtime behavior.

### `tests/unit/i18n/inbox-parity.test.ts` — two failures

Test:

```text
inbox dictionary — flat-key parity
> es mirrors en exactly — no missing or extra keys
```

Complete assertion output:

```text
AssertionError: expected [ 'action.aiDraft', …(540) ] to deeply equal [ 'action.aiDraft', …(542) ]

- Expected
+ Received

  Array [
    "action.aiDraft",
    "action.archive",
    "action.compose",
    "action.recategorize",
    "action.snooze",
    "action.unarchive",
    "action.unsnooze",
    "aiDraftBanner.label",
    "archiveModal.a11yDescription",
    "archiveModal.always",
    "archiveModal.archiveLead",
    "archiveModal.cancel",
    "archiveModal.confirm",
    "archiveModal.description.firstLead",
    "archiveModal.description.siblings_one",
    "archiveModal.description.siblings_other",
    "archiveModal.error",
    "archiveModal.itemCount_one",
    "archiveModal.itemCount_other",
    "archiveModal.leadHint.willArchive",
    "archiveModal.leadHint.willStay",
    "archiveModal.loading",
    "archiveModal.prefix.firstLead",
    "archiveModal.prefix.siblings",
    "archiveModal.section.lead",
    "archiveModal.section.siblings",
    "archiveModal.section.thisThread",
    "archiveModal.submitting",
    "archiveModal.title.firstLead",
    "archiveModal.title.siblings",
    "badge.unread",
    "bands.autoSent.aria",
    "bands.autoSent.body",
    "bands.autoSent.revise",
    "bands.autoSent.takeOver",
    "bands.autoSent.title",
    "bands.closed.aria",
    "bands.closed.label",
    "bands.closedArchived",
    "bands.closedResolved",
    "bands.needsInput.aria",
    "bands.needsInput.label",
    "bands.needsInput.pausedAgo",
    "bands.needsInput.provideAnswer",
    "bands.needsInput.provideAnswerButton",
    "bands.needsInput.title",
    "bands.needsInput.typeReply",
    "bands.needsInput.typeReplyEscape",
    "bands.summary.aria",
    "bands.summary.label",
    "bands.summary.provenance",
    "bands.summary.title",
    "bands.summary.updatedBy",
    "bands.summary.updatedByNow",
    "channel.email",
    "channel.portal",
    "channel.unmatched",
    "column.filter",
    "column.filterAll",
    "column.more",
    "column.search",
    "column.searchPlaceholder",
    "column.title",
    "commandPalette.cmd.aiDraft",
    "commandPalette.cmd.archive",
    "commandPalette.cmd.composeNew",
    "commandPalette.cmd.markUnread",
    "commandPalette.cmd.recategorize",
    "commandPalette.cmd.snooze",
    "commandPalette.empty",
    "commandPalette.filter.only",
    "commandPalette.heading.create",
    "commandPalette.heading.filterCategory",
    "commandPalette.heading.navigate",
    "commandPalette.heading.thisThread",
    "commandPalette.heading.threads",
    "commandPalette.nav.all",
    "commandPalette.nav.archived",
    "commandPalette.nav.clearFilter",
    "commandPalette.nav.clients",
    "commandPalette.nav.everythingElse",
    "commandPalette.nav.waiting",
    "commandPalette.nav.yourMove",
    "commandPalette.placeholder",
    "commandPalette.searching",
    "commandPalette.unknownSender",
    "commitment.empty",
    "commitment.label",
    "commitment.resolve",
    "commitment.resolveTitle",
    "commitmentPills.aria",
    "commitmentPills.label",
    "commitmentPills.resolve",
    "compose",
    "composer.attachFile",
    "composer.attachImage",
    "composer.dismiss",
    "composer.draftWithPhaseC",
    "composer.editDraft",
    "composer.editDraftTactic",
    "composer.error.noRecipient",
    "composer.error.sendFailed",
    "composer.formatBold",
    "composer.formatItalic",
    "composer.placeholder",
    "composer.scheduleSend",
    "composer.send",
    "composer.sendAiDraft",
    "composer.sendPhaseC",
    "composer.sendTactic",
    "composer.tacticPlaceholder",
    "context.createEstimate",
    "context.createProject",
    "context.estimates",
    "context.invoices",
    "context.projects",
    "context.toggle",
    "context.viewClient",
    "date.today",
    "date.yesterday",
    "detail.empty",
    "detail.loading",
    "detail.metaCount",
    "detail.nMessages",
    "detail.oneMessage",
    "detail.openClient",
    "detail.selectThread",
    "detail.selectThreadBody",
    "detail.unknownClient",
    "detail.untitled",
    "detailMore.copyLink",
    "detailMore.markRead",
    "detailMore.markUnread",
    "detailMore.refresh",
    "draftBubble.edit",
    "draftBubble.label",
    "draftBubble.phaseC",
    "draftBubble.pickerItem",
    "draftBubble.pickerLabel",
    "draftBubble.provider",
    "draftBubble.send",
    "draftSwitcher.addNew",
    "draftSwitcher.addNewAria",
    "draftSwitcher.gmailLabel",
    "draftSwitcher.newLabel",
    "draftSwitcher.outlookLabel",
    "draftSwitcher.phaseCLabel",
    "draftSwitcher.yoursLabel",
    "drafts.label",
    "drafts.next",
    "drafts.prev",
    "drafts.source.gmail",
    "drafts.source.outlook",
    "drafts.source.phaseC",
    "drafts.source.yours",
    "draftsPanel.body",
    "draftsPanel.discard",
    "draftsPanel.empty",
    "draftsPanel.title",
    "editToolbar.label",
    "editToolbar.labelTail",
    "editToolbar.regenerate",
    "editToolbar.revert",
    "editToolbar.seeChanges",
    "empty.all.body",
    "empty.all.header",
    "empty.archived.body",
    "empty.archived.header",
    "empty.clients.body",
    "empty.clients.header",
    "empty.everythingElse.body",
    "empty.everythingElse.header",
    "empty.searchMiss.body",
    "empty.searchMiss.header",
    "empty.waiting.body",
    "empty.waiting.header",
    "empty.yourMove.body",
    "empty.yourMove.header",
    "error",
    "error.loadFailed.hint",
    "error.loadFailed.title",
    "files.documentsLabel",
    "files.empty",
    "files.imagesLabel",
    "files.openPhoto",
    "files.openPhotoOverflow",
    "filter.all",
    "filter.allChip",
    "filter.defaultCurrent",
    "filter.email",
    "filter.portal",
    "filter.rail.all",
    "filter.rail.archived",
    "filter.rail.clients",
    "filter.rail.everythingElse",
    "filter.rail.waiting",
    "filter.rail.yourMove",
    "filter.setDefault",
    "floatingBadge.acknowledge",
    "floatingBadge.aria",
    "floatingBadge.label",
    "header.archiveThread",
    "header.draftsChipAria",
    "header.draftsChipLabel",
    "header.moreActions",
    "header.nextThread",
    "header.previousThread",
    "header.recategorize",
    "header.snoozeThread",
    "header.snoozedChipAria",
    "header.snoozedChipLabel",
    "header.toggleContextRail",
    "held.confidence",
    "held.defaultReason",
    "held.directive",
    "held.paused",
    "held.title",
    "insights.client",
    "insights.firstContact",
    "insights.frequency",
    "insights.frequencyMany",
    "insights.frequencyOne",
    "insights.header",
    "insights.manual",
    "insights.noCorrections",
    "insights.noMemories",
    "insights.opportunity",
    "insights.pastCorrections",
    "insights.phaseCKnows",
    "insights.sender",
    "labels.awaitingReply",
    "labels.fromNewSender",
    "labels.hasAttachment",
    "labels.hasInvoice",
    "labels.hasQuote",
    "labels.urgent",
    "list.endOfList",
    "list.loading",
    "list.loadingMore",
    "loading",
    "messages.fileCount_one",
    "messages.fileCount_other",
    "messages.openFile",
    "messages.photoCountTactic_one",
    "messages.photoCountTactic_other",
    "messages.photoOverflow",
    "messages.sentByPhaseC",
    "mobile.back",
    "mobile.context",
    "mobile.contextPane",
    "mobile.listPane",
    "mobile.thread",
    "mobile.threadPane",
    "modal.archive.body",
    "modal.archive.cancel",
    "modal.archive.confirm",
    "modal.archive.title",
    "modal.recat.body",
    "modal.recat.noteTitle",
    "modal.recat.title",
    "modal.snooze.body",
    "modal.snooze.customCommit",
    "modal.snooze.presetCustom",
    "modal.snooze.presetLaterToday",
    "modal.snooze.presetNextMon",
    "modal.snooze.presetNextMonth",
    "modal.snooze.presetTomorrow",
    "modal.snooze.presetWeekend",
    "modal.snooze.title",
    "modal.writeback.archiveInGmail",
    "modal.writeback.archiveInGmailBody",
    "modal.writeback.body",
    "modal.writeback.learnMore",
    "modal.writeback.markAsRead",
    "modal.writeback.markAsReadBody",
    "modal.writeback.notNow",
    "modal.writeback.opsOnly",
    "modal.writeback.opsOnlyBody",
    "modal.writeback.saveArchive",
    "modal.writeback.title",
    "more.archive",
    "more.menuLabel",
    "more.refresh",
    "more.settings",
    "newMessage",
    "palette.clearFilter",
    "palette.create",
    "palette.filterCategory",
    "palette.goTo",
    "palette.navigate",
    "palette.noMatch",
    "palette.onlyShow",
    "palette.placeholder",
    "palette.searching",
    "palette.thisThread",
    "palette.threads",
    "panel.title",
    "phaseC.adjust",
    "phaseC.archiving.primary",
    "phaseC.archiving.secondary",
    "phaseC.autoDraftedPrefix",
    "phaseC.bubbleMeta",
    "phaseC.diffHeader",
    "phaseC.diffProvenance",
    "phaseC.drafted.action",
    "phaseC.drafted.primary",
    "phaseC.drafted.secondary",
    "phaseC.draftedBanner",
    "phaseC.edited",
    "phaseC.editedFromDraft",
    "phaseC.following.primary",
    "phaseC.following.secondary",
    "phaseC.graduating.action",
    "phaseC.graduating.primary",
    "phaseC.graduating.secondary",
    "phaseC.hideDiff",
    "phaseC.monitoring.primary",
    "phaseC.monitoring.secondary",
    "phaseC.sent.action",
    "phaseC.sent.primary",
    "phaseC.sent.secondary",
    "phaseC.showDiff",
    "picker.ariaLabel",
    "picker.ariaLabelOne",
    "picker.header",
    "picker.trigger",
    "picker.triggerNone",
    "picker.triggerOne",
    "pipeline.empty",
    "pipeline.newOpportunity",
    "pipeline.priority.high",
    "pipeline.priority.low",
    "pipeline.priority.medium",
    "pipeline.thisThread",
    "pipeline.untitledOpportunity",
    "pipeline.wonTag",
    "project.accounting",
    "project.due",
    "project.ofTotal",
    "project.openProject",
    "project.paid",
    "project.scope",
    "rail.addLead",
    "rail.addProject",
    "rail.addTask",
    "rail.all",
    "rail.all.title",
    "rail.allCategories",
    "rail.archived",
    "rail.archived.title",
    "rail.clientLabel",
    "rail.clientUnlinked",
    "rail.clientUnlinkedBody",
    "rail.closeDrawer",
    "rail.contactAddr",
    "rail.contactEmail",
    "rail.contactPhone",
    "rail.docTypeEstimate",
    "rail.docTypeInvoice",
    "rail.empty.accounting",
    "rail.empty.files",
    "rail.empty.pipeline",
    "rail.empty.tasks",
    "rail.empty.threads",
    "rail.emptyFiles",
    "rail.emptyPhotos",
    "rail.emptyUnassigned",
    "rail.emptyUnlinkedBody",
    "rail.fileAvailabilityExternal",
    "rail.fileAvailabilityOversized",
    "rail.fileAvailabilityUnavailable",
    "rail.fileSourceEmail",
    "rail.fileSourceFile",
    "rail.fileTypeUnknown",
    "rail.filesToggleFiles",
    "rail.filesTogglePhotos",
    "rail.openButton",
    "rail.openClient",
    "rail.oppMetaEmail",
    "rail.oppMetaHigh",
    "rail.oppMetaThisThread",
    "rail.photosCount",
    "rail.sectionEstimates",
    "rail.sectionInvoices",
    "rail.sectionLeads",
    "rail.sectionOther",
    "rail.sectionProjects",
    "rail.sectionThisThread",
    "rail.sectionWon",
    "rail.stageActive",
    "rail.stageBooked",
    "rail.stageClosed",
    "rail.stageQuoted",
    "rail.statusAccepted",
    "rail.statusApproved",
    "rail.statusChangesRequested",
    "rail.statusConverted",
    "rail.statusDeclined",
    "rail.statusDraft",
    "rail.statusEmpty",
    "rail.statusExpired",
    "rail.statusOutstanding",
    "rail.statusOverdue",
    "rail.statusPaid",
    "rail.statusSent",
    "rail.subclient",
    "rail.subclients",
    "rail.tabAccounting",
    "rail.tabFiles",
    "rail.tabWork",
    "rail.tabs.files",
    "rail.tabs.pipeline",
    "rail.tabs.tasks",
    "rail.tabs.threads",
    "rail.totalEstimates",
    "rail.totalInvoices",
    "rail.totalOutstanding",
    "rail.totalOverdue",
    "rail.totalPaid",
    "rail.totalPaid30d",
    "rail.waiting",
    "rail.waiting.title",
    "rail.yourMove",
    "rail.yourMove.title",
    "recategorize.error",
    "recategorize.notePlaceholder",
    "reply.placeholder",
    "reply.send",
    "reply.viaEmail",
    "reply.viaPortal",
    "row.aiDraft",
    "row.aiDraftPrefix",
    "row.alarmStrip",
    "row.archiveThread",
    "row.dismissAwaitingReply",
    "row.draftPrefix",
    "row.heldChip",
    "row.heldStrip",
    "row.markRead",
    "row.markUnread",
    "row.newBadge",
    "row.phaseCDraftPrefix",
    "row.stateAutoSent",
    "row.stateClosed",
    "row.stateDraftReady",
    "row.stateFyi",
    "row.stateOverdue",
    "row.stateSys",
    "row.stateTheirsDays",
    "row.stateTheirsHours",
    "row.stateYoursDays",
    "row.stateYoursHours",
    "row.unknownSender",
    "row.urgent",
    "search.clear",
    "search.placeholder",
    "search.tacticPlaceholder",
    "shell.resizePanel",
    "shell.threadContext",
    "shell.threadList",
    "siblings.clientFallback",
    "siblings.headerMany",
    "siblings.headerOne",
    "siblings.viewClient",
    "siblings.viewClientTitle",
    "snoozedPanel.body",
    "snoozedPanel.empty",
    "snoozedPanel.title",
    "snoozedPanel.unsnooze",
    "snoozedPanel.untilSuffix",
    "thread.aiSummary",
    "thread.attachments",
    "thread.back",
    "thread.collapse",
    "thread.expand",
    "thread.markRead",
    "thread.markUnread",
    "thread.messageCount.one",
    "thread.messageCount.other",
    "thread.noBody",
    "thread.people.one",
    "thread.people.other",
    "thread.reply",
    "threadsView.msg",
    "threadsView.msgs",
    "title",
-   "toast.archivePartialTactic",
    "toast.archived",
    "toast.archivedBack",
    "toast.archivedTactic",
    "toast.dismissFailedTactic",
    "toast.dismissedTactic",
    "toast.recategorized",
    "toast.recategorizedDetail",
    "toast.recategorizedTactic",
-   "toast.restorePartialTactic",
    "toast.retryTactic",
    "toast.snoozed",
    "toast.snoozedTactic",
    "toast.threadLinkCopiedTactic",
    "toast.threadLinkCopyFailedTactic",
    "toast.threadMarkedReadTactic",
    "toast.threadMarkedUnreadTactic",
    "toast.threadReadStateFailedTactic",
    "toast.threadRefreshedTactic",
    "toast.undo",
    "toast.undoTactic",
    "todayBar.allCaughtUp",
    "todayBar.allCaughtUpDetail",
    "todayBar.caughtUpBody",
    "todayBar.caughtUpHeader",
    "todayBar.itemCount_one",
    "todayBar.itemCount_other",
    "todayBar.moreObligations",
    "todayBar.openThread",
    "todayBar.resolve",
    "todayBar.stateToday",
    "todayBar.stateWaiting",
    "todayBar.today",
    "todayBar.yourMove",
    "todayBar.yourMoveOverdue",
    "todayBar.yourMoveTodayOnly",
    "unmatched.createClient",
    "unmatched.ignore",
    "unmatched.linkToClient",
    "writeback.a11yDescription",
    "writeback.a11yTitle",
    "writeback.archive",
    "writeback.archive.caption",
    "writeback.archive.detail",
    "writeback.confirm",
    "writeback.description",
    "writeback.error",
    "writeback.markRead",
    "writeback.markRead.caption",
    "writeback.markRead.detail",
    "writeback.notNow",
    "writeback.opsOnly",
    "writeback.opsOnly.caption",
    "writeback.opsOnly.detail",
    "writeback.prefix",
    "writeback.saving",
    "writeback.title",
  ]

 ❯ tests/unit/i18n/inbox-parity.test.ts:22:36
     20| describe("inbox dictionary — flat-key parity", () => {
     21|   it("es mirrors en exactly — no missing or extra keys", () => {
     22|     expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
       |                                    ^
     23|   });
     24|
```

The assertion's `Expected` array is English and `Received` is Spanish. The two
minus-prefixed expected-only keys are therefore the complete difference;
Spanish has no extra received-only key.

Test:

```text
inbox dictionary — flat-key parity
> interpolation tokens are identical between en and es for every key
```

Complete assertion output:

```text
TypeError: Cannot read properties of undefined (reading 'match')
 ❯ tokenSet tests/unit/i18n/inbox-parity.test.ts:18:47
     16|  */
     17| const TOKEN = /\{(\w+)\}/g;
     18| const tokenSet = (s: string) => [...new Set(s.match(TOKEN) ?? [])].sor…
       |                                               ^
     19|
     20| describe("inbox dictionary — flat-key parity", () => {
 ❯ tests/unit/i18n/inbox-parity.test.ts:38:14
```

The second failure has no assertion `Expected`/`Received` section because the
test throws before reaching `expect(...)`: English iteration reaches one of the
two missing Spanish values, so `tokenSet` receives `undefined`.

## Transient first-run investigation

The first full run ended after `384.60s` with six failed files, 949 passed files,
one skipped file, 13 failed tests, 9,059 passed tests, and five skipped tests.
It contained the accepted failures above plus two timeout-shaped failures:

- `src/lib/inbox/__tests__/opp-display.test.ts` failed before collecting a test:
  `Error: [vitest-worker]: Timeout calling "fetch" with
"["/tests/mocks/data.ts","web"]"`.
- `tests/unit/hooks/use-client-projects.test.tsx > useClientProjects > returns
the project list when the query resolves` failed with
  `Error: Test timed out in 5000ms`.

A focused unchanged rerun passed both files:

```text
Test Files  2 passed (2)
Tests       11 passed (11)
Duration    709ms
```

The second full run then returned exactly to the historical four-file,
12-test known-red set. The two timeout failures are therefore recorded as
full-suite worker/resource flakes, not accepted product failures.

## Comparison rule

Every later task must compare its full-suite result to commit
`b4fe78042e629b461c5d8d38f6f82083c1101b23` and the exact accepted result above.

- A new failed file or test is a regression until proved otherwise.
- A change in any accepted failure's error shape requires investigation.
- A worker timeout must pass in a focused unchanged rerun and disappear in a
  second full run before it can be classified as transient.
- The older pre-plan 8,680-pass count and four-file list are historical context
  only and must not be used as the implementation baseline.
