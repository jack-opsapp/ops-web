import "server-only";

import { createHash } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";

import type { ActorAuthorityRepository } from "@/lib/agent-control-plane/actor/authority-repository";
import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { authorizationInternal } from "@/lib/agent-control-plane/actor/errors";
import {
  isActorContext,
  type ActorContext,
} from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  COLLECTIONS_AGING_BUCKETS,
  COLLECTIONS_METRIC_DEFINITION_REVISION,
  COLLECTIONS_PROMPT_SAFETY_DIRECTIVE,
  COLLECTIONS_SCHEMA_REVISION,
  COLLECTIONS_TRUTH_BOUNDARY,
  CollectionsResultSchema,
  PrepareCollectionsInputSchema,
  collectionsAgingBucket,
  type CollectionsDebtor,
  type CollectionsDraftPreview,
  type CollectionsResult,
  type PrepareCollectionsInput,
} from "@/lib/agent-control-plane/contracts/collections";
import { CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import {
  COLLECTIONS_CAPABILITY_MANIFEST_REVISION,
  resolveCollectionsCapabilityAuthorization,
} from "@/lib/agent-control-plane/registry/capability-manifest";
import { reauthorizeResolvedMcpActor } from "@/lib/agent-control-plane/mcp/actor-reauthorization";
import type { OpsAgentReadCatalogueService } from "@/lib/agent-control-plane/services/read-catalogue-service";
import {
  isTrustedCollectionsRepository,
  type CollectionsCorrespondenceCoverage,
  type CollectionsCorrespondenceRequest,
  type CollectionsRepository,
} from "./collections-repository";

const PREPARE_COLLECTIONS_CAPABILITY = "prepare_collections" as const;
const MAX_SOURCE_PAGES = 4;
const MAX_SOURCE_ITEMS = 100;
const MAX_CUSTOMER_CONCURRENCY = 4;
const COLLECTIBLE_STATUSES = new Set([
  "awaiting_payment",
  "partially_paid",
  "past_due",
  "sent",
]);
const TRUSTED_SERVICES = new WeakSet<object>();

type SalesListResult = Awaited<
  ReturnType<OpsAgentReadCatalogueService["listSalesDocuments"]>
>;
type SalesInvoice = Extract<
  SalesListResult["items"][number],
  { document_ref: { kind: "invoice" } }
>;
type CustomerContext = Awaited<
  ReturnType<OpsAgentReadCatalogueService["getCustomerContext"]>
>;
type ReadyRecipient = Extract<
  CollectionsDebtor["recipient"],
  { state: "ready" }
>;
type BlockReason = Extract<
  CollectionsDebtor["recipient"],
  { state: "blocked" }
>["reason"];

interface InvoiceWithEvidence {
  readonly invoice: SalesInvoice;
  readonly evidenceRef: string;
}

interface DebtorSeed {
  readonly customerId: string;
  readonly displayName: string;
  readonly invoices: CollectionsDebtor["invoices"];
  readonly balances: CollectionsDebtor["balances"];
  readonly oldestDueDate: string;
  readonly maxDaysPastDue: number;
  readonly escalationTier: CollectionsDebtor["escalation_tier"];
  readonly recipient: CollectionsDebtor["recipient"];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function daysPastDue(asOfDate: string, dueDate: string): number {
  return Math.max(
    0,
    Math.round(
      (Date.parse(`${asOfDate}T00:00:00.000Z`) -
        Date.parse(`${dueDate}T00:00:00.000Z`)) /
        86_400_000
    )
  );
}

function invoiceOrder(
  left: CollectionsDebtor["invoices"][number],
  right: CollectionsDebtor["invoices"][number]
) {
  return `${left.due_date}:${left.document_number}:${left.invoice_ref.id}`.localeCompare(
    `${right.due_date}:${right.document_number}:${right.invoice_ref.id}`
  );
}

function aggregateBalances(
  invoices: readonly CollectionsDebtor["invoices"][number][]
): CollectionsDebtor["balances"] {
  const byCurrency = new Map<
    string,
    {
      amountMinor: number;
      invoiceCount: number;
      buckets: Record<string, { amountMinor: number; invoiceCount: number }>;
    }
  >();
  for (const invoice of invoices) {
    const current = byCurrency.get(invoice.balance_due.currency) ?? {
      amountMinor: 0,
      invoiceCount: 0,
      buckets: Object.fromEntries(
        COLLECTIONS_AGING_BUCKETS.map((bucket) => [
          bucket,
          { amountMinor: 0, invoiceCount: 0 },
        ])
      ),
    };
    current.amountMinor += invoice.balance_due.amount_minor;
    current.invoiceCount += 1;
    current.buckets[invoice.aging_bucket]!.amountMinor +=
      invoice.balance_due.amount_minor;
    current.buckets[invoice.aging_bucket]!.invoiceCount += 1;
    byCurrency.set(invoice.balance_due.currency, current);
  }
  return [...byCurrency.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, value]) => ({
      currency: currency as CollectionsDebtor["balances"][number]["currency"],
      amount_minor: value.amountMinor,
      invoice_count: value.invoiceCount,
      buckets: {
        current: {
          amount_minor: value.buckets.current!.amountMinor,
          invoice_count: value.buckets.current!.invoiceCount,
        },
        "1_30": {
          amount_minor: value.buckets["1_30"]!.amountMinor,
          invoice_count: value.buckets["1_30"]!.invoiceCount,
        },
        "31_60": {
          amount_minor: value.buckets["31_60"]!.amountMinor,
          invoice_count: value.buckets["31_60"]!.invoiceCount,
        },
        "61_90": {
          amount_minor: value.buckets["61_90"]!.amountMinor,
          invoice_count: value.buckets["61_90"]!.invoiceCount,
        },
        "91_plus": {
          amount_minor: value.buckets["91_plus"]!.amountMinor,
          invoice_count: value.buckets["91_plus"]!.invoiceCount,
        },
      },
    }));
}

