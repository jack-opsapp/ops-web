# Inbox observation — end-to-end verification (2026-07-03)

**Bug `3e6cd630` ("make sure incoming emails and leads are actually being observed").**
Verdict: **the pipeline is live and observing.** Proven against production, today.

## Live proof (prod, 2026-07-03)

| Signal | Most recent | Last 7 days | Last 2 days |
|---|---|---|---|
| Inbound email observed (`activities`, type=email, inbound) | **2026-07-03 16:20** | 139 | 23 |
| Opportunity created from email (`opportunities`, source=email) | 2026-07-02 17:53 | 8 | 1 |
| Thread routed by the new deterministic router (`email_threads.router_computed_at`) | **2026-07-03 02:01** | 4 | 3 |

Emails are landing, leads are being created, and the router is classifying — all within hours of the check.

## The flow (how an inbound email becomes a lead)

1. **Ingest** — `/api/cron/email-sync` runs every 15 min (business hours, UTC) per connected mailbox; a Gmail/M365 **webhook push** triggers immediate syncs; users can also "Sync now." Auth: `CRON_SECRET`. Gated per-connection by `sync_enabled` + active subscription.
2. **Persist** — each message is written to `activities` (raw + `body_text_clean`, quote/signature stripped) and upserted into `email_threads`.
3. **Classify** — the deterministic conversation-state router + AI classification decide match/lead. AI runs on **OpenAI `gpt-5.4`** for every concern (classify / draft / attachment-vision / accept-parse), centralized in `conversation-state/inbox-models.ts`, quality-first. No provider switch in the inbox path.
4. **Create/attach** — matched threads reuse the existing opportunity; unmatched real leads create a new opportunity (deduped on `source_thread_key`); low-confidence matches surface in the **EMAIL REVIEW** queue for a human.
5. **Observe/health** — `/api/cron/email-ingest-heartbeat` runs hourly; on webhook-expiry / setup-failure / >6h sync gap it writes `email_ingest_heartbeat_log` and fires an in-app + email alert with a reconnect CTA.

## Note (separate, minor)

The old `/settings/integrations/ai-setup` URL 308-redirects to `/calibration`. Worth confirming `/calibration` renders (not in W4 scope). The AI-setup **status** an operator reads (last-synced, sync-active badge, recent import history) lives on the main Integrations tab and is populated by the syncs above.
