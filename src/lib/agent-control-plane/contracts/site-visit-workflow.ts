import { z } from "zod-v4";

export const SITE_VISIT_WORKFLOW_MANIFEST =
  "2026-09-10.capability-manifest.v27" as const;
export const SITE_VISIT_WORKFLOW_EXPOSURE =
  "2026-09-10.mcp-exposure.v22" as const;
export const SITE_VISIT_WORKFLOW_CONSENT =
  "2026-09-10.mcp-consent-catalog.v17" as const;
export const SITE_VISIT_WORKFLOW_REVISION = "2026-09-10.v1" as const;
const nonblank = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => s.trim().length > 0);
export const SiteVisitFieldKindSchema = z.enum([
  "checkbox",
  "yes_no_na",
  "short_text",
  "long_text",
  "measurement",
  "photo",
  "photo_markup",
  "deck_design",
]);
export const ChecklistFieldSchema = z
  .object({
    id: nonblank(256),
    label: nonblank(500),
    kind: SiteVisitFieldKindSchema,
    required: z.boolean(),
    helpText: z.string().max(2000).nullable().optional(),
    sortOrder: z.number().int().min(0).max(100000),
    isVisible: z.boolean().optional(),
  })
  .strict();
export const ChecklistFieldsSchema = z
  .array(ChecklistFieldSchema)
  .min(1)
  .max(100)
  .refine(
    (fields) => new Set(fields.map((f) => f.id)).size === fields.length,
    "Field identities must be unique"
  )
  .refine(
    (fields) => fields.some((f) => f.isVisible !== false),
    "Show at least one field"
  )
  .refine(
    (fields) =>
      new TextEncoder().encode(JSON.stringify(fields)).length <= 131072,
    "Checklist is too large"
  );
export const ChecklistDefinitionSchema = z
  .object({
    name: nonblank(120),
    slug: nonblank(128),
    description_text: z.string().max(500).nullable().optional(),
    is_default: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(100000).optional(),
    fields: ChecklistFieldsSchema,
  })
  .strict();
export const SiteVisitValueSchema = z
  .object({
    text: z.string().max(200000).optional(),
    boolValue: z.boolean().optional(),
    choice: z.enum(["YES", "NO", "N/A"]).optional(),
    artifactIds: z.array(z.uuid()).max(100).optional(),
    deckDesignId: z.uuid().optional(),
  })
  .strict();
export const SiteVisitEvidenceSchema = z.union([
  z
    .object({
      source_index: z.number().int().min(0).max(19),
      quote: nonblank(8000),
    })
    .strict(),
  z
    .object({
      source_index: z.number().int().min(0).max(19),
      reference_only: z.literal(true),
    })
    .strict(),
]);
export const SiteVisitUncertaintySchema = z
  .object({
    reason: nonblank(2000),
    evidence: z.array(SiteVisitEvidenceSchema).min(1).max(10),
  })
  .strict();
export const SiteVisitAnswerPatchSchema = z
  .object({
    answer_id: z.uuid(),
    expected_revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    intent: z.enum(["set", "clear", "unknown"]),
    value: SiteVisitValueSchema.nullable(),
    evidence: z.array(SiteVisitEvidenceSchema).max(10),
    reason: nonblank(2000).optional(),
    uncertainty: z.array(SiteVisitUncertaintySchema).max(5).optional(),
  })
  .strict()
  .refine(
    (p) =>
      p.intent === "set"
        ? p.value !== null && p.evidence.length > 0
        : p.value === null && !!p.reason,
    "Set needs evidence; clear and unknown need an explicit reason and no value"
  )
  .refine(
    (p) => !p.uncertainty?.length || p.intent === "unknown",
    "Unresolved evidence must remain unknown"
  );
export const SiteVisitSourceReferenceSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("operator_notes"), text: nonblank(32000) })
    .strict(),
  z
    .object({
      kind: z.literal("visit_artifact"),
      artifact_id: z.uuid(),
      expected_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    })
    .strict(),
]);
export const SiteVisitAnswerSnapshotSchema = z
  .object({
    id: z.uuid(),
    field_id: nonblank(256),
    label: nonblank(500),
    kind: SiteVisitFieldKindSchema,
    required: z.boolean(),
    sort_order: z.number().int(),
    answer_value: z.record(z.string(), z.unknown()),
    revision: z.number().int().min(0),
  })
  .passthrough();
export type ChecklistField = z.infer<typeof ChecklistFieldSchema>;
export type SiteVisitAnswerSnapshot = z.infer<
  typeof SiteVisitAnswerSnapshotSchema