function selectRecipient(
  context: CustomerContext
): CollectionsDebtor["recipient"] {
  if (context.sections.duplicate_state?.state === "review_required") {
    return { state: "blocked", reason: "customer_duplicate_review" };
  }
  const contacts = context.sections.contacts;
  if (
    !contacts ||
    contacts.source_has_more ||
    contacts.result_budget_omitted_count > 0
  ) {
    return { state: "blocked", reason: "contact_source_bound" };
  }
  const primary = contacts.contacts.find(
    (contact) => contact.relationship === "primary_client"
  );
  if (primary?.email.state === "contactable") {
    return {
      state: "ready",
      contact_ref: primary.contact_ref,
      display_name: primary.display_name,
      address: primary.email.address,
    };
  }
  if (primary?.email.state === "blocked") {
    return { state: "blocked", reason: "recipient_blocked" };
  }
  if (primary?.email.state === "ambiguous") {
    return { state: "blocked", reason: "recipient_ambiguous" };
  }
  const subClients = contacts.contacts.filter(
    (contact) =>
      contact.relationship === "sub_client" &&
      contact.email.state === "contactable"
  );
  if (subClients.length === 0) {
    return { state: "blocked", reason: "recipient_unavailable" };
  }
  if (subClients.length > 1) {
    return { state: "blocked", reason: "recipient_ambiguous" };
  }
  const selected = subClients[0]!;
  if (selected.email.state !== "contactable") {
    return { state: "blocked", reason: "recipient_unavailable" };
  }
  return {
    state: "ready",
    contact_ref: selected.contact_ref,
    display_name: selected.display_name,
    address: selected.email.address,
  };
}

function formatMoney(amountMinor: number, currency: string): string {
  return `${new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(amountMinor / 100)} ${currency}`;
}

function invoiceLabel(invoices: readonly CollectionsDebtor["invoices"][number][]) {
  const visible = invoices.slice(0, 5).map((invoice) => invoice.document_number);
  const omitted = invoices.length - visible.length;
  return omitted > 0 ? `${visible.join(", ")} + ${omitted} more` : visible.join(", ");
}

function draftCopy(seed: DebtorSeed): Pick<CollectionsDraftPreview, "subject" | "body"> {
  const numbers = invoiceLabel(seed.invoices);
  const balanceText = seed.balances
    .map((balance) => formatMoney(balance.amount_minor, balance.currency))
    .join(" and ");
  const noun = seed.invoices.length === 1 ? "invoice" : "invoices";
  const subject =
    seed.invoices.length === 1
      ? `Outstanding invoice ${numbers}`
      : `Outstanding invoices — ${seed.displayName}`;
  const factual = `${noun[0]!.toUpperCase()}${noun.slice(1)} ${numbers}`;
  let request: string;
  if (seed.escalationTier === "current") {
    request = `${factual} has ${balanceText} outstanding. This is a quick payment reminder before the due date. Please confirm payment timing, or let us know if you need an invoice sent again.`;
  } else if (seed.escalationTier === "1_30") {
    request = `${factual} is ${seed.maxDaysPastDue} days overdue, with ${balanceText} outstanding. Please let us know when payment is on the way, or if you need an invoice sent again.`;
  } else if (seed.escalationTier === "31_60") {
    request = `${factual} is ${seed.maxDaysPastDue} days overdue, with ${balanceText} outstanding. Please reply with the payment date. If there is an issue or you need an invoice sent again, let us know so it can be sorted out.`;
  } else {
    request = `${factual} is ${seed.maxDaysPastDue} days overdue, with ${balanceText} outstanding. Please send payment or confirm a firm payment date. If something is holding this up or you need an invoice sent again, reply so it can be resolved.`;
  }
  return {
    subject,
    body: `Hi ${seed.displayName},\n\n${request}\n\nThanks,`,
  };
}

