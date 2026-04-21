# Thread Grouping Decision — Flat vs Grouped vs Hybrid

**Date:** 2026-04-21
**Status:** Research — recommendation for owner review
**Supersedes portion of:** `docs/superpowers/specs/2026-03-29-unified-inbox-design.md` (§ "Thread grouping")
**Scope:** Conversation list (`src/components/ops/inbox/conversation-list.tsx`) only. Detail view and context panel untouched.

---

## TL;DR

**Keep the list flat. Add a sibling-threads strip to the detail view.**

The 2026-03-29 spec said to group by client. Shipping that would punish the 87.6 % of threads that have no client — which is where triage time actually goes — to help the 28 % of clients with 3+ threads. A flat list plus a "other threads with this client" strip on the detail view captures the grouped-view win without destroying the triage surface.

---

## 1. Current state

The list is a single flat stream of `email_threads` rows. No grouping, no collapsing, one DOM row per DB row.

- `src/app/(dashboard)/inbox/page.tsx:506-517` renders `<ConversationList>` with `listParams` derived from `{ scope, rail, category, search }` and the selected `threadId`. No grouping state exists at the page level.
- `src/components/ops/inbox/conversation-list.tsx:552-555` flattens paginated pages directly: `data?.pages.flatMap((p) => p.threads) ?? []`. Each element of the resulting array becomes one `<ThreadRow>` at `conversation-list.tsx:804-831`.
- Row sort is server-side by `last_message_at DESC` (set in `EmailThreadService.list` and returned verbatim).
- `src/lib/hooks/use-inbox-threads.ts:194-212` drives the list with `useInfiniteQuery` on `/api/inbox/threads` using `nextCursor` pagination. No client-side grouping layer.
- `src/app/api/inbox/threads/route.ts:102-163` returns an ordered array of threads plus the resolved `clientName` for each (second query at line 124-133 populates `clientNameById` from the `clients` table). Client name is just a display-time annotation on the flat row — nothing is grouped.

So: the row already has `clientId` and `clientName`. A grouping layer would not need new fields, just a different rendering strategy.

---

## 2. Data model

**Relationships.** `email_threads.client_id` (uuid, nullable) points to `clients.id`. `email_threads.opportunity_id` points to `opportunities.id`. Both are single-valued — a thread belongs to at most one client and at most one opportunity. Clients and opportunities have 1-to-N relationships back: a client can have many threads; an opportunity can have many threads.

Auto-matching happens in `EmailThreadService.resolveClientIdFromEmails` (`email-thread-service.ts:202-237`): every participant email is looked up against `clients.email` and `sub_clients.email`; first match wins; sub-client matches resolve to the parent `client_id`. Unlinked threads can be manually linked later.

**Population rate (Canpro production, 2026-04-21):**

| Metric | Count | Share |
|---|---|---|
| Total threads | 3 319 | — |
| `client_id IS NOT NULL` | 411 | **12.4 %** |
| `opportunity_id IS NOT NULL` | 4 | 0.1 % |
| Distinct clients with ≥1 thread | 113 / 270 total clients | 41.9 % |

Opportunity linking is effectively broken in production (4 rows); this research ignores it. Client linking is partial.

**Client → thread distribution** (among the 113 linked clients):

| Threads per client | Clients | Share |
|---|---|---|
| 1 | 67 | 59 % |
| 2 | 14 | 12 % |
| 3-5 | 18 | 16 % |
| 6-10 | 6 | 5 % |
| 11+ | 8 | 7 % |

The 8 heavy clients (11-46 threads each, spanning 131-266 days) account for an outsized share of linked threads and are the group for whom grouping has the most UX value.

---

## 3. Competitive scan

