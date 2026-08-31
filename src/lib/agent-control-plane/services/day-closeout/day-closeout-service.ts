import "server-only";

import { createHash } from "node:crypto";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import type { ActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import {
  isActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  DAY_CLOSEOUT_COMPONENTS,
  DAY_CLOSEOUT_MAX_EVIDENCE_REFS,
  DAY_CLOSEOUT_MAX_FINDINGS,
  DAY_CLOSEOUT_METRIC_DEFINITION_REVISION,
  DAY_CLOSEOUT_PROMPT_SAFETY_DIRECTIVE,
  DAY_CLOSEOUT_SCHEMA_REVISION,
  PrepareDayCloseoutInputSchema,
  type DayCloseoutResult,
  type PrepareDayCloseoutInput,
} from "@/lib/agent-control-plane/contracts/day-closeout";
import { CONTRACT_VERSION } from "@/lib/agent-control-plane/contracts/version";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import {
  CAPABILITY_MANIFEST_REVISION,
  resolveInvisibleOfficeCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import type { OpsAgentReadCatalogueService } from "@/lib/agent-control-plane/services/read-catalogue-service";
import {
  isTrustedDayCloseoutRepository,
  type DayCloseoutCorrespondenceCoverage,
  type DayCloseoutRepository,
} from "./day-closeout-repository";

const DAY_CLOSEOUT_CAPABILITY = "prepare_day_closeout" as const;
const MAX_SOURCE_PAGES = 4;
const MAX_SOURCE_ITEMS = 100;
const OUTSTANDING_INVOICE_STATUSES = new Set([
  "awaiting_payment",
  "partially_paid",
  "past_due",
  "sent",
]);
const TRUSTED_SERVICES = new WeakSet<object>();

type Finding = DayCloseoutResult["findings"][number];
type Component = DayCloseoutResult["components"][number];
type SourceRevision = Component["source_revisions"][number];

interface PageSnapshot<T> {
  readonly items: T[];
  readonly evidenceRefs: string[];
  readonly sourceRevisions: SourceRevision[];
  readonly hasMore: boolean;
  readonly freshAt: string;
}

function tomorrowWindow(businessDate: string, timezone: string) {
  const calendarAnchor = new Date(`${businessDate}T12:00:00.000Z`);
  const tomorrow = new Date(calendarAnchor);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const afterTomorrow = new Date(calendarAnchor);
  afterTomorrow.setUTCDate(afterTomorrow.getUTCDate() + 2);
  const tomorrowDate = formatInTimeZone(tomorrow, "UTC", "yyyy-MM-dd");
  const afterTomorrowDate = formatInTimeZone(
    afterTomorrow,
    "UTC",
    "yyyy-MM-dd"
  );
  return {
    start: fromZonedTime(`${tomorrowDate}T00:00:00`, timezone).toISOString(),
    end: fromZonedTime(`${afterTomorrowDate}T00:00:00`, timezone).toISOString(),
  };
}

function canonicalRevisions(
  revisions: readonly SourceRevision[]
): SourceRevision[] {
  const byDomain = new Map<string, number>();
  for (const revision of revisions) {
    const current = byDomain.get(revision.domain);
    if (current === undefined || revision.source_revision > current) {
      byDomain.set(revision.domain, revision.source_revision);
    }
  }
  return [...byDomain.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([domain, source_revision]) => ({ domain, source_revision }));
}

function legacyRevisions(
  values: readonly {
    source_domain: string;
    source_type: string;
    version: string;
  }[]
): SourceRevision[] {
  return canonicalRevisions(
    values.flatMap((value) => {
      const parsed = Number(value.version);
      return Number.isSafeInteger(parsed) && parsed >= 0
        ? [
            {
              domain: `${value.source_domain}.${value.source_type}`,
              source_revision: parsed,
            },
          ]
        : [];
    })
  );
}

function evidence(values: readonly string[]): string[] {
  return [...new Set(values)].slice(0, DAY_CLOSEOUT_MAX_EVIDENCE_REFS);
}

function coverage(
  snapshot: PageSnapshot<unknown>,
  inspectedCount = snapshot.items.length
): Component["coverage"] {
  return snapshot.hasMore
    ? {
        state: "partial",
        inspected_count: inspectedCount,
        omitted_count: 1,
        missing_reasons: ["result_bound_reached"],
        fresh_at: snapshot.freshAt,
      }
    : {
        state: "complete",
        inspected_count: inspectedCount,
        omitted_count: 0,
        missing_reasons: [],
        fresh_at: snapshot.freshAt,
      };
}

function unavailableComponent(
  component: Component["component"],
  endAtExclusive: string,
  freshAt: string,
  startAt: string | null = null
): Component {
  return {
    component,
    state: "not_evaluated",
    time_window: { start_at: startAt, end_at_exclusive: endAtExclusive },
    population_count: 0,
    attention_count: null,
    coverage: {
      state: "unavailable",
      inspected_count: 0,
      omitted_count: 0,
      missing_reasons: ["source_unavailable"],
      fresh_at: freshAt,
    },
    source_revisions: [],
    evidence_refs: [],
  };
}

function toFinding(input: {
  ref: string;
  component: Finding["component"];
  reason: Finding["reason"];
  priority: Finding["priority"];
  title: string;
  kind: Finding["subject_ref"]["kind"];
  id: string;
  attentionAt: string;
}): Finding {
  return {
    finding_ref: input.ref,
    component: input.component,
    reason: input.reason,
    priority: input.priority,
    title: input.title,
    subject_ref: { kind: input.kind, id: input.id },
    attention_at: input.attentionAt,
    content_kind: "untrusted_business_data",
  };
}

async function resolveProductionReadActor(input: {
  actorContext: ActorContext;
  authorityRepository: ActorAuthorityRepository;
  signal?: AbortSignal;
}): Promise<ActorContext> {
  return await reauthorizeResolvedMcpActor({
    actorContext: input.actorContext,
    authorityRepository: input.authorityRepository,
    capabilityManifestRevision: CAPABILITY_MANIFEST_REVISION,
    signal: input.signal,
  });
}

async function readWorkQueue(
  service: OpsAgentReadCatalogueService,
  actor: ActorContext,
  signal?: AbortSignal
): Promise<
  PageSnapshot<
    Awaited<
      ReturnType<OpsAgentReadCatalogueService["listWorkQueue"]>
    >["items"][number]
  >
> {
  type Result = Awaited<
    ReturnType<OpsAgentReadCatalogueService["listWorkQueue"]>
  >;
  const items: Result["items"][number][] = [];
  const evidenceRefs: string[] = [];
  const revisions: SourceRevision[] = [];
  let cursor: string | undefined;
  let result: Result | null = null;
  for (let page = 0; page < MAX_SOURCE_PAGES; page += 1) {
    result = await service.listWorkQueue(
      actor,
      {
        sources: ["task", "lead", "correspondence", "commitment", "schedule"],
        limit: 25,
        ...(cursor ? { cursor } : {}),
      },
      signal ? { signal } : undefined
    );
    items.push(...result.items);
    evidenceRefs.push(...result.evidence.map((item) => item.evidence_ref));
    revisions.push(...result.collection_proof.source_revisions);
    cursor = result.next_cursor ?? undefined;
    if (!cursor || items.length >= MAX_SOURCE_ITEMS) break;
  }
  if (!result) throw new TypeError("Work queue did not return a page");
  return {
    items: items.slice(0, MAX_SOURCE_ITEMS),
    evidenceRefs: evidence(evidenceRefs),
    sourceRevisions: canonicalRevisions(revisions),
    hasMore: cursor !== undefined,
    freshAt: result.collection_proof.read_at,
  };
}

async function readInvoices(
  service: OpsAgentReadCatalogueService,
  actor: ActorContext,
  signal?: AbortSignal
): Promise<
  PageSnapshot<
    Extract<
      Awaited<
        ReturnType<OpsAgentReadCatalogueService["listSalesDocuments"]>
      >["items"][number],
      { document_ref: { kind: "invoice" } }
    >
  >
> {
  type Result = Awaited<
    ReturnType<OpsAgentReadCatalogueService["listSalesDocuments"]>
  >;
  type Invoice = Extract<
    Result["items"][number],
    { document_ref: { kind: "invoice" } }
  >;
  const items: Invoice[] = [];
  const evidenceRefs: string[] = [];
  const revisions: SourceRevision[] = [];
  let cursor: string | undefined;
  let result: Result | null = null;
  for (let page = 0; page < MAX_SOURCE_PAGES; page += 1) {
    result = await service.listSalesDocuments(
      actor,
      {
        document_kinds: ["invoice"],
        limit: 25,
        ...(cursor ? { cursor } : {}),
      },
      signal ? { signal } : undefined
    );
    items.push(
      ...result.items.filter(
        (item): item is Invoice => item.document_ref.kind === "invoice"
      )
    );
    evidenceRefs.push(...result.evidence.map((item) => item.evidence_ref));
    revisions.push(...result.collection_proof.source_revisions);
    cursor = result.next_cursor ?? undefined;
    if (!cursor || items.length >= MAX_SOURCE_ITEMS) break;
  }
  if (!result) throw new TypeError("Invoice read did not return a page");
  return {
    items: items.slice(0, MAX_SOURCE_ITEMS),
    evidenceRefs: evidence(evidenceRefs),
    sourceRevisions: canonicalRevisions(revisions),
    hasMore: cursor !== undefined,
    freshAt: result.collection_proof.read_at,
  };
}

export interface DayCloseoutService {
  prepareDayCloseout(
    actorContext: ActorContext,
    input: PrepareDayCloseoutInput,
    options?: {
      signal?: AbortSignal;
      routine?: {
        routineId: string;
        claimToken: string;
        scheduledFor: string;
        scheduleRevision: number;
      };
    }
  ): Promise<DayCloseoutResult>;
}

export function createDayCloseoutService(input: {
  readService: OpsAgentReadCatalogueService;
  repository: DayCloseoutRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
}): DayCloseoutService {
  if (!isTrustedDayCloseoutRepository(input.repository)) {
    throw new TypeError("A trusted day-closeout repository is required");
  }
  if (!input.readService || !input.authorityRepository) {
    throw new TypeError("Day closeout dependencies are required");
  }
  const now = input.now ?? (() => new Date());
  const service: DayCloseoutService = {
    async prepareDayCloseout(actorContext, rawInput, options) {
      if (!isActorContext(actorContext)) {
        throw authorizationInternal(
          "unknown-request",
          "day_closeout_actor_context_untrusted"
        );
      }
      const parsedInput = PrepareDayCloseoutInputSchema.parse(rawInput);
      const resolved = resolveInvisibleOfficeCapabilityAuthorization(
        DAY_CLOSEOUT_CAPABILITY,
        parsedInput
      );
      if (resolved.variants.length !== 1) {
        throw authorizationInternal(
          actorContext.requestId,
          "day_closeout_authorization_invalid"
        );
      }
      authorizeCapability({
        actorContext,
        policy: resolved.variants[0]!.policy,
      });

      const preparedAt = now();
      const preparedAtIso = preparedAt.toISOString();
      const timezone =
        parsedInput.display_timezone ??
        (await input.repository.resolveTimezone(actorContext, options?.signal));
      const businessDate =
        parsedInput.business_date ??
        formatInTimeZone(preparedAt, timezone, "yyyy-MM-dd");
      const tomorrow = tomorrowWindow(businessDate, timezone);
      const productionActor = await resolveProductionReadActor({
        actorContext,
        authorityRepository: input.authorityRepository,
        signal: options?.signal,
      });

      const [
        scheduleState,
        readinessState,
        workState,
        invoiceState,
        mailState,
      ] = await Promise.allSettled([
        input.readService.listScheduledJobs(
          productionActor,
          {
            from: tomorrow.start,
            to: tomorrow.end,
            task_statuses: ["active"],
            display_timezone: timezone,
            limit: 50,
          },
          options
        ),
        input.readService.listJobReadinessIssues(
          productionActor,
          {
            from: tomorrow.start,
            to: tomorrow.end,
            rule_codes: [
              "SCHEDULE_UNCONFIRMED",
              "CREW_UNASSIGNED",
              "ADDRESS_INCOMPLETE",
            ],
            include_clear: false,
            limit: 50,
          },
          options
        ),
        readWorkQueue(input.readService, productionActor, options?.signal),
        readInvoices(input.readService, productionActor, options?.signal),
        input.repository.inspectCorrespondence({
          actorContext,
          startAt: new Date(
            preparedAt.getTime() - 7 * 86_400_000
          ).toISOString(),
          endAt: preparedAtIso,
          signal: options?.signal,
        }),
      ]);

      const findings: Finding[] = [];
      const components: Component[] = [];
      if (
        scheduleState.status === "fulfilled" &&
        readinessState.status === "fulfilled"
      ) {
        const schedule = scheduleState.value;
        const readiness = readinessState.value;
        const readinessFindings = readiness.data.jobs
          .slice(0, 50)
          .map((job) => {
            const rules = job.rules.filter((rule) => rule.status === "issue");
            const codes = rules.map((rule) => rule.rule_code);
            const reason: Finding["reason"] = codes.includes("CREW_UNASSIGNED")
              ? "crew_unassigned"
              : codes.includes("SCHEDULE_UNCONFIRMED")
                ? "confirmation_required"
                : "readiness_issue";
            return toFinding({
              ref: `finding:readiness:${job.job_ref.id}`,
              component: "tomorrow_readiness",
              reason,
              priority: "attention",
              title: job.title,
              kind: "project",
              id: job.job_ref.id,
              attentionAt: tomorrow.start,
            });
          });
        findings.push(...readinessFindings);
        const partial = schedule.page?.has_more || readiness.page?.has_more;
        components.push({
          component: "tomorrow_readiness",
          state: readinessFindings.length > 0 ? "attention" : "clear",
          time_window: {
            start_at: tomorrow.start,
            end_at_exclusive: tomorrow.end,
          },
          population_count: schedule.data.returned_occurrence_count,
          attention_count: readinessFindings.length,
          coverage: partial
            ? {
                state: "partial",
                inspected_count:
                  schedule.data.returned_occurrence_count +
                  readiness.data.evaluated_candidate_count,
                omitted_count: 1,
                missing_reasons: ["result_bound_reached"],
                fresh_at: preparedAtIso,
              }
            : {
                state: "complete",
                inspected_count:
                  schedule.data.returned_occurrence_count +
                  readiness.data.evaluated_candidate_count,
                omitted_count: 0,
                missing_reasons: [],
                fresh_at: preparedAtIso,
              },
          source_revisions: canonicalRevisions([
            ...legacyRevisions(schedule.freshness.source_versions),
            ...legacyRevisions(readiness.freshness.source_versions),
          ]),
          evidence_refs: evidence([
            ...schedule.evidence.map((item) => item.evidence_id),
            ...readiness.evidence.map((item) => item.evidence_id),
          ]),
        });
      } else {
        components.push(
          unavailableComponent(
            "tomorrow_readiness",
            tomorrow.end,
            preparedAtIso,
            tomorrow.start
          )
        );
      }

      const balances = new Map<
        string,
        { amount_minor: number; invoice_count: number }
      >();
      if (invoiceState.status === "fulfilled") {
        const invoices = invoiceState.value;
        const attention = invoices.items.filter(
          (invoice) =>
            OUTSTANDING_INVOICE_STATUSES.has(invoice.status) &&
            invoice.balance_due.amount_minor > 0
        );
        for (const invoice of attention) {
          const current = balances.get(invoice.balance_due.currency) ?? {
            amount_minor: 0,
            invoice_count: 0,
          };
          current.amount_minor += invoice.balance_due.amount_minor;
          current.invoice_count += 1;
          balances.set(invoice.balance_due.currency, current);
          const overdue =
            invoice.status === "past_due" || invoice.due_date < businessDate;
          findings.push(
            toFinding({
              ref: `finding:invoice:${invoice.document_ref.id}`,
              component: "outstanding_money",
              reason: overdue ? "invoice_overdue" : "invoice_due",
              priority: overdue ? "critical" : "attention",
              title: invoice.document_number,
              kind: "invoice",
              id: invoice.document_ref.id,
              attentionAt: fromZonedTime(
                `${invoice.due_date}T00:00:00`,
                timezone
              ).toISOString(),
            })
          );
        }
        components.push({
          component: "outstanding_money",
          state: attention.length > 0 ? "attention" : "clear",
          time_window: { start_at: null, end_at_exclusive: preparedAtIso },
          population_count: invoices.items.length,
          attention_count: attention.length,
          coverage: coverage(invoices),
          source_revisions: invoices.sourceRevisions,
          evidence_refs: invoices.evidenceRefs,
        });
      } else {
        components.push(
          unavailableComponent(
            "outstanding_money",
            preparedAtIso,
            preparedAtIso
          )
        );
      }

      let correspondenceCoverage: DayCloseoutCorrespondenceCoverage | null =
        mailState.status === "fulfilled" ? mailState.value : null;
      let communicationBriefs: DayCloseoutResult["communication_briefs"] = [];
      if (workState.status === "fulfilled") {
        const work = workState.value;
        const leadItems = work.items.filter((item) => item.source === "lead");
        const correspondenceItems = work.items.filter(
          (item) =>
            item.source === "correspondence" || item.source === "commitment"
        );
        const dueItems = work.items.filter(
          (item) => item.source === "task" || item.source === "schedule"
        );
        for (const item of [
          ...leadItems,
          ...correspondenceItems,
          ...dueItems,
        ]) {
          if (item.source === "lead") {
            findings.push(
              toFinding({
                ref: `finding:lead:${item.job_ref.id}`,
                component: "stalled_pipeline",
                reason: item.reason,
                priority:
                  item.reason === "operator_action_required"
                    ? "critical"
                    : "attention",
                title: item.title ?? "Lead follow-up",
                kind: "opportunity",
                id: item.job_ref.id,
                attentionAt: item.attention_at,
              })
            );
          } else if (item.source === "correspondence") {
            findings.push(
              toFinding({
                ref: `finding:correspondence:${item.thread_ref.id}`,
                component: "unresolved_correspondence",
                reason: "unresolved_correspondence",
                priority: "attention",
                title: item.subject ?? "Unresolved correspondence",
                kind: "correspondence",
                id: item.thread_ref.id,
                attentionAt: item.attention_at,
              })
            );
          } else if (item.source === "commitment") {
            findings.push(
              toFinding({
                ref: `finding:commitment:${item.thread_ref.id}`,
                component: "unresolved_correspondence",
                reason: "unresolved_commitment",
                priority: "attention",
                title: "Unresolved commitment",
                kind: "correspondence",
                id: item.thread_ref.id,
                attentionAt: item.attention_at,
              })
            );
          } else {
            const task = item;
            findings.push(
              toFinding({
                ref: `finding:${task.source}:${task.task_ref.id}`,
                component: "work_due",
                reason:
                  task.reason === "overdue"
                    ? "work_overdue"
                    : task.reason === "unassigned"
                      ? "crew_unassigned"
                      : "confirmation_required",
                priority: task.reason === "overdue" ? "critical" : "attention",
                title: task.title ?? "Scheduled work needs attention",
                kind: "task",
                id: task.task_ref.id,
                attentionAt: task.attention_at,
              })
            );
          }
        }
        const queueCoverage = coverage(work);
        components.push({
          component: "stalled_pipeline",
          state: leadItems.length > 0 ? "attention" : "clear",
          time_window: { start_at: null, end_at_exclusive: preparedAtIso },
          population_count: leadItems.length,
          attention_count: leadItems.length,
          coverage: queueCoverage,
          source_revisions: work.sourceRevisions,
          evidence_refs: work.evidenceRefs,
        });
        if (correspondenceCoverage?.coverage_state === "complete") {
          components.push({
            component: "unresolved_correspondence",
            state: correspondenceItems.length > 0 ? "attention" : "clear",
            time_window: {
              start_at: new Date(
                preparedAt.getTime() - 7 * 86_400_000
              ).toISOString(),
              end_at_exclusive: preparedAtIso,
            },
            population_count: correspondenceCoverage.total_count,
            attention_count: correspondenceItems.length,
            coverage: queueCoverage,
            source_revisions: canonicalRevisions([
              ...work.sourceRevisions,
              {
                domain: "correspondence.normalization",
                source_revision: 2,
              },
            ]),
            evidence_refs: work.evidenceRefs,
          });
          communicationBriefs = correspondenceItems
            .slice(0, 25)
            .map((item) => ({
              brief_ref: `brief:${item.source}:${item.thread_ref.id}`,
              purpose: "pipeline_follow_up" as const,
              subject_ref: {
                kind: "correspondence" as const,
                id: item.thread_ref.id,
              },
              factual_points: [
                item.source === "correspondence"
                  ? item.subject?.trim() ||
                    item.snippet.trim() ||
                    "Follow up on the unresolved correspondence."
                  : "A recorded commitment is still unresolved.",
              ],
              source_evidence_refs: work.evidenceRefs.slice(0, 20),
              content_kind: "untrusted_business_data" as const,
            }))
            .filter((brief) => brief.source_evidence_refs.length > 0);
        } else {
          findings.splice(
            0,
            findings.length,
            ...findings.filter(
              (finding) => finding.component !== "unresolved_correspondence"
            )
          );
          components.push({
            component: "unresolved_correspondence",
            state: "not_evaluated",
            time_window: {
              start_at: new Date(
                preparedAt.getTime() - 7 * 86_400_000
              ).toISOString(),
              end_at_exclusive: preparedAtIso,
            },
            population_count: correspondenceCoverage?.total_count ?? 0,
            attention_count: null,
            coverage: {
              state: "unavailable",
              inspected_count: correspondenceCoverage?.readable_count ?? 0,
              omitted_count: correspondenceCoverage?.unreadable_count ?? 0,
              missing_reasons: [
                correspondenceCoverage
                  ? "unreadable_correspondence"
                  : "source_unavailable",
              ],
              fresh_at: correspondenceCoverage?.fresh_at ?? preparedAtIso,
            },
            source_revisions: canonicalRevisions([
              ...work.sourceRevisions,
              {
                domain: "correspondence.normalization",
                source_revision: 2,
              },
            ]),
            evidence_refs: work.evidenceRefs,
          });
        }
        components.push({
          component: "work_due",
          state: dueItems.length > 0 ? "attention" : "clear",
          time_window: { start_at: null, end_at_exclusive: preparedAtIso },
          population_count: dueItems.length,
          attention_count: dueItems.length,
          coverage: queueCoverage,
          source_revisions: work.sourceRevisions,
          evidence_refs: work.evidenceRefs,
        });
      } else {
        for (const component of [
          "stalled_pipeline",
          "unresolved_correspondence",
          "work_due",
        ] as const) {
          components.push(
            unavailableComponent(component, preparedAtIso, preparedAtIso)
          );
        }
        correspondenceCoverage = null;
      }

      const componentByName = new Map(
        components.map((component) => [component.component, component])
      );
      const orderedComponents = DAY_CLOSEOUT_COMPONENTS.map(
        (component) => componentByName.get(component)!
      );
      const uniqueFindings = [
        ...new Map(
          findings.map((finding) => [finding.finding_ref, finding] as const)
        ).values(),
      ]
        .sort((left, right) =>
          left.finding_ref.localeCompare(right.finding_ref)
        )
        .slice(0, DAY_CLOSEOUT_MAX_FINDINGS);
      const state = orderedComponents.some(
        (component) => component.coverage.state !== "complete"
      )
        ? "partial"
        : orderedComponents.some((component) => component.state === "attention")
          ? "attention"
          : "clear";
      const resultBase = {
        contract_version: CONTRACT_VERSION,
        schema_revision: DAY_CLOSEOUT_SCHEMA_REVISION,
        metric_definition_revision: DAY_CLOSEOUT_METRIC_DEFINITION_REVISION,
        business_date: businessDate,
        timezone,
        prepared_at: preparedAtIso,
        state,
        components: orderedComponents,
        findings: uniqueFindings,
        outstanding_balances: [...balances.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([currency, value]) => ({ currency, ...value })),
        communication_briefs: communicationBriefs,
        prompt_safety: DAY_CLOSEOUT_PROMPT_SAFETY_DIRECTIVE,
      } as const;
      const inputHash = createHash("sha256")
        .update(
          JSON.stringify({
            business_date: businessDate,
            display_timezone: timezone,
            idempotency_key: parsedInput.idempotency_key,
          })
        )
        .digest("hex");
      const persistenceInput = {
        actorContext,
        businessDate,
        timezone,
        idempotencyKey: parsedInput.idempotency_key,
        inputHash,
        resultBase,
        signal: options?.signal,
      } as const;
      const persisted = options?.routine
        ? await input.repository.persistRoutine({
            ...persistenceInput,
            routineId: options.routine.routineId,
            claimToken: options.routine.claimToken,
            scheduledFor: options.routine.scheduledFor,
            scheduleRevision: options.routine.scheduleRevision,
          })
        : await input.repository.persist(persistenceInput);
      return persisted.result;
    },
  };
  TRUSTED_SERVICES.add(service);
  return Object.freeze(service);
}

export function isTrustedDayCloseoutService(
  value: unknown
): value is DayCloseoutService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
