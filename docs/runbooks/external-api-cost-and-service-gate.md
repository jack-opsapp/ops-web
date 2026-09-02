# External API Cost and Service Gate

> **CURRENT PILOT DECISION — NO DEDICATED REDIS/UPSTASH**

**Recorded:** 2026-07-24
**Scope:** External Lead Intake and Analytics API
**Pricing currency:** USD
**Approval state:** Jackson confirmed the dedicated AWS intake stack was
successfully provisioned on 2026-07-29. No Upstash purchase or Vercel tier
upgrade is approved or required. Production Supabase migrations, production
deployments, credential issuance, company enablement, and the Norcut pilot
remain separately gated.

## Approved zero-extra-service revision — 2026-07-30

The pilot uses the services already in the OPS operating boundary:

- Vercel WAF provides a coarse `/v1/*` edge rate rule. [Rate limiting is
  available on every Vercel plan](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting);
  the current public allowance includes the first one million allowed requests
  per month, then lists `$0.50` per million in `iad1`.
- The existing OPS Supabase project stores exact fixed-window counters for
  HMAC-derived network, credential, and company identities. One guarded RPC
  atomically consumes each request's quota group and fails closed on database,
  timeout, or response-validation failure.
- Analytics performs no shared server-side cache read/write during the pilot.
  It reauthorizes and reads the privacy-safe projection directly.
- Expired quota rows are removed in bounded batches by the existing
  twenty-minute external API maintenance job.

This removes the modeled Upstash `~$202/month` production recommendation and
sets the dedicated limiter/cache service cost to `$0`. Supabase quota traffic
uses the existing project and is pay-as-used within its current plan; Vercel
WAF is expected to remain within its included allowance at pilot volume.
AWS storage, scanning, request, queue, and delivery remain metered variable
costs, so the existing AWS budget/stop thresholds still apply.

The detailed July 24 analysis below is retained as a historical pricing
snapshot. Its Upstash recommendation is superseded and must not be followed.

This is a planning estimate, not an account quote. Application code and
review-only infrastructure definitions may be prepared after Task 0. No paid
resource, cloud plan, production migration, deployment, or pilot may be created
or changed until Jackson approves a refreshed account-specific quote.

## Approved verification spend

Jackson approved one disposable, no-data Supabase branch for database proof on
2026-07-27. It was created at `2026-07-27T16:09:39Z`, deleted at
`2026-07-27T19:25:44Z`, and confirmed absent from the project immediately after
deletion.

- elapsed time: `3.268` hours;
- billing rule quoted before approval: partial hours may bill as full hours;
- conservative billable duration: `4` hours;
- branch rate: `$0.01344/hour`, plus usage;
- conservative branch charge: `$0.05376`, plus any metered usage.

The branch applied the complete production migration history followed by the
external API chain. Eight rollback contracts passed against the resulting
schema, generated database types included all 51 external API public
functions, and Supabase advisors reported no external API security or
performance warning/error. Private tables intentionally remain inaccessible
through direct RLS policies; the remaining security advisor entries are
informational `RLS enabled no policy` notices. The remaining performance
entries are informational `unused index` notices expected on a new empty
branch.

This approval did not cover AWS, CloudFront, GuardDuty, SQS, EventBridge,
Upstash, Vercel tier changes, production migrations, deployment, or a pilot.
None of those were provisioned or changed.

## Recommendation

Keep the approved architecture: direct-to-private-S3 upload, GuardDuty scanning,
durable EventBridge/SQS delivery, cookieless CloudFront delivery, and a
dedicated fail-closed Redis boundary.

Start CloudFront on pay-as-you-go unless an AWS account readback proves a
flat-rate plan is both eligible and better. At the expected workload, current
public allowances make CloudFront approximately `$0`; pay-as-you-go preserves
features and avoids assuming flat-plan eligibility.

Use a dedicated Upstash database with a paid plan and Prod Pack for the
production pilot. Free Upstash is suitable for development only: it has no
production SLA or multi-zone guarantee. At expected scale, PAYG plus Prod Pack
is approximately `$202/month`; above five million commands per month, the
`$10/month` Fixed 250 MB tier is cheaper than command-priced PAYG, before the
same `$200/month` Prod Pack.

