# OpenAI quota alert design

**Date:** 2026-07-20
**Status:** User-approved direction, independent review incorporated
**Owner:** OPS platform operations

## Outcome

OPS warns Jackson before OpenAI spend reaches the configured project budget and creates a durable OPS incident as soon as OpenAI rejects any production workload with `insufficient_quota`.

The system must never send through Gmail. Early warnings use OpenAI's native owner emails. An actual outage uses the OPS notification rail plus OneSignal push. No OpenAI prompt, customer message, attachment, raw response body, authorization header, or API key may enter the monitoring record or notification.

## Product behavior

### Almost out

OpenAI Project Limits will carry budget alerts at 75%, 90%, and 100% of the selected monthly project budget. OpenAI sends these emails to organization and project owners. This is a soft spending warning, not a hard cap, and it does not expose the remaining prepaid-credit balance to OPS.

This native mechanism is preferred over giving OPS an organization Admin API key. It provides earlier warning without adding a highly privileged credential or another billing-data store.

### Out of credits

Every production OpenAI client must use one monitored construction boundary. When the provider response has the exact code `insufficient_quota`, OPS will:

1. Preserve the original provider failure and its existing application behavior.
2. Write only safe operational metadata to the structured server log: workload context, configured environment-key source, HTTP status, provider error code/type, endpoint class, and request ID.
3. Create one persistent notification for Jackson's configured canonical OPS user after verifying that the user is active, is a company admin, and belongs to the expected OPS company. Platform-admin route access controls only whether the alert includes a Platform Health action.
4. Attempt one bounded OneSignal push only when the durable notification row is newly created. The rail write is authoritative; push is best-effort and may not delay the original provider response beyond its fixed timeout.
5. Avoid repeat alerts from SDK retries, concurrent requests, or other workloads resolving through the same configured key source.

The stable condition key is:

`platform-provider:openai:insufficient-quota:<configured-key-source>`

The configured key source is the environment variable that actually supplied the credential, such as `OPENAI_API_KEY_SYNC` or the shared `OPENAI_API_KEY`. The key value is never logged, hashed, persisted, or compared.

Two environment variables containing duplicate copies of the same credential are intentionally treated as separate key sources. OPS cannot safely compare secret values, so convergence is guaranteed only when workloads resolve through the same environment-variable source. Workloads falling back to the shared `OPENAI_API_KEY` converge on that shared source.

### Recovery

Recovery must be safe against in-flight requests and recurring incidents. Each observed quota failure serially advances `notifications.incident_version` on the exact open incident under the same transaction-level advisory lock used by recovery; the first observation for a new row starts at version 1. On an eligible recovery slot, the monitored client reads and captures the exact open `notifications.id` and `incident_version` for the configured user, derived company, type, and dedupe key **before** it sends the OpenAI request. A 2xx response may resolve only that captured row and generation. If no row was open when the request began, that response resolves nothing. If another quota failure arrives after capture, it advances the generation and makes the older recovery attempt a no-op. This prevents an older success from closing an incident created or reconfirmed while the request was running, and prevents a success associated with incident N from closing recurrence N+1.

Atomic resolution matches the captured notification ID, incident version, canonical user, derived company, exact notification type, exact dedupe key, and `resolved_at is null`, regardless of presentation read state. It sets `is_read = true`, `resolved_at = clock_timestamp()`, `resolved_by = null`, and `resolution_reason = 'provider_quota_recovered'`, returning whether one row changed. Automated recovery must never be attributed to Jackson or another human. If recovery commits first, a later quota observation creates a fresh open row at version 1; it never reopens or mutates the resolved row.

The five-minute memory gate throttles only the preflight read. Each server instance checks at most once per key source per five minutes, with the first request after a cold start eligible immediately. Observing a quota failure marks that key source recovery-eligible in-process, so the next local request captures the open incident immediately. Recovery is immediate when that request succeeds; a warm peer reconciles on its next eligible slot. If either the preflight read or resolution fails, the local slot remains eligible so later requests retry.

A later exhaustion event creates a new incident after the prior one is resolved. Historical notification rows are not semantically rewritten; generation tracking begins going forward with the next observed quota failure.

## Notification contract