>;
export type SiteVisitAnswerPatch = z.infer<typeof SiteVisitAnswerPatchSchema>;
export type SiteVisitValue = z.infer<typeof SiteVisitValueSchema>;

const requestIdentity = {
  idempotency_key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/),
  supersedes: z.uuid().optional(),
};
const appointment = {
  local_start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
  utc_offset_minutes: z.number().int().min(-840).max(840).optional(),
  duration_minutes: z.number().int().min(15).max(480),
  assignee_ids: z
    .array(z.uuid())
    .min(1)
    .max(25)
    .refine((ids) => new Set(ids).size === ids.length),
  reminder_lead_minutes: z.number().int().min(-1).max(1440).nullable(),
};
export const SiteVisitWorkflowRequestSchema = z
  .discriminatedUnion("operation", [
    z
      .object({
        operation: z.literal("book"),
        opportunity_id: z.uuid(),
        ...appointment,
        reminder_lead_minutes: z.number().int().min(0).max(1440).nullable(),
        ...requestIdentity,
      })
      .strict(),
    z
      .object({
        operation: z.literal("reschedule"),
        site_visit_id: z.uuid(),
        expected_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        local_start: appointment.local_start.optional(),
        utc_offset_minutes: appointment.utc_offset_minutes,
        duration_minutes: appointment.duration_minutes.optional(),
        assignee_ids: appointment.assignee_ids.optional(),
        reminder_lead_minutes: appointment.reminder_lead_minutes.optional(),
        ...requestIdentity,
      })
      .strict(),
    z
      .object({
        operation: z.literal("cancel"),
        site_visit_id: z.uuid(),
        expected_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        ...requestIdentity,
      })
      .strict(),
    z
      .object({
        operation: z.literal("create_template"),
        definition: ChecklistDefinitionSchema,
        ...requestIdentity,
      })
      .strict(),
    z
      .object({
        operation: z.literal("edit_template"),
        template_id: nonblank(256),
        expected_revision: z.number().int().min(0),
        definition: ChecklistDefinitionSchema,
        ...requestIdentity,
      })
      .strict(),
    z
      .object({
        operation: z.literal("select_checklist"),
        site_visit_id: z.uuid(),
        template_id: nonblank(256),
        expected_template_revision: z.number().int().min(0),
        expected_form_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        ...requestIdentity,
      })
      .strict(),
    z
      .object({
        operation: z.literal("answer_form"),
        site_visit_id: z.uuid(),
        changes: z.array(SiteVisitAnswerPatchSchema).min(1).max(100),
        sources: z.array(SiteVisitSourceReferenceSchema).max(20),
        ...requestIdentity,
      })
      .strict(),
  ])
  .refine(
    (r) => new TextEncoder().encode(JSON.stringify(r)).length <= 131072,
    "Request is too large"
  );
export type SiteVisitWorkflowRequest = z.infer<
  typeof SiteVisitWorkflowRequestSchema
>;

const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const page = {
  limit: z.number().int().min(1).max(25).optional(),
  after_id: nonblank(256).optional(),
  expected_source_revision: z.number().int().nonnegative().optional(),
};
export const SiteVisitWorkflowReadRequestSchema = z
  .discriminatedUnion("operation", [
    z.object({ operation: z.literal("list_templates"), ...page }).strict(),
    z
      .object({
        operation: z.literal("get_template"),
        template_id: nonblank(256),
      })
      .strict(),
    z
      .object({
        operation: z.literal("get_form"),
        site_visit_id: z.uuid(),
        ...page,
      })
      .strict(),
    z
      .object({
        operation: z.literal("get_source"),
        site_visit_id: z.uuid(),
        artifact_id: z.uuid(),
      })
      .strict(),
  ])
  .refine(
    (r) =>
      !("after_id" in r) ||
      r.after_id === undefined ||
      r.expected_source_revision !== undefined,
    "A page requires its original source revision"
  );
export type SiteVisitWorkflowReadRequest = z.infer<
  typeof SiteVisitWorkflowReadRequestSchema