async function mapWithConcurrency<TValue, TResult>(
  values: readonly TValue[],
  mapper: (value: TValue) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(MAX_CUSTOMER_CONCURRENCY, values.length) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= values.length) return;
        results[index] = await mapper(values[index]!);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function readAllInvoices(
  service: OpsAgentReadCatalogueService,
  actor: ActorContext,
  signal?: AbortSignal
): Promise<InvoiceWithEvidence[]> {
  const collected: InvoiceWithEvidence[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_SOURCE_PAGES; page += 1) {
    const result = await service.listSalesDocuments(
      actor,
      {
        document_kinds: ["invoice"],
        limit: 25,
        ...(cursor ? { cursor } : {}),
      },
      signal ? { signal } : undefined
    );
    result.items.forEach((document, index) => {
      if (document.document_ref.kind !== "invoice") return;
      const evidence = result.evidence[index];
      if (!evidence) throw new TypeError("COLLECTIONS_INVOICE_EVIDENCE_MISSING");
      collected.push({ invoice: document, evidenceRef: evidence.evidence_ref });
    });
    cursor = result.next_cursor ?? undefined;
    if (!cursor) return collected;
  }
  if (cursor || collected.length > MAX_SOURCE_ITEMS) {
    throw new RangeError("COLLECTIONS_INVOICE_SOURCE_BOUND");
  }
  return collected;
}

async function reauthorize(input: {
  actorContext: ActorContext;
  authorityRepository: ActorAuthorityRepository;
  manifestRevision: string;
  signal?: AbortSignal;
}) {
  return await reauthorizeResolvedMcpActor({
    actorContext: input.actorContext,
    authorityRepository: input.authorityRepository,
    capabilityManifestRevision: input.manifestRevision,
    signal: input.signal,
  });
}

export interface CollectionsService {
  prepareCollections(
    actorContext: ActorContext,
    input: PrepareCollectionsInput,
    options?: { signal?: AbortSignal }
  ): Promise<CollectionsResult>;
}