The expected variable infrastructure estimate is approximately `$3.83/month`
in month one, assuming unused shared allowances. Production-grade Upstash lifts
that to approximately `$203.83/month` and is the dominant fixed decision.
Accepted-file storage is cumulative: at the expected intake rate, the same
monthly workload reaches approximately `$6.92/month` in modeled variable cost
by month 12 if no accepted files are erased or given a shorter retention
period. With zero remaining CloudFront request, transfer, or invalidation
allowance, the expected month-one estimates become `$5.70` variable and
`$205.70` production. Exhausting every modeled GuardDuty, SQS, and CloudFront
allowance raises them to `$6.01` and `$206.01`.

## Current service and contract inventory

### AWS

The checked-in application has one existing S3 integration:

- configuration names: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_S3_BUCKET`, and `AWS_REGION`;
- code defaults: bucket `ops-app-files-prod`, region `us-west-2`;
- packages: S3 client and S3 presigner only;
- checked-in infrastructure: one existing S3 CORS JSON file.

There is no checked-in SQS, EventBridge, CloudFront, GuardDuty, or dedicated
external-intake bucket implementation. The prepared worktree has no AWS CLI or
account-readable infrastructure state. Configuration names and defaults do not
prove that a resource exists or that its allowance is available.

**Exact AWS account gaps:** account identity, current S3 storage/request use,
shared free-tier consumption, dedicated-bucket existence, GuardDuty protection
status and allowance age, EventBridge rules, SQS queues/DLQs, CloudFront
distributions/plans/eligibility, WAF association, signing keys, budgets, and
discounts/credits were not available through a safe read-only account path.

### Upstash / Vercel KV

The current generic limiter recognizes Vercel KV/Upstash configuration but
falls back to process memory when Redis is absent and fails open on Redis
errors. One current check uses at least three commands (`INCR`, `EXPIRE`,
`TTL`). It cannot be reused as the new external API's durable fail-closed
limiter.

No dedicated external API Redis database, namespace, SLA, region, storage
allowance, command allowance, or billing contract is represented in the
worktree or exposed by the connected Vercel read-only project view.

**Exact Upstash gap:** database existence, current tier, accumulated commands,
storage/bandwidth use, Prod Pack status, billing owner, and credits are
unverified.

### Vercel

The connected project is `ops-web`
(`prj_hglAp4p8MWheqpQn0UDTygVwlziU`) under the OPS team. It reports:

- framework: Next.js;
- project runtime: Node `24.x`;
- configured function region in `vercel.json`: `iad1`;
- no checked-in per-function memory or duration override.

The repository declares Node `22.x`. The CI workflow still selects Node 20,
which Supabase stopped supporting on 2026-06-30. CI must move to Node 22 or
later before implementation is release-ready; Task 0 deliberately does not
change it.

The connector does not expose billing tier, included usage, consumed credits,
Fluid Compute state, function memory, or account-specific rates. The latest
production deployment record visible to the connector is `ERROR`; that is a
separate deployment-readiness issue and was not diagnosed or changed here.

**Exact Vercel gap:** plan, included credits, consumed usage, Fluid Compute
setting, memory, duration, and any enterprise contract terms remain unverified.

### Supabase live readback

Read-only connector evidence for project `ijeekuhbatykdomumfjx`:

- name: `ops-app`;
- state: `ACTIVE_HEALTHY`;
- region: `us-west-2`;
- database: PostgreSQL `17.6.1.063`;
- relevant live migrations include:
  - `20260723062347 atomic_correspondence_event_projection`;
  - `20260723093235 event_scoped_exact_recovery_lifecycle_context`;
  - `20260723214524 company_mailbox_intake_owner`;
- the live migration list continues through
  `20260723233348 operator_one_tap_lead_follow_up`;
- no planned `20260724030000`–`20260724037000` external API migration is
  applied, and the checked-in migration directory has no collision in that
  reserved sequence.

Live column readback confirmed `clients`, `sub_clients`, `opportunities`,
`stage_transitions`, `opportunity_dispositions`,
`opportunity_conversion_events`, `opportunity_correspondence_events`,
`opportunity_lifecycle_state`, and
`opportunity_lifecycle_action_audit`, plus invoices, payments, notifications,
and the assignment event/delivery/suggestion tables. In particular:

- correspondence events currently carry `is_meaningful`, `noise_reason`, and
  `opportunity_projection_applied`, but no response-definition version or
  explicit `counts_as_first_response`;
- lifecycle state retains last-meaningful event/direction/time and follow-up
  state;
- conversion events retain company, opportunity, project, actor, assignment
  version, payload, and event time;
- stage transitions retain from/to stage, actor, transition time, and duration.
- invoices have a nullable direct `opportunity_id`, numeric totals, `status`,
  `issue_date`, and `deleted_at`; payments link through a required
  `invoice_id` and expose numeric `amount`, `payment_date`, and `voided_at`
  rather than a direct opportunity ID;
- notifications still store `user_id`, `company_id`, and `project_id` as text,
  while resolution actors are UUIDs; persistent/action/dedupe/resolution
  columns are present;
- assignment events are versioned and snapshot actor/assignee evidence;
  assignment deliveries carry lease, retry, notification, disposition, push,
  and terminal state; suggestions carry generator, confidence, signal, and
  resolution evidence.

Live RLS readback:

- RLS is enabled on invoices, payments, notifications, stage transitions,
  dispositions, conversion events, correspondence events, lifecycle state,
  lifecycle action audit, email-thread links, and assignment
  event/delivery/suggestion tables;
- `unassigned_lead_assignment_deliveries` has forced RLS and no direct policy;
- the checked-in migration also revokes its direct table access and exposes
  only fixed service-role commands. It remains email-connection-specific, so
  the planned `source_kind`/`source_id` generalization is still required.

The connector completed targeted table/column/RLS reads and the applied
migration inventory, but repeated broader catalog and routine-definition reads
failed with the exact error:

```text
Connection terminated due to connection timeout
```

Accordingly, live index definitions, constraint definitions, complete table
grants, routine ACLs, and routine bodies are not claimed as freshly verified.
The checked-in applied migrations were read end-to-end for those contracts.
Every schema task must repeat a narrow live table/index/constraint/grant/routine
readback before writing SQL.

The current project setting for automatic Data API grants was not exposed by
the connector. New external objects must therefore carry explicit grants,
revokes, RLS, policies, and fixed function ACLs regardless of the dashboard
default.

## Planning volumes

The high column is an approval ceiling for estimating only. It is **not**
approved traffic, spend, or pilot capacity.

| Input                                         |      Low |  Expected | High approval ceiling |
| --------------------------------------------- | -------: | --------: | --------------------: |
| Leads / month                                 |      100 |     1,000 |                 3,000 |
| Files / month                                 |       50 |     2,000 |                 6,000 |
| Average file                                  |    2 MiB |     5 MiB |                 5 MiB |
| New scan volume                               | 0.10 GiB |   9.8 GiB |              29.3 GiB |
| Scan objects                                  |       50 |     2,000 |                 6,000 |
| API requests                                  |   10,000 |   100,000 |             1,000,000 |
| Redis commands                                |  100,000 | 1,000,000 |            10,000,000 |
| CDN downloads                                 |      100 |     4,000 |                12,000 |
| CDN transfer                                  |  0.2 GiB |  19.5 GiB |              58.6 GiB |
| Privacy-erased leads / files                  |    1 / 1 |   10 / 20 |               30 / 60 |
| Stale cleanup objects                         |        3 |       100 |                   300 |
| S3 charged write-class requests               |      200 |     8,000 |                24,000 |
| S3 charged `HEAD` requests                    |      156 |     6,160 |                18,480 |
| S3 charged `GET` requests                     |      250 |    10,000 |                30,000 |
| S3 free `DELETE` requests                     |        6 |       160 |                   480 |
| SQS request units                             |      209 |     8,300 |                24,900 |
| EventBridge event-unit floor                  |      100 |     4,000 |                12,000 |
| Privacy-erasure CloudFront invalidation paths |        2 |        40 |                   120 |

Assumptions:

- the expected/high file size is the conservative planning average, not the
  25 MiB per-file contract maximum;
- one accepted month retains 1.25 times ingest volume for the original,
  derivative, metadata, and object-version overhead;
- two file deliveries per accepted file;
- 1% of leads and files receive a privacy-erasure request each month, rounded
  up independently, and 5% of files leave one stale object for cleanup;
- 20 API requests per low/expected lead, with the high case deliberately
  rounded to one million requests;
- ten Redis commands per API request until the final atomic limiter/cache
  implementation is measured;
- four base SQS units per file plus three units for a 5% retry set, rounded up;
  payloads over 64 KiB, DLQ traffic, and replay drills add units;
- two EventBridge units per file;
- immutable versioned object keys avoid routine CloudFront invalidation, but a
  privacy erasure still invalidates the exact original and derivative paths;
- accepted storage is retained until privacy erasure or a separately approved
  retention rule. Month-12 storage therefore models 12 accumulated intake
  months.

## Current public rate card and formulas

### S3 Standard, `us-west-2`

Planning rates:

- storage: `$0.023/GiB-month` for the first 50 TB;
- PUT/COPY/POST/LIST: `$0.005/1,000`;
- GET/other: `$0.0004/1,000`;
- DELETE: free;
- S3-origin transfer to CloudFront: free.

Formula:

```text
S3 = 0.023 × stored_GiB
    + 0.005 × write_or_list_requests / 1,000
    + 0.0004 × read_requests / 1,000
