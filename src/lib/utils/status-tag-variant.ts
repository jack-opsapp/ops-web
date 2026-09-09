/**
 * OPS Web — status/stage → `Tag` variant. The single mapping onto the `Tag`
 * primitive.
 *
 * DESIGN.md § Tags: earth tones ONLY when the colour carries meaning. Neutral
 * is a live state with no charge, olive is work that moved or landed, tan is
 * something asking for the operator's attention, rose is a loss, dim is
 * retired/inert. Every state that does not need a colour stays neutral — a
 * palette where half the rows glow tells the operator nothing.
 *
 * Keys are the RAW database column values (`projects.status`,
 * `opportunities.stage`, `project_tasks.status`, `invoices.status`,
 * `estimates.status`), verified against production 2026-09-08. `search_workspace`
 * emits those raw values, and the Books register enums (`InvoiceStatus`,
 * `EstimateStatus`) are string enums over the same strings — so one table
 * serves both. `ProjectStatus`/`TaskStatus` in `@/lib/types/models` carry
 * DISPLAY values ("In Progress"), which is why the project/lead/task tables are
 * keyed by string rather than by those enums.
 *
 * Consumers: the ⌘K palette result rows and the Books invoice/estimate
 * registers. A second copy of any of these tables against `Tag` is a bug.
 *
 * Not the only status colouring in the app: `components/ops/status-badge` maps
 * project and task statuses onto `ui/badge`'s `status-*` palette (Cake Mono,
 * 2.5px radius) for the projects table. That is the pre-spec-v2 mapping the P4
 * conformance sweep retires onto `Tag` — not a duplicate to reconcile here.
 */

import type { TagProps } from "@/components/ui/tag";
import type { EstimateStatus, InvoiceStatus } from "@/lib/types/pipeline";

export type StatusTagVariant = NonNullable<TagProps["variant"]>;

/** The kinds that carry a status the palette renders. Clients have none. */
export type StatusTagKind = "project" | "lead" | "task" | "document";

const PROJECT: Readonly<Record<string, StatusTagVariant>> = {
  rfq: "neutral",
  estimated: "neutral",
  // Agreed but not started — the crew has nothing to show yet, so no colour.
  accepted: "neutral",
  in_progress: "olive",
  completed: "olive",
  closed: "dim",
  archived: "dim",
};

const LEAD: Readonly<Record<string, StatusTagVariant>> = {
  new_lead: "neutral",
  qualifying: "neutral",
  quoting: "neutral",
  quoted: "neutral",
  // The one stage that is a standing instruction to the operator.
  follow_up: "tan",
  negotiation: "neutral",
  won: "olive",
  lost: "rose",
  // Removed, not lost — no money was on the table.
  discarded: "dim",
};

const TASK: Readonly<Record<string, StatusTagVariant>> = {
  // The default state of every live task. Colouring it would drown the list.
  active: "neutral",
  completed: "olive",
  cancelled: "dim",
};

/**
 * Invoice statuses. Typed against the enum so a new member fails the build
 * rather than silently rendering neutral; exported as a string-keyed table so
 * the palette can look up the raw column value from `search_workspace`.
 */
const INVOICE: Record<InvoiceStatus, StatusTagVariant> = {
  draft: "dim",
  sent: "neutral",
  awaiting_payment: "neutral",
  partially_paid: "tan",
  paid: "olive",
  past_due: "rose",
  void: "dim",
  written_off: "dim",
};

/**
 * Estimate statuses, lifted verbatim from the Books estimates register.
 * `changes_requested` and `superseded` are deliberately absent — they fall
 * through to the neutral default there, and declaring them here would restyle
 * that register as a side effect of a palette change.
 */
const ESTIMATE: Partial<Record<EstimateStatus, StatusTagVariant>> = {
  draft: "dim",
  sent: "neutral",
  viewed: "neutral",
  approved: "olive",
  converted: "olive",
  declined: "rose",
  expired: "tan",
};

/** The palette's `documents` group unifies invoices and estimates. */
const DOCUMENT: Readonly<Record<string, StatusTagVariant>> = {
  ...ESTIMATE,
  ...INVOICE,
};

const BY_KIND: Readonly<Record<StatusTagKind, Readonly<Record<string, StatusTagVariant>>>> = {
  project: PROJECT,
  lead: LEAD,
  task: TASK,
  document: DOCUMENT,
};

export const PROJECT_STATUS_TAG_VARIANT = PROJECT;
export const LEAD_STAGE_TAG_VARIANT = LEAD;
export const TASK_STATUS_TAG_VARIANT = TASK;
export const INVOICE_STATUS_TAG_VARIANT: Readonly<Record<string, StatusTagVariant>> = INVOICE;
export const ESTIMATE_STATUS_TAG_VARIANT: Readonly<
  Partial<Record<string, StatusTagVariant>>
> = ESTIMATE;

/**
 * The variant for a raw status/stage value. Unknown, blank and absent values
 * render neutral — a status the app has not met yet is still a fact worth
 * showing, just without a claim about what it means.
 */
export function statusTagVariant(
  kind: StatusTagKind,
  raw: string | null | undefined,
): StatusTagVariant {
  if (!raw) return "neutral";
  return BY_KIND[kind][raw.trim().toLowerCase()] ?? "neutral";
}