export function createCollectionsService(input: {
  readService: OpsAgentReadCatalogueService;
  repository: CollectionsRepository;
  authorityRepository: ActorAuthorityRepository;
  now?: () => Date;
}): CollectionsService {
  if (!isTrustedCollectionsRepository(input.repository)) {
    throw new TypeError("A trusted collections repository is required");
  }
  if (!input.readService || !input.authorityRepository) {
    throw new TypeError("Collections dependencies are required");
  }
  const now = input.now ?? (() => new Date());
  const service: CollectionsService = {
    async prepareCollections(actorContext, rawInput, options) {
      if (!isActorContext(actorContext)) {
        throw authorizationInternal(
          "unknown-request",
          "collections_actor_context_untrusted"
        );
      }
      const parsedInput = PrepareCollectionsInputSchema.parse(rawInput);
      const initialAuthorization = resolveCollectionsCapabilityAuthorization(
        PREPARE_COLLECTIONS_CAPABILITY,
        parsedInput
      );
      authorizeCapability({
        actorContext,
        policy: initialAuthorization.variants[0]!.policy,
      });
      const collectionsActor = await reauthorize({
        actorContext,
        authorityRepository: input.authorityRepository,
        manifestRevision: COLLECTIONS_CAPABILITY_MANIFEST_REVISION,
        signal: options?.signal,
      });
      const currentAuthorization = resolveCollectionsCapabilityAuthorization(
        PREPARE_COLLECTIONS_CAPABILITY,
        parsedInput
      );
      authorizeCapability({
        actorContext: collectionsActor,
        policy: currentAuthorization.variants[0]!.policy,
      });
      const productionActor = await reauthorize({
        actorContext: collectionsActor,
        authorityRepository: input.authorityRepository,
        manifestRevision: CAPABILITY_MANIFEST_REVISION,
        signal: options?.signal,
      });

      const preparedAt = now();
      const preparedAtIso = preparedAt.toISOString();
      const timezone = await input.repository.resolveTimezone(
        collectionsActor,
        options?.signal
      );
      const asOfDate =
        parsedInput.as_of_date ??
        formatInTimeZone(preparedAt, timezone, "yyyy-MM-dd");
      const rawInvoices = await readAllInvoices(
        input.readService,
        productionActor,
        options?.signal
      );
      const collectible = rawInvoices.filter(
        ({ invoice }) =>
          COLLECTIBLE_STATUSES.has(invoice.status) &&
          invoice.balance_due.amount_minor > 0
      );
      const byCustomer = new Map<string, InvoiceWithEvidence[]>();
      for (const item of collectible) {
        const customerId = item.invoice.customer_ref.id;
        byCustomer.set(customerId, [
          ...(byCustomer.get(customerId) ?? []),
          item,
        ]);
      }
      if (byCustomer.size > 25) {
        throw new RangeError("COLLECTIONS_DEBTOR_SOURCE_BOUND");
      }

      const customerEntries = [...byCustomer.entries()].sort(([left], [right]) =>
        left.localeCompare(right)
      );
      const seeds = await mapWithConcurrency(
        customerEntries,
        async ([customerId, items]): Promise<DebtorSeed> => {
          const context = await input.readService.getCustomerContext(
            productionActor,
            {
              customer_ref: { kind: "client", id: customerId },
              sections: ["profile", "contacts", "duplicate_state"],
              contact_purpose: "communication",
            },
            options
          );
          const displayName = context.sections.profile?.display_name;
          if (!displayName) {
            throw new TypeError("COLLECTIONS_CUSTOMER_PROFILE_UNAVAILABLE");
          }
          const invoices = items
            .map(({ invoice, evidenceRef }) => {
              const exactDaysPastDue = daysPastDue(asOfDate, invoice.due_date);
              return {
                invoice_ref: invoice.document_ref,
                document_number: invoice.document_number,
                status: invoice.status as CollectionsDebtor["invoices"][number]["status"],
                issue_date: invoice.issue_date,
                due_date: invoice.due_date,
                days_past_due: exactDaysPastDue,
                aging_bucket: collectionsAgingBucket(exactDaysPastDue),
                balance_due: invoice.balance_due,
                evidence_ref: evidenceRef,
                content_kind: "untrusted_business_data" as const,
              };
            })
            .sort(invoiceOrder);
          const maxDaysPastDue = Math.max(
            ...invoices.map((invoice) => invoice.days_past_due)
          );
          return {
            customerId,
            displayName,
            invoices,
            balances: aggregateBalances(invoices),
            oldestDueDate: invoices[0]!.due_date,
            maxDaysPastDue,
            escalationTier: collectionsAgingBucket(maxDaysPastDue),
            recipient: selectRecipient(context),
          };
        }
      );

      const correspondenceRequests = seeds.flatMap(
        (seed): CollectionsCorrespondenceRequest[] =>
          seed.recipient.state === "ready"
            ? [
                {
                  customer_id: seed.customerId,
                  contact_kind: seed.recipient.contact_ref.kind,
                  contact_id: seed.recipient.contact_ref.id,
                  recipient_address: seed.recipient.address,
                  start_at: `${seed.invoices.reduce(
                    (earliest, invoice) =>
                      invoice.issue_date < earliest
                        ? invoice.issue_date
                        : earliest,
                    seed.invoices[0]!.issue_date
                  )}T00:00:00.000Z`,
                },
              ]
            : []
      );
      const correspondenceRows = await input.repository.inspectCorrespondence({
        actorContext: collectionsActor,
        recipients: correspondenceRequests.sort((left, right) =>
          left.customer_id.localeCompare(right.customer_id)
        ),
        endAt: preparedAtIso,
        signal: options?.signal,
      });
      const correspondenceByCustomer = new Map(
        correspondenceRows.map((row) => [row.customer_id, row] as const)
      );

      const debtors = seeds
        .map((seed) => {
          const correspondence: Omit<
            CollectionsCorrespondenceCoverage,
            "customer_id"
          > =
            seed.recipient.state === "blocked"
              ? {
                  coverage_state: "not_evaluated",
                  total_count: 0,
                  readable_count: 0,
                  unreadable_count: 0,
                  latest_direction: null,
                  latest_delivered_at: null,
                  fresh_at: preparedAtIso,
                  normalization_revision:
                    "ops.correspondence.normalized-text.v2",
                  gate_reason: seed.recipient.reason,
                }
              : (() => {
                  const row = correspondenceByCustomer.get(seed.customerId);
                  if (row) {
                    const { customer_id: _customerId, ...coverage } = row;
                    return coverage;
                  }
                  return {
                    coverage_state: "unavailable" as const,
                    total_count: 0,
                    readable_count: 0,
                    unreadable_count: 0,
                    latest_direction: null,
                    latest_delivered_at: null,
                    fresh_at: preparedAtIso,
                    normalization_revision:
                      "ops.correspondence.normalized-text.v2" as const,
                    gate_reason: "correspondence_unavailable" as const,
                  };
                })();
          const approvalReady =
            seed.recipient.state === "ready" &&
            correspondence.coverage_state === "complete";
          let draft:
            | { kind: "prepared"; preview: CollectionsDraftPreview }
            | { kind: "blocked"; reason: BlockReason };
          if (approvalReady) {
            const recipient = seed.recipient as ReadyRecipient;
            const copy = draftCopy(seed);
            draft = {
              kind: "prepared",
              preview: {
                schema_revision: COLLECTIONS_SCHEMA_REVISION,
                metric_definition_revision:
                  COLLECTIONS_METRIC_DEFINITION_REVISION,
                as_of_date: asOfDate,
                customer_ref: { kind: "client", id: seed.customerId },
                customer_display_name: seed.displayName,
                recipient,
                invoices: seed.invoices,
                balances: seed.balances,
                oldest_due_date: seed.oldestDueDate,
                max_days_past_due: seed.maxDaysPastDue,
                escalation_tier: seed.escalationTier,
                ...copy,
                truth_boundary: COLLECTIONS_TRUTH_BOUNDARY,
              },
            };
          } else {
            draft = {
              kind: "blocked",
              reason:
                seed.recipient.state === "blocked"
                  ? seed.recipient.reason
                  : (correspondence.gate_reason ??
                    "correspondence_unavailable"),
            };
          }
          return {
            customer_ref: { kind: "client" as const, id: seed.customerId },
            display_name: seed.displayName,
            invoices: seed.invoices,
            balances: seed.balances,
            oldest_due_date: seed.oldestDueDate,
            max_days_past_due: seed.maxDaysPastDue,
            escalation_tier: seed.escalationTier,
            recipient: seed.recipient,
            correspondence,
            draft,
            content_kind: "untrusted_business_data" as const,
          };
        })
        .sort(
          (left, right) =>
            right.max_days_past_due - left.max_days_past_due ||
            left.customer_ref.id.localeCompare(right.customer_ref.id)
        );
      const approvalCount = debtors.filter(
        (debtor) => debtor.draft.kind === "prepared"
      ).length;
      const portfolioBalances = aggregateBalances(
        debtors.flatMap((debtor) => debtor.invoices)
      );
      const resultBase = {
        schema_revision: COLLECTIONS_SCHEMA_REVISION,
        metric_definition_revision: COLLECTIONS_METRIC_DEFINITION_REVISION,
        as_of_date: asOfDate,
        timezone,
        prepared_at: preparedAtIso,
        state: debtors.some((debtor) => debtor.max_days_past_due > 0)
          ? "attention"
          : "clear",
        debtors,
        portfolio_balances: portfolioBalances,
        receipt: {
          kind: "prepared",
          debtor_count: debtors.length,
          invoice_count: debtors.reduce(
            (count, debtor) => count + debtor.invoices.length,
            0
          ),
          approvals_created: approvalCount,
          drafts_blocked: debtors.length - approvalCount,
          messages_sent: 0,
          money_moved: false,
          financial_documents_issued: 0,
        },
        evidence_refs: [
          ...new Set(
            debtors.flatMap((debtor) =>
              debtor.invoices.map((invoice) => invoice.evidence_ref)
            )
          ),
        ],
        prompt_safety: COLLECTIONS_PROMPT_SAFETY_DIRECTIVE,
      } as const;
      const inputHash = createHash("sha256")
        .update(canonicalJson(parsedInput), "utf8")
        .digest("hex");
      const stored = await input.repository.persist({
        actorContext: collectionsActor,
        asOfDate,
        timezone,
        idempotencyKey: parsedInput.idempotency_key,
        inputHash,
        resultBase,
        signal: options?.signal,
      });
      return CollectionsResultSchema.parse(stored);
    },
  };
  TRUSTED_SERVICES.add(service);
  return Object.freeze(service);
}

export function isTrustedCollectionsService(
  value: unknown
): value is CollectionsService {
  return (
    typeof value === "object" && value !== null && TRUSTED_SERVICES.has(value)
  );
}