```

The request estimate deliberately expands every modeled action:

| Request class            | Per-file or cleanup action                                        |     Low |   Expected |       High |
| ------------------------ | ----------------------------------------------------------------- | ------: | ---------: | ---------: |
| Charged write            | original `PUT`                                                    |      50 |      2,000 |      6,000 |
| Charged write            | canonical `COPY`                                                  |      50 |      2,000 |      6,000 |
| Charged write            | derivative `PUT`                                                  |      50 |      2,000 |      6,000 |
| Charged write            | scan-disposition `PutObjectTagging`                               |      50 |      2,000 |      6,000 |
| Charged write            | `LIST`                                                            |       0 |          0 |          0 |
| **Charged write total**  | four per file                                                     | **200** |  **8,000** | **24,000** |
| Charged read             | base `HEAD` for claim, inspection, and derivative                 |     150 |      6,000 |     18,000 |
| Charged read             | deletion-readback `HEAD`                                          |       6 |        160 |        480 |
| **Charged `HEAD` total** |                                                                   | **156** |  **6,160** | **18,480** |
| Charged read             | structural-inspection `GET`                                       |      50 |      2,000 |      6,000 |
| Charged read             | derivative-worker `GET`                                           |      50 |      2,000 |      6,000 |
| Charged read             | conservative GuardDuty S3 read-equivalent `GET`                   |      50 |      2,000 |      6,000 |
| Charged read             | CloudFront origin `GET`, two downloads/file with caching disabled |     100 |      4,000 |     12,000 |
| **Charged `GET` total**  | five per file                                                     | **250** | **10,000** | **30,000** |
| Free delete              | three keys per erased file plus stale cleanup                     |       6 |        160 |        480 |

`LIST` is zero because the database ledger supplies exact object keys.
Deletion readback is three `HEAD` requests per privacy-erased file plus one per
stale cleanup object. The worst-case CloudFront origin row disables caching so
every download reaches S3. GuardDuty's documented extra S3 API billing depends
on the scan path; one read-equivalent `GET` per file is reserved here until
measured. `DELETE` is counted and shown even though its S3 request price is
zero.

Every retained object version consumes storage. Sources:
[S3 pricing](https://aws.amazon.com/s3/pricing/) and the
[official `us-west-2` offer file](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-west-2/index.json).

### GuardDuty Malware Protection for S3

Planning rate:

- `$0.09/GiB scanned`;
- `$0.215/1,000 objects`;
- eligible monthly allowance: 1 GiB and 1,000 objects.

Eligible formula:

```text
GuardDuty = 0.09 × max(scanned_GiB − 1, 0)
          + 0.000215 × max(objects − 1,000, 0)