| Field            | Value                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`           | `ai_provider_quota`                                                                                                                                       |
| `title`          | `OPENAI CREDITS EXHAUSTED`                                                                                                                                |
| `body`           | `OpenAI calls stopped. Add credits now.`                                                                                                                  |
| `persistent`     | `true`                                                                                                                                                    |
| `deep_link_type` | `null` so the durable row never advertises an unsupported iOS destination                                                                                 |
| `action_url`     | `/admin/platform-health` when the configured recipient retains access; otherwise `null`                                                                   |
| `action_label`   | `CHECK OPENAI` when `action_url` is present; otherwise `null`                                                                                             |
| `dedupe_key`     | Stable condition key defined above                                                                                                                        |
| Recipient        | Canonical OPS `public.users.id`; company is derived from that user and compared with the configured expected-company invariant; never discovered by email |

The notification type must be registered in the web metadata registry and iOS icon registry. The durable row intentionally carries no iOS deep link. OneSignal push data uses `{ type: 'ai_provider_quota', screen: 'notifications' }`; iOS adds a cold-launch/PIN-safe `notifications` screen route that opens the existing rail. The web action opens the existing Platform Health route. Web CI and iOS build/tests are separate acceptance gates.

The rail is authoritative. Push is a wake-up channel and is attempted only for entries returned in `createTrustedNotifications().createdNotifications`.

The existing notification row is the incident ledger; no separate billing or provider-payload table is added. A quota-specific partial unique index allows only one unresolved row for the canonical recipient, company, type, and dedupe key. Read/unread is presentation state and never defines whether the incident is open. A sibling service-only creation RPC returns `{ notification_id, created, incident_version }` without changing or removing the existing boolean RPC. For `ai_provider_quota`, the RPC holds the incident advisory lock, creates a new row at version 1, or atomically increments and reasserts unread on the exact unresolved row before returning its new version. `createTrustedNotifications()` retains its three existing result fields and adds `createdNotifications: Array<{ notificationId, recipientUserId }>` non-breakingly. Push is attempted at most once for each newly created row and uses that durable notification UUID as its idempotency UUID, never provider request content. A later incident receives a new notification UUID and may therefore send a new push after the previous incident was resolved.

A new service-only resolution RPC accepts the expected incident version, closes only that exact captured generation under the same advisory lock, and returns whether it changed. Neither RPC is executable by browser roles. Both use a locked search path, and the notification table remains protected by its existing recipient-scoped RLS.

## Architecture

### Monitored OpenAI factory

`src/lib/api/services/openai-clients.ts` becomes the only production `new OpenAI(...)` construction point.

It will expose a common factory receiving:

- workload context;
- resolved environment-key source;
- sanitized API key;
- optional timeout;
- monitored `fetch` implementation.

The existing import, sync, and drafting factories remain as stable call-site APIs. The independent constructors in email classification, Catalog Setup, and admin briefing move to the common factory. Test-injected clients remain allowed test seams.

A static contract test fails if production code constructs `OpenAI` anywhere outside the factory.

### Error classification

The monitored fetch inspects a cloned failed response. It alerts only when the parsed provider payload has `error.code === 'insufficient_quota'`. Tests must prove both the raw fetch payload and the installed OpenAI SDK's surfaced `APIError.code`; HTTP 429 alone is insufficient.

Ordinary 429 rate limiting remains retryable and must not create a credit alert. Existing retry predicates that treat every 429 alike must be updated to classify the exact provider code.

Quota detection awaits the durable rail-write attempt with a fixed 1.5-second ceiling before returning the original response to the SDK. Monitoring failures are logged with safe metadata and never replace, swallow, or mutate that response/error. After a newly created row is confirmed, OneSignal push is attempted with a separate two-second ceiling. Push is explicitly best-effort; the durable rail row remains the guaranteed notification.

### Durable notification boundary

The alert service is server-only and uses:

- `OPS_PLATFORM_ALERT_USER_ID` as the canonical recipient UUID;
- `OPS_PLATFORM_ALERT_COMPANY_ID` only as a server-side invariant for the expected OPS company, never as an independently trusted identity input;
- a database lookup by canonical user UUID to derive the actual company and verify the user is active, not deleted, is a company admin, and matches the expected company;
- `createTrustedNotifications()` for safe internal navigation, durable deduplication, and active same-company enforcement;
- `src/lib/integrations/onesignal.ts` for canonical OPS UUID push targeting.

Recipient identity is always `OPS_PLATFORM_ALERT_USER_ID`; company identity is always derived from that user row and then compared with the configured expected-company invariant. The existing platform-admin email allowlist may be checked only to prove that the already-resolved user can open Platform Health; it may never be used to discover or substitute the recipient. If that route-access check fails, the rail alert is still created but the action URL and label are omitted and a configuration error is logged. The service must not use the legacy player-ID OneSignal helper, a role-name lookup, or a mailbox address as identity.

No new generic browser notification endpoint is introduced.

## Failure handling

- Missing, mismatched, or invalid platform alert user/company configuration: preserve the OpenAI failure, emit a secret-safe server error, and keep the provider request behavior unchanged.
- Notification database failure: preserve the provider failure and leave the condition retryable on the next quota response.
- OneSignal failure or timeout: the durable rail row remains authoritative; push is not retried from the provider request path, and provider behavior remains unchanged.
- Malformed OpenAI error body: do not alert; return the original response unchanged.
- Normal rate limit: no quota incident.
- Multiple configured OpenAI key sources: dedupe and recover independently by the environment source that supplied each client, even when two variables contain the same credential value.
- Shared fallback key: all sharing workloads converge on one incident.

## Cost and operational impact

OPS makes no new OpenAI model or billing API calls, adds no billing poller, and adds no scheduled function. Native OpenAI budget emails and auto-recharge remain provider-managed. Runtime overhead is limited to one throttled Supabase preflight read per active server instance and key source every five minutes, exact incident writes/resolution, and a OneSignal call only for a newly created incident. These operations consume the existing Supabase, Vercel, and OneSignal allocations; the design does not introduce a new paid service, but it does add a small amount of usage and latency to the existing plans.

## Configuration and operating steps

1. Set OpenAI Project Limits budget alerts at 75%, 90%, and 100%. OpenAI owner emails are the proactive warning channel.
2. Set `OPS_PLATFORM_ALERT_USER_ID` and `OPS_PLATFORM_ALERT_COMPANY_ID` in Vercel to Jackson's canonical active OPS user/company UUID pair.
3. Do not add `OPENAI_ADMIN_KEY`; OPS does not poll organization billing or store OpenAI costs in this design.
4. Do not intentionally exhaust credits for a smoke test. Tests inject exact provider responses. Production recovery is verified on the next real successful model call.

## Verification

The implementation must prove:

- exact `insufficient_quota` detection for import, sync, drafting, Catalog Setup, and admin analysis clients;
- no alert for ordinary 429 responses;
- one durable row and at most one push attempt under retries/concurrency;
- generation-safe failure/recovery races: a later failure invalidates a stale recovery, while recovery-first permits a fresh incident;
- persistent alert reads cannot hide, duplicate, or prematurely close an unresolved incident;
- shared-source convergence and separate-source isolation;
- user/company mismatch, inactive user, and non-admin user fail closed; missing platform-admin route access removes the action without changing recipient identity;
- secret, prompt, message, and attachment redaction;
- original provider error preservation when monitoring fails;
- bounded alert/push timeouts and throttled automatic resolution after successful traffic;
- registered web and iOS notification metadata/routing;
- production constructors cannot bypass the monitored factory;
- the existing `/admin/platform-health` destination remains valid;
- focused tests, full TypeScript, production build, and full web CI pass;
- focused iOS notification routing tests and an iOS build pass independently of web CI.

## Alternatives rejected

### OPS polls OpenAI Costs API

This would require an organization Admin API key, a monthly budget configuration, an hourly cron, and billing snapshots. The Costs API reports month-to-date spend, not the remaining prepaid balance. It duplicates OpenAI's native project-budget emails while increasing credential risk.

### Error-only monitoring

This catches actual exhaustion but gives no advance warning. It remains the in-OPS safety net, paired with native OpenAI budget emails.

### Gmail alert email

Rejected. OPS must never send these alerts through Gmail, and no provider-health feature may weaken that rule.

## Sources

- [OpenAI project budgets and notification thresholds](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform)
- [OpenAI prepaid billing and auto-recharge](https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing)
- [Official OpenAI Node SDK error, retry, request-ID, and custom-fetch behavior](https://github.com/openai/openai-node#handling-errors)
- OPS Software Bible, `07_SPECIALIZED_FEATURES.md` section 14