>;
export const SITE_VISIT_TOOL_OPERATIONS = {
  list_site_visit_templates: "list_templates",
  get_site_visit_template: "get_template",
  get_site_visit_form: "get_form",
  get_site_visit_source: "get_source",
  prepare_site_visit_booking: "book",
  prepare_site_visit_reschedule: "reschedule",
  prepare_site_visit_booking_cancellation: "cancel",
  prepare_site_visit_template: "create_template",
  prepare_site_visit_template_edit: "edit_template",
  prepare_site_visit_checklist_selection: "select_checklist",
  prepare_site_visit_answers: "answer_form",
} as const;
export type SiteVisitWorkflowTool = keyof typeof SITE_VISIT_TOOL_OPERATIONS;
export function siteVisitToolInputSchema(name: SiteVisitWorkflowTool) {
  const operation = SITE_VISIT_TOOL_OPERATIONS[name];
  const schema = [
    ...SiteVisitWorkflowReadRequestSchema.options,
    ...SiteVisitWorkflowRequestSchema.options,
  ].find((s) => s.shape.operation.value === operation);
  if (!schema) throw new TypeError("Unknown site visit operation");
  const shape = Object.fromEntries(
    Object.entries(schema.shape).filter(([key]) => key !== "operation")
  );
  return z.object(shape).strict();
}
const jsonObject = z.record(z.string(), z.unknown());
const missingField = z
  .object({
    answer_id: z.uuid(),
    field_id: z.string(),
    label: z.string(),
    kind: SiteVisitFieldKindSchema,
  })
  .strict();
const timezoneProof = z
  .object({
    timezone: nonblank(100),
    probes: z
      .array(
        z
          .object({
            local: z.string(),
            instant: z.iso.datetime({ offset: true }),
            utc_offset_minutes: z.number().int().min(-840).max(840),
          })
          .strict()
      )
      .max(2),
  })
  .strict();
export const SiteVisitWorkflowProposalSchema = z
  .object({
    operation: z.enum([
      "book",
      "reschedule",
      "cancel",
      "create_template",
      "edit_template",
      "select_checklist",
      "answer_form",
    ]),
    title: nonblank(200),
    ready: z.boolean(),
    entity: z.enum(["appointment", "template", "answer"]),
    site_visit_id: z.uuid().nullable(),
    template_id: z.string().nullable().optional(),
    opportunity_id: z.uuid().nullable().optional(),
    lead_title: z.string().nullable().optional(),
    before: jsonObject.nullable().optional(),
    appointment: z
      .object({
        local_start: z.string(),
        timezone: nonblank(100),
        starts_at: z.iso.datetime({ offset: true }),
        ends_at: z.iso.datetime({ offset: true }),
        duration_minutes: z.number().int(),
        assignee_ids: z.array(z.string()).max(200).nullable(),
        crew: z
          .array(z.object({ id: z.uuid(), name: z.string() }).strict())
          .max(200),
        reminder_lead_minutes: z.number().int().nullable(),
      })
      .strict()
      .optional(),
    visit_context: z
      .object({
        id: z.uuid(),
        title: z.string().nullable(),
        address: z.string().nullable(),
        local_start: z.string(),
        timezone: nonblank(100),
        utc_offset_minutes: z.number().int().min(-840).max(840),
      })
      .strict()
      .nullable()
      .optional(),
    rows: z
      .array(
        z
          .object({
            id: z.string(),
            base_revision: z.number().int().nonnegative(),
            before: jsonObject.nullable(),
            values: jsonObject,
          })
          .strict()
      )
      .max(200),
    sources: z.array(jsonObject).max(20),
    missing_required: z.array(missingField).max(200),
    source_sha256: sha,
    timezone_proof: timezoneProof.nullable(),
    availability: z
      .object({
        conflicts: z
          .array(
            z
              .object({ kind: z.string(), id: z.uuid(), reason: z.string() })
              .strict()
          )
          .max(500),
        warnings: z.array(
          z.enum(["working_hours_unknown", "outside_company_working_hours"])
        ),
        external_calendar_coverage: z.literal("unknown"),
      })
      .strict()
      .optional(),
    effects: z
      .object({
        records: z.number().int().min(0).max(200),
        physical_visit_status_changed: z.literal(false),
        calendar_intent: z.enum(["not_requested", "queued"]),
        customer_messages_sent: z.literal(0),
        appointment_status: z.enum(["scheduled", "cancelled"]).optional(),
        lead_stage: z.string().nullable().optional(),
        timeline: z.string().optional(),
      })
      .strict(),
    content_kind: z.literal("untrusted_business_data"),
  })
  .strict()
  .refine((p) => {
    if (["book", "reschedule", "cancel"].includes(p.operation)) {
      if (p.entity !== "appointment" || !p.appointment || p.rows.length)
        return false;
      if (p.operation === "cancel")
        return p.effects.appointment_status === "cancelled";
      const a = p.appointment;
      return (
        a.assignee_ids !== null &&
        a.duration_minutes >= 15 &&
        a.duration_minutes <= 480 &&
        a.assignee_ids.length >= 1 &&
        a.assignee_ids.length <= 25 &&
        a.assignee_ids.every((id) => z.uuid().safeParse(id).success) &&
        (a.reminder_lead_minutes === null ||
          (a.reminder_lead_minutes >= 0 && a.reminder_lead_minutes <= 1440)) &&
        p.timezone_proof !== null
      );
    }
    return (
      p.appointment === undefined &&
      p.timezone_proof === null &&
      p.entity === (p.operation.includes("template") ? "template" : "answer") &&
      (p.entity !== "answer" || p.visit_context?.id === p.site_visit_id)
    );
  }, "Proposal operation and appointment are inconsistent");