```

Without the allowance:

```text
GuardDuty = 0.09 × scanned_GiB + 0.000215 × objects
```

The public `$0.09` example is US East; the AWS price offer reports the same
current `us-west-2` rate, but account eligibility remains unverified. S3 APIs
used by scanning are billed separately. Sources:
[GuardDuty pricing](https://aws.amazon.com/guardduty/pricing/),
[GuardDuty S3 pricing details](https://docs.aws.amazon.com/guardduty/latest/ug/pricing-malware-protection-for-s3-guardduty.html),
and the
[official `us-west-2` offer file](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonGuardDuty/current/us-west-2/index.json).

### SQS and EventBridge

SQS Standard provides the first one million account-wide request units per
month free, then charges `$0.40/million`. Each API action is a request; payload
chunks over 64 KiB multiply units.

```text
SQS = 0.40 × max(request_units − unused_free_units, 0) / 1,000,000
```

The base path reserves four 64 KiB request units per file. A 5% retry set,
rounded up, reserves three more units per retried file:

| SQS units                       |     Low |  Expected |       High |
| ------------------------------- | ------: | --------: | ---------: |
| Base, `4 × files`               |     200 |     8,000 |     24,000 |
| Retry files, `ceil(5% × files)` |       3 |       100 |        300 |
| Retry units, `3 × retry files`  |       9 |       300 |        900 |
| **Total units**                 | **209** | **8,300** | **24,900** |

EventBridge AWS opt-in data events are `$1/million` 64 KiB units; delivery to a
service in the same account is free.

```text
EventBridge = 1.00 × event_units / 1,000,000
```

Sources: [SQS pricing](https://aws.amazon.com/sqs/pricing/) and
[EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/).

### CloudFront

Current flat-rate tiers:

| Tier     |  Monthly |    Requests | Transfer |
| -------- | -------: | ----------: | -------: |
| Free     |     `$0` |   1 million |   100 GB |
| Pro      |    `$15` |  10 million |    50 TB |
| Business |   `$200` | 125 million |    50 TB |
| Premium  | `$1,000` | 500 million |    50 TB |

Flat plans have no monetary overage, but AWS may reduce performance after
sustained excess. Free-plan count, historical usage, account Free Tier status,
distribution associations, WAF, and unsupported features affect eligibility.

Pay-as-you-go currently includes an account-wide monthly allowance of 1 TB
internet transfer and 10 million HTTP/HTTPS requests. North America usage after
the allowance is `$0.085/GiB` and `$0.01/10,000` HTTPS requests.

```text
CloudFront paygo =
    0.085 × excess_transfer_GiB
  + 0.01 × excess_HTTPS_requests / 10,000
  + 0.005 × excess_invalidation_paths