**Superhuman.** Flat list per Split Inbox. Splits are *criteria-based* rails (`from:`, `to:`, `subject:`, label, auto-label) — not contact-rollups. VIP split and "Important" tab surface priority contacts, but a VIP with three active threads still renders as three rows. ([Superhuman Help — Structure Your Inbox](https://help.superhuman.com/hc/en-us/articles/45271247561107-Structure-Your-Inbox), [Split Inbox Basics](https://help.superhuman.com/hc/en-us/articles/38449611367187))

**Fyxer.** Flat list with category labels (`To do`, `FYI`, `Notification`, `To follow up`, `Marketing`) plus a secondary topic sub-label. No contact-grouping. Triage decision is made per-thread. ([Fyxer — Meet Fyxer](https://support.fyxer.com/en/articles/10968437-meet-fyxer-your-ai-email-and-meeting-assistant))

**Front.** Flat list within each shared inbox. "Smart Merge" consolidates *duplicate copies* of the same thread across multiple inboxes; it is not contact-rollup. Contact lists are for composition, not list rendering. ([Front — Smart Merge](https://help.front.com/en/articles/2238))

**Gmail.** Flat list at the conversation level. Gmail's own Contact → email grouping lives in the *contact profile* side panel, not the inbox list. "Conversation view" groups messages *within* a thread (subject-scoped), not threads-per-contact.

**Conclusion.** None of the high-bar inboxes ship contact-rollup as the primary list structure. All four default to flat, and surface per-contact history in a side panel. The 2026-03-29 spec's grouping proposal would be a departure from every professional-tier email reference.

---

## 4. Scenarios

| Scenario | Flat (today) | Grouped (2026-03-29 spec) |
|---|---|---|
| **a. Client with 1 thread (59 % of linked clients, ~67 rows)** | One row. Click → open. | One group with one thread inside. Extra click or auto-expand = visual noise for no gain. |
| **b. Client with 3 threads (quote + scheduling + invoice)** | Three rows, possibly days apart in the list. User must scan for them. | One group, three children. Clear "3 active threads" signal. **Clear win.** |
| **c. Unmatched thread (87.6 % of all threads)** | One row. Click → open. | No client to group by. Renders as ungrouped row *alongside* groups — inconsistent visual hierarchy. Grouping buys nothing. |
| **d. Same person emails from two addresses** | Two rows, two clients (if both matched) or one matched + one unmatched. | Grouped only if both addresses resolve to the same `client_id` — which requires both to be in `clients` or `sub_clients`. Otherwise two groups. Same failure mode as flat. |

Scenario (b) is the only one where grouping meaningfully wins. Scenarios (a) and (c) are net negative — extra chrome, no signal. Scenario (d) is neutral — the data model is the bottleneck, not the rendering.

Weighting by volume: b applies to the 32 clients with 3+ threads (28 % of 113 linked clients, but only ≈ 8-10 % of the full thread list). The other 90 % of list rows see no win.

---

## 5. Recommendation

**Keep the list flat as the primary surface. Add a "Sibling threads" strip to the thread detail view.**

### UX rationale

1. **The list is a triage surface, not a relationship surface.** The job of the left rail is "what needs my attention now." Sorting by `last_message_at` is the right primitive for that. Grouping by client changes the primitive to "who am I corresponding with" — useful in a CRM, wrong in an inbox.
2. **Low data density for grouping.** With only 12 % of threads linked to clients, a grouped list would mix groups and naked rows inconsistently. The design cost of reconciling those two visual treatments outweighs the benefit.
3. **Competitive precedent.** Every inbox the team admires (Superhuman, Fyxer, Front, Gmail) keeps the list flat and surfaces contact history elsewhere.
4. **The sibling-threads problem is real but small.** For the 32 clients with 3+ threads, the user does need to see "what else is going on with them." A strip in the detail view — `3 other threads with Acme Roofing` — solves this cleanly without touching the list.

### Implementation sketch

- **No new endpoint.** Extend the thread detail response (`/api/inbox/threads/[id]`) to include `siblingThreads: Array<{ id, subject, lastMessageAt, primaryCategory, unreadCount }>` when `clientId` is set. Service-side query: `SELECT ... FROM email_threads WHERE company_id = $1 AND client_id = $2 AND id != $3 ORDER BY last_message_at DESC LIMIT 5`.
- **UI location.** `src/components/ops/inbox/thread-detail-view.tsx` header area, below subject. One-line chip row: `OTHER THREADS · [3]` expanding to a compact list. Fits the existing pipeline/tab-bar rhythm.
- **Context panel already does half of this.** `thread-context-panel.tsx:62-137` already fetches sender frequency. Extending *either* the panel or the header with sibling threads is cheap; I'd put it in the header so it's visible without a click.
- **No list grouping layer.** Skip the client-side `groupBy(clientId)` pass. Skip the "ALL mixed with groups" visual reconciliation problem entirely.
- **Sort is unchanged.** Server continues `ORDER BY last_message_at DESC`. Group-level sort is not a problem because groups don't exist.

### When to reconsider grouping

Revisit if two things change:

- `client_id` population rate crosses ~60 % (currently 12.4 %). Then the "naked unmatched row" problem goes away.
- Multi-thread-per-client frequency becomes the majority case per user. Canpro's ratio is dominated by 1-2-thread clients. A plumbing or HVAC account with higher service-ticket cadence might look different.

Until then, the flat list plus sibling strip is the right shape.

---

## 6. Open questions

1. **Should the sibling strip respect the active category filter?** e.g. if the user is in LEAD rail, do siblings include RECEIPT threads from that client? Recommendation: no filter — show all categories, because the user opened this thread specifically to see its context, not to stay in rail.
2. **Does the sibling-thread limit of 5 need UI for "view all"?** For the 8 heaviest clients (11-46 threads) truncation is real. Recommendation: link the client name to `/clients/[id]` where the full history already lives — don't build a second history view inside the inbox.
3. **Is opportunity-based grouping worth any investment?** Only 4 threads have `opportunity_id`. The link mechanism (presumably stage evaluation) isn't populating the column. Fixing the opportunity-linking service is a separate effort from this decision.
4. **Should the flat list collapse same-client consecutive rows?** e.g. three Acme threads in a row become one collapsed group. This is the "Gmail-style conversation view for threads" middle option. Recommendation: no — consecutive same-client rows are rare in a time-sorted list, and the collapse animation noise isn't worth the saved rows.
5. **Does the DRAFTS rail need sibling awareness?** A draft on thread A should probably know about sibling threads B and C. Out of scope here; raise in drafts-rail follow-up.

---

## Citations

- Superhuman — [Structure Your Inbox](https://help.superhuman.com/hc/en-us/articles/45271247561107-Structure-Your-Inbox), [Split Inbox Basics](https://help.superhuman.com/hc/en-us/articles/38449611367187)
- Fyxer — [Meet Fyxer](https://support.fyxer.com/en/articles/10968437-meet-fyxer-your-ai-email-and-meeting-assistant), [Organization in Outlook](https://support.fyxer.com/en/articles/10857248-how-fyxer-organizes-your-inbox-in-outlook-folders-vs-categories-explained)
- Front — [Smart Merge](https://help.front.com/en/articles/2238), [Shared Inboxes](https://help.front.com/en/articles/2057)
- Gmail — [Conversation View](https://support.google.com/mail/answer/5900)