export type SiteVisitWorkflowProposal = z.infer<
  typeof SiteVisitWorkflowProposalSchema
>;
export const SiteVisitWorkflowReceiptSchema = z
  .object({
    ok: z.literal(true),
    effect: z.literal("site_visit_changes_saved"),
    operation: SiteVisitWorkflowProposalSchema.shape.operation,
    actor_user_id: z.uuid(),
    company_id: z.uuid(),
    action_id: z.uuid(),
    change_set_id: z.uuid(),
    confirmation_receipt_id: z.uuid(),
    preview_sha256: sha,
    committed_at: z.iso.datetime({ offset: true }),
    replayed: z.boolean(),
    receipt_sha256: sha,
    records: z
      .array(
        z
          .object({
            entity: z.enum(["site_visit", "template", "answer"]),
            id: z.string(),
            before: jsonObject.nullable().optional(),
            after: jsonObject,
            sha256: sha,
          })
          .strict()
      )
      .max(200),
    effects: SiteVisitWorkflowProposalSchema.shape.effects,
    missing_required: z.array(missingField).max(200),
    site_visit_id: z.uuid().nullable(),
    appointment: SiteVisitWorkflowProposalSchema.shape.appointment
      .unwrap()
      .nullable(),
    timezone_proof: timezoneProof.nullable(),
    calendar_reconciled: z.literal(false),
    customer_messages_sent: z.literal(0),
  })
  .strict();
export const SiteVisitWorkflowResultSchema = z
  .object({
    request_id: nonblank(128),
    schema_revision: z.literal(SITE_VISIT_WORKFLOW_REVISION),
    status: z.enum([
      "needs_input",
      "unchanged",
      "approval_required",
      "committed",
    ]),
    proposal: SiteVisitWorkflowProposalSchema,
    action_id: z.uuid().nullable(),
    change_set_id: z.uuid().nullable(),
    preview_sha256: sha.nullable(),
    expires_at: z.iso.datetime({ offset: true }).nullable(),
    replayed: z.boolean(),
    receipt: SiteVisitWorkflowReceiptSchema.nullable(),
    content_kind: z.literal("untrusted_business_data"),
  })
  .strict()
  .refine(
    (r) =>
      r.status === "needs_input" || r.status === "unchanged"
        ? r.proposal.ready === (r.status === "unchanged") &&
          (r.status !== "unchanged" || r.proposal.effects.records === 0) &&
          r.action_id === null &&
          r.change_set_id === null &&
          r.preview_sha256 === null &&
          r.expires_at === null &&
          r.receipt === null
        : r.proposal.ready &&
          r.action_id !== null &&
          r.change_set_id !== null &&
          r.preview_sha256 !== null &&
          r.expires_at !== null &&
          (r.status === "committed") === (r.receipt !== null),
    "Proposal state is inconsistent"
  );
export type SiteVisitWorkflowResult = z.infer<
  typeof SiteVisitWorkflowResultSchema
>;
export const SiteVisitWorkflowReadResultSchema = z
  .object({
    request_id: nonblank(128),
    schema_revision: z.literal(SITE_VISIT_WORKFLOW_REVISION),
    source_revision: z.number().int().nonnegative(),
    content_kind: z.literal("untrusted_business_data"),
    items: z.array(jsonObject).max(25).optional(),
    has_more: z.boolean().optional(),
    next_after_id: z.string().nullable().optional(),
    template: jsonObject.optional(),
    source: jsonObject.optional(),
    site_visit: jsonObject.optional(),
    answers: z.array(jsonObject).max(200).optional(),
    missing_required: z.array(missingField).max(200).optional(),
    form_sha256: sha.optional(),
    sources: z.array(jsonObject).max(25).optional(),
    sources_has_more: z.boolean().optional(),
  })
  .strict();
export type SiteVisitWorkflowReadResult = z.infer<
  typeof SiteVisitWorkflowReadResultSchema
>;