```

The first 1,000 invalidation paths per account per month are free. Versioned
keys avoid routine invalidation, but privacy erasure is different: it must
remove cached copies of the exact original and derivative paths. At the
modeled 1% file-erasure rate that is 2, 40, and 120 exact paths. They cost
`$0` if the account-wide invalidation allowance remains, or `$0.01`, `$0.20`,
and `$0.60` if none remains.

The deliberately conservative zero-allowance case also charges every modeled
download request and byte:

| CloudFront pay-as-you-go case                           |           Low |      Expected |          High |
| ------------------------------------------------------- | ------------: | ------------: | ------------: |
| Transfer + HTTPS requests, shared allowances remain     |     `$0.0000` |     `$0.0000` |     `$0.0000` |
| Exact erasure invalidations, first 1,000 paths remain   |     `$0.0000` |     `$0.0000` |     `$0.0000` |
| Transfer + HTTPS requests, zero allowance               |     `$0.0167` |     `$1.6642` |     `$4.9925` |
| Exact erasure invalidations, zero allowance             |     `$0.0100` |     `$0.2000` |     `$0.6000` |
| **Total, zero request/transfer/invalidation allowance** | **`$0.0267`** | **`$1.8642`** | **`$5.5925`** |

Sources:
[flat-rate plans](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html),
[pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/),
and
[invalidation pricing](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/PayingForInvalidation.html).

### Upstash Redis

Current tiers relevant to this design:

- Free: `$0`, 500,000 commands, 256 MB, 10 GB bandwidth;
- PAYG: `$0.20/100,000 commands`, first 1 GB storage free, then
  `$0.25/GiB-month`; first 200 GB bandwidth free, then `$0.03/GiB`;
- Fixed 250 MB: `$10/month`, unlimited commands, 50 GB bandwidth;
- Prod Pack: `+$200/database-month` for SLA, multi-zone HA, encryption at
  rest, and production monitoring.

Paid tiers do not also receive the Free tier's 500,000 commands.

```text
PAYG Redis =
    0.20 × commands / 100,000
  + 0.25 × max(storage_GiB − 1, 0)
  + 0.03 × max(bandwidth_GiB − 200, 0)
  + optional 200 Prod Pack
```

Source: [Upstash Redis pricing](https://upstash.com/pricing/redis).

### Vercel Functions, `iad1`

Vercel caps both Function request and response bodies at 4.5 MB. The API's
25 MiB file contract must therefore use direct-to-S3 upload capabilities.

Current public Fluid Compute rates for `iad1`:

- active CPU: `$0.128/hour`;
- provisioned memory: `$0.0106/GiB-hour`;
- invocations: `$0.60/million` (`$0.0000006` each), net of any applicable
  included credit.

```text
Functions =
    0.128 × active_CPU_hours
  + 0.0106 × provisioned_memory_GiB_hours
  + 0.0000006 × billable_invocations
```

Before load testing, every planned execution class is charged separately at
public list rate, before any plan credit:

```text
class cost =
    invocation_count
  × (0.0000006
     + active_CPU_seconds / 3,600 × 0.128
     + memory_GiB × wall_seconds / 3,600 × 0.0106)
```

| Execution class                 | Invocation assumption                      |        Low |    Expected |          High | CPU / memory / wall per invocation |   Modeled cost, low / expected / high |
| ------------------------------- | ------------------------------------------ | ---------: | ----------: | ------------: | ---------------------------------- | ------------------------------------: |
| Public API                      | scenario API requests                      |     10,000 |     100,000 |     1,000,000 | 0.05 s / 2 GiB / 0.25 s            |     `$0.0385` / `$0.3850` / `$3.8500` |
| Attachment and queue inspection | two per file                               |        100 |       4,000 |        12,000 | 0.30 s / 2 GiB / 2.00 s            |     `$0.0023` / `$0.0922` / `$0.2765` |
| Lead outbox and projection      | three per lead                             |        300 |       3,000 |         9,000 | 0.10 s / 1 GiB / 0.50 s            |     `$0.0017` / `$0.0169` / `$0.0507` |
| Privacy erasure                 | 1% of leads, rounded up                    |          1 |          10 |            30 | 0.50 s / 2 GiB / 3.00 s            |    `<$0.0001` / `$0.0004` / `$0.0011` |
| Retry execution                 | 5% of the three worker classes, rounded up |         21 |         351 |         1,052 | 0.20 s / 2 GiB / 1.00 s            |     `$0.0003` / `$0.0048` / `$0.0143` |
| Maintenance cron                | one daily invocation                       |         30 |          30 |            30 | 0.10 s / 1 GiB / 2.00 s            |     `$0.0003` / `$0.0003` / `$0.0003` |
| **All modeled Function usage**  |                                            | **10,452** | **107,391** | **1,022,112** |                                    | **`$0.0431` / `$0.4995` / `$4.1929`** |

The retry count is `ceil(5% × (attachment/queue + outbox/projection + privacy
erasure invocations))`. This conservatively assumes attachment inspection,
queue consumption, lead outbox/projection, privacy erasure, retries, and the
maintenance cron all run on Vercel. If an approved AWS worker later owns any
class, the Vercel row must be removed and the destination service priced
instead. Measured concurrency, active CPU, memory, duration, and retry rates
must replace these pre-load-test assumptions.

Sources:
[Function limits](https://vercel.com/docs/functions/limitations) and
[Function usage and pricing](https://vercel.com/docs/functions/usage-and-pricing).

## Scenario estimate

The primary table uses the eligible GuardDuty allowance, unused account-wide
SQS/CloudFront allowances, the full Vercel execution model above, and no
Supabase incremental charge. “Month 12” replaces first-month S3 storage with
12 accumulated intake months; scanning and requests remain one current month.

| Cost component                                                                     |          Low |     Expected | High approval ceiling |
| ---------------------------------------------------------------------------------- | -----------: | -----------: | --------------------: |
| S3, month 1 storage + 4 writes/file + modeled reads                                |    `$0.0040` |    `$0.3272` |             `$0.9817` |
| S3, month 12 storage + current requests                                            |    `$0.0349` |    `$3.4156` |            `$10.2468` |
| GuardDuty, eligible allowance                                                      |    `$0.0000` |    `$1.0039` |             `$3.6217` |
| GuardDuty, no allowance                                                            |    `$0.0195` |    `$1.3089` |             `$3.9267` |
| EventBridge, two events/file                                                       |    `$0.0001` |    `$0.0040` |             `$0.0120` |
| SQS, shared allowance remains                                                      |    `$0.0000` |    `$0.0000` |             `$0.0000` |
| SQS, no allowance                                                                  |    `$0.0001` |    `$0.0033` |             `$0.0100` |
| CloudFront request/transfer + exact erasure invalidation, shared allowances remain |    `$0.0000` |    `$0.0000` |             `$0.0000` |
| CloudFront request/transfer + exact erasure invalidation, zero allowance           |    `$0.0267` |    `$1.8642` |             `$5.5925` |
| Vercel, all modeled Function classes                                               |    `$0.0431` |    `$0.4995` |             `$4.1929` |
| Redis variable tier                                                                | `$0.00` Free | `$2.00` PAYG |        `$10.00` Fixed |
| Prod Pack for production                                                           |   `+$200.00` |   `+$200.00` |            `+$200.00` |

The primary shared-allowance subtotals are:

| Shared allowances remain          |            Low |      Expected | High approval ceiling |
| --------------------------------- | -------------: | ------------: | --------------------: |
| **Variable subtotal, month 1**    |    **`$0.05`** |   **`$3.83`** |          **`$18.81`** |
| **Variable subtotal, month 12**   |    **`$0.08`** |   **`$6.92`** |          **`$28.07`** |
| **Production subtotal, month 1**  | **`$200.25`*** | **`$203.83`** |         **`$218.81`** |
| **Production subtotal, month 12** | **`$200.28`*** | **`$206.92`** |         **`$228.07`** |

Alternate subtotals make the account-wide allowance uncertainty numeric in
every scenario:

| Allowance case                                            |       Low |  Expected | High approval ceiling |
| --------------------------------------------------------- | --------: | --------: | --------------------: |
| Variable month 1, zero CloudFront allowance               |   `$0.07` |   `$5.70` |              `$24.40` |
| Production month 1, zero CloudFront allowance             | `$200.27` | `$205.70` |             `$224.40` |
| Production month 12, zero CloudFront allowance            | `$200.30` | `$208.79` |             `$233.67` |
| Variable month 1, all modeled AWS allowances exhausted    |   `$0.09` |   `$6.01` |              `$24.72` |
| Production month 1, all modeled AWS allowances exhausted  | `$200.29` | `$206.01` |             `$224.72` |
| Production month 12, all modeled AWS allowances exhausted | `$200.32` | `$209.10` |             `$233.98` |

\* Prod Pack cannot be attached to Free. The low production subtotal therefore
uses PAYG Redis (`$0.20`) plus Prod Pack, replacing the `$0` development tier.

“Zero CloudFront allowance” charges all request, transfer, and exact
privacy-erasure invalidation paths. “All modeled AWS allowances exhausted”
also replaces eligible GuardDuty cost with the no-allowance row and charges
every SQS request unit. A CloudFront Pro flat plan would instead add
`$15/month`; Business would add `$200/month`.

Supabase remains on the existing project in this design, and file bytes bypass
it. Database compute, storage, egress, and plan headroom were not exposed by the
connector, so `$0 incremental` is conditional rather than a confirmed contract
allowance.

## Current platform changes that affect implementation

- [Supabase Node 20 support ended 2026-06-30](https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20).
  Repository Node 22 and Vercel Node 24 are supported; CI Node 20 is not.
- [Explicit extension version pins are ignored starting 2026-08-05](https://supabase.com/changelog/extension-version-pinning-ignored).
  Planned migrations must not depend on pinning an extension version.
- [New public tables require deliberate Data API grants](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).
  Enforcement reaches existing projects on 2026-10-30. The approved design's
  private tables plus fixed public wrappers and explicit ACLs remain correct.

## Approval checklist

Before provisioning, the approver must receive a refreshed read-only inventory
and explicitly approve:

1. the exact AWS account, payer, `us-west-2` rates, current shared allowances,
   GuardDuty eligibility, and resource names;
2. a dedicated versioned private S3 bucket, encryption, lifecycle rules,
   Block Public Access, and budget alarms;
3. GuardDuty Malware Protection scope and spend cap;
4. EventBridge rules plus SQS queue, DLQ, replay, retention, and alarms;
5. CloudFront pay-as-you-go versus an eligible flat plan, OAC, WAF, signed URL
   keys, logs, and budget;
6. the dedicated Upstash tier, region, budget cap, and Prod Pack
   (`~$200/month`);
7. Vercel plan credits, Fluid Compute, memory/duration, and projected usage;
8. Supabase compute/storage headroom and current Data API default privileges;
9. the pilot company, approved-high monthly ceiling, and automatic spend
   alerts.

Until all nine are approved:

> **NOT APPROVED — DO NOT PROVISION, DEPLOY, APPLY A MIGRATION, CHANGE A PAID
> TIER, OR ENABLE A PILOT.**
