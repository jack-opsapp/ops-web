"use client";

/**
 * OPS Web — Lead-detail Overview tab.
 *
 * The full lead record, the first/default tab of the pipeline deal-detail
 * window (floating window + drawer share the same `PipelineDetailBody`). Where
 * the map-backed band up top carries the glance-able top-line facts, this tab is
 * the deep read: the intelligent Summary, scope, deal health, tags, the contact,
 * the location, and the linked estimate / project / site-visit records.
 *
 * ── Layout contract ───────────────────────────────────────────────────────────
 * The PARENT (`PipelineDetailBody`) already wraps tab content in a scrolling,
 * padded container (`overflow-y-auto p-3`). So this renders a plain vertical
 * {@link Stack} of {@link Section}s — no outer scroll, no outer padding. Every
 * section degrades to a quiet empty state (`—` or a `[ bracketed ]` line),
 * never a blank gap.
 *
 * ── Edit contract ─────────────────────────────────────────────────────────────
 * This component owns the single {@link useOpportunityFieldEdit} instance for the
 * tab and threads it (plus `canManage`) into the reused editors — `TextAreaField`
 * (scope), `TagsField` (tags), `AddressField` (location). One optimistic engine
 * per opportunity. All editing gates on `canManage` (`pipeline.manage`).
 *
 * ── Design tokens (traced to .interface-design/system.md) ────────────────────
 *  - Summary band → AGENT PROVENANCE palette (`--agent-bg` / `--agent-border` /
 *    `--agent-text` / `--agent-bg-hi`). Lavender is RESERVED for Claude-authored
 *    surfaces; the AI summary band is the one sanctioned use. Header is
 *    behavior-led (`// SUMMARY`), never a loud "AI" badge.
 *  - numbers → `font-mono`, `"tnum" 1, "zero" 1`, 11px floor, formatted; `—` empty.
 *  - earth-tone chips (estimate status) → semantic only, ALWAYS with text.
 *  - accent (`ops-accent`) → focus rings only.
 */

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  Phone,
  Plus,
  UserPlus,
} from "lucide-react";

import { toast } from "sonner";

import { useDictionary } from "@/i18n/client";
import { useOpportunityFieldEdit } from "@/lib/hooks/use-opportunity-field-edit";
import { useEstimates } from "@/lib/hooks/use-estimates";
import { useSiteVisits } from "@/lib/hooks/use-site-visits";
import {
  useClient,
  useClients,
  useCreateSubClient,
} from "@/lib/hooks/use-clients";
import { useAttachClientToOpportunity } from "@/lib/hooks/use-opportunities";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useWindowStore } from "@/stores/window-store";
import {
  EstimateStatus,
  SiteVisitStatus,
  formatCurrency,
  getDaysInStage,
  type Estimate,
  type Opportunity,
  type SiteVisit,
} from "@/lib/types/pipeline";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import type { Client } from "@/lib/types/models";

import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { Inline } from "@/components/ops/projects/workspace/atoms/inline";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Body } from "@/components/ops/projects/workspace/atoms/body";
import {
  Chip,
  type ChipVariant,
} from "@/components/ops/projects/workspace/atoms/chip";
import {
  AddressField,
  EditPopover,
  TagsField,
  TextAreaField,
} from "./lead-field-editors";
import { CreateSiteVisitModal } from "@/components/ops/site-visit/create-site-visit-modal";

const EMPTY = "—";

// Shared number recipe — JetBrains Mono, tabular-lining, slashed zero, 13px.
const NUM_CLASS =
  "font-mono text-[13px] tabular-nums text-text [font-feature-settings:'tnum'_1,'zero'_1]";

interface OverviewTabProps {
  opportunity: Opportunity;
  canManage: boolean;
}

export function PipelineDetailOverviewTab({
  opportunity,
  canManage,
}: OverviewTabProps) {
  const { t } = useDictionary("pipeline");
  // ONE optimistic edit engine for the whole tab; threaded into every editor.
  const edit = useOpportunityFieldEdit(opportunity.id);

  return (
    <Stack gap={3}>
      <SummarySection opportunity={opportunity} />

      <Section title={t("overview.scope", "Scope")}>
        <TextAreaField
          edit={edit}
          canManage={canManage}
          value={opportunity.description}
        />
      </Section>

      <HealthSection opportunity={opportunity} />

      <Section title={t("overview.tags", "Tags")}>
        <TagsField edit={edit} canManage={canManage} value={opportunity.tags} />
      </Section>

      <ContactSection opportunity={opportunity} canManage={canManage} />

      <LocationSection
        opportunity={opportunity}
        edit={edit}
        canManage={canManage}
      />

      <LinkedSection opportunity={opportunity} canManage={canManage} />
    </Stack>
  );
}

// ─── Summary (agent provenance) ───────────────────────────────────────────────

/**
 * The intelligent read. Rendered ONLY when `aiSummary` is present. This is the
 * sanctioned Claude-authored surface, so the whole band sits on the lavender
 * agent-provenance tokens — never the neutral surface — and the header is
 * behavior-led (`// SUMMARY`), not a loud "AI" badge.
 */
function SummarySection({ opportunity }: { opportunity: Opportunity }) {
  const { t } = useDictionary("pipeline");
  if (!opportunity.aiSummary) return null;

  const signals = opportunity.aiStageSignals ?? [];

  return (
    <div
      data-testid="overview-summary"
      className="rounded-panel border border-[var(--agent-border)] bg-[var(--agent-bg)] p-3"
    >
      <Stack gap={1.5}>
        <Inline gap={1}>
          <Mono color="mute" size={11}>
            {"//"}
          </Mono>
          {/* Provenance-tinted header — distinct from the neutral `Section`
              voice so the operator reads "this was written for me". */}
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--agent-text-2)]">
            {t("overview.summary", "Summary")}
          </span>
        </Inline>

        <p className="whitespace-pre-wrap font-mohave text-[14px] leading-[1.55] text-[var(--agent-text)]">
          {opportunity.aiSummary}
        </p>

        {signals.length > 0 ? (
          <Inline gap={1} wrap>
            {signals.map((signal) => (
              <span
                key={signal}
                className={cn(
                  "inline-flex shrink-0 items-center rounded-chip px-1.5 py-[2px]",
                  "border border-[var(--agent-border-hi)] bg-[var(--agent-bg-hi)]",
                  "font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--agent-text-2)]"
                )}
              >
                {signal}
              </span>
            ))}
          </Inline>
        ) : null}
      </Stack>
    </div>
  );
}

// ─── Health (read-only) ───────────────────────────────────────────────────────

/**
 * The deal's operational vital signs. A 2-column grid of label-over-value cells
 * with mono, tabular numbers.
 */
function HealthSection({ opportunity }: { opportunity: Opportunity }) {
  const { t } = useDictionary("pipeline");

  const daysInStage = getDaysInStage(opportunity);

  return (
    <Section title={t("overview.health", "Health")}>
      <div
        data-testid="overview-health"
        className="grid grid-cols-2 gap-x-3 gap-y-2.5"
      >
        <HealthCell label={t("overview.daysInStage", "Days in stage")}>
          <span className={NUM_CLASS}>{daysInStage}</span>
        </HealthCell>

        <HealthCell label={t("overview.created", "Created")}>
          <span className={NUM_CLASS}>{formatDate(opportunity.createdAt)}</span>
        </HealthCell>

        <HealthCell label={t("overview.lastActivity", "Last activity")}>
          {opportunity.lastActivityAt ? (
            <span className={NUM_CLASS}>
              {formatDate(opportunity.lastActivityAt)}
            </span>
          ) : (
            <span className="font-mono text-[13px] text-text-3">{EMPTY}</span>
          )}
        </HealthCell>

        <HealthCell
          label={t("overview.correspondence", "Correspondence")}
          className="col-span-2"
        >
          <span className={NUM_CLASS}>
            {opportunity.inboundCount}
            <span className="text-text-3"> {t("overview.in", "in")} </span>
            <span className="text-text-mute">/</span>{" "}
            {opportunity.outboundCount}
            <span className="text-text-3"> {t("overview.out", "out")}</span>
          </span>
        </HealthCell>
      </div>
    </Section>
  );
}

function HealthCell({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <Mono color="text-3" size={11}>
        {label}
      </Mono>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

// ─── Contact ──────────────────────────────────────────────────────────────────

/**
 * The person behind the deal. Linked client → name + mailto + tel + a link to
 * the client record. Unlinked → the inline `contact*` fields plus an
 * **Attach client** affordance (when the operator can manage) that opens a
 * searchable client picker and wires the real attach mutation.
 */
function ContactSection({
  opportunity,
  canManage,
}: {
  opportunity: Opportunity;
  canManage: boolean;
}) {
  const { t } = useDictionary("pipeline");
  const clientQuery = useClient(opportunity.clientId ?? undefined);
  const client = clientQuery.data;

  return (
    <Section title={t("overview.contact", "Contact")}>
      <div data-testid="overview-contact">
        {opportunity.clientId && client ? (
          <Stack gap={1}>
            <Inline gap={1.5} justify="between">
              <Body size={14} color="text" className="min-w-0 truncate">
                {client.name}
              </Body>
              <Link
                href={`/clients/${client.id}`}
                className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-3 transition-colors duration-150 hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
              >
                {t("overview.openClient", "Open client")}
                <ArrowUpRight className="h-2.5 w-2.5" strokeWidth={1.75} />
              </Link>
            </Inline>
            <ContactLinks email={client.email} phone={client.phoneNumber} />
            <DealContactRow
              opportunity={opportunity}
              client={client}
              canManage={canManage}
            />
          </Stack>
        ) : (
          <Stack gap={1}>
            {opportunity.contactName ? (
              <Body size={14} color="text" className="min-w-0 truncate">
                {opportunity.contactName}
              </Body>
            ) : (
              <Mono color="text-3" size={11}>
                {t("overview.noContact", "[ no contact ]")}
              </Mono>
            )}
            <ContactLinks
              email={opportunity.contactEmail}
              phone={opportunity.contactPhone}
            />
            {canManage ? (
              <AttachClientControl opportunityId={opportunity.id} />
            ) : null}
          </Stack>
        )}
      </div>
    </Section>
  );
}

function ContactLinks({
  email,
  phone,
}: {
  email: string | null;
  phone: string | null;
}) {
  const { t } = useDictionary("pipeline");
  if (!email && !phone) {
    return <span className="font-mono text-[11px] text-text-3">{EMPTY}</span>;
  }
  return (
    <Inline gap={2} wrap>
      {email ? (
        <a
          href={`mailto:${email}`}
          aria-label={t("overview.emailLabel", "Email")}
          className="inline-flex min-w-0 items-center gap-1 font-mono text-[11px] text-text-2 transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
        >
          <Mail className="h-2.5 w-2.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{email}</span>
        </a>
      ) : null}
      {phone ? (
        <a
          href={`tel:${phone}`}
          aria-label={t("overview.phoneLabel", "Phone")}
          className="inline-flex min-w-0 items-center gap-1 font-mono text-[11px] text-text-2 transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
        >
          <Phone className="h-2.5 w-2.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{phone}</span>
        </a>
      ) : null}
    </Inline>
  );
}

/** Case/whitespace-insensitive comparison key for names + emails. */
function normalizeIdentity(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Digits-only comparison key for phone numbers ("(555) 123" ≡ "555123"). */
function normalizePhone(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * DealContactRow — the person behind the deal, kept visible after a client is
 * linked (they are often NOT the client: the site super, the office manager,
 * the spouse who called). When that person isn't in the client's contact
 * roster yet, a quiet action files them as a `sub_client`; once they match a
 * roster entry (by email, else by name), the action yields to an `ON FILE`
 * mark. Hidden entirely when the deal contact just mirrors the client record —
 * nothing new to file (bug 59dd4aa0).
 */
function DealContactRow({
  opportunity,
  client,
  canManage,
}: {
  opportunity: Opportunity;
  client: Client;
  canManage: boolean;
}) {
  const { t } = useDictionary("pipeline");
  const createSubClient = useCreateSubClient();

  const contactName = (opportunity.contactName ?? "").trim();
  const contactEmail = (opportunity.contactEmail ?? "").trim();
  const contactPhone = (opportunity.contactPhone ?? "").trim();

  if (!contactName && !contactEmail && !contactPhone) return null;

  // The deal contact IS the client record itself — nothing new to file.
  const mirrorsClient =
    (!contactName ||
      normalizeIdentity(contactName) === normalizeIdentity(client.name)) &&
    (!contactEmail ||
      normalizeIdentity(contactEmail) === normalizeIdentity(client.email)) &&
    (!contactPhone ||
      normalizePhone(contactPhone) === normalizePhone(client.phoneNumber));
  if (mirrorsClient) return null;

  const subClients = client.subClients ?? [];
  const onFile = subClients.some((sc) => {
    if (sc.deletedAt) return false;
    if (
      contactEmail &&
      sc.email &&
      normalizeIdentity(sc.email) === normalizeIdentity(contactEmail)
    ) {
      return true;
    }
    return (
      Boolean(contactName) &&
      normalizeIdentity(sc.name) === normalizeIdentity(contactName)
    );
  });

  function save() {
    if (!contactName) return; // roster entries need a name
    createSubClient.mutate(
      {
        clientId: client.id,
        name: contactName,
        email: contactEmail || null,
        phoneNumber: contactPhone || null,
      },
      {
        onSuccess: () => {
          toast.success(
            t("overview.contactSaved", "Contact saved to {client}").replace(
              "{client}",
              client.name
            )
          );
        },
        onError: (error) => {
          toast.error(
            t("overview.contactSaveFailed", "Failed to save contact"),
            {
              description: error instanceof Error ? error.message : undefined,
            }
          );
        },
      }
    );
  }

  return (
    <div
      data-testid="overview-deal-contact"
      className="mt-1 border-t border-line pt-1.5"
    >
      <Stack gap={1}>
        <Inline gap={1.5} justify="between">
          <Mono color="text-3" size={11}>
            {t("overview.dealContact", "Deal contact")}
          </Mono>
          {onFile ? (
            <Mono color="mute" size={10}>
              {t("overview.contactOnFile", "On file")}
            </Mono>
          ) : null}
        </Inline>
        {contactName ? (
          <Body size={14} color="text" className="min-w-0 truncate">
            {contactName}
          </Body>
        ) : null}
        <ContactLinks
          email={contactEmail || null}
          phone={contactPhone || null}
        />
        {!onFile && canManage && contactName ? (
          <div className="mt-0.5">
            <button
              type="button"
              onClick={save}
              disabled={createSubClient.isPending}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[5px] border border-glass-border bg-[var(--surface-input)] px-2 py-1",
                "font-mono text-[10px] uppercase tracking-[0.14em] text-text-2",
                "transition-colors duration-150 hover:bg-surface-hover hover:text-text",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                "disabled:cursor-not-allowed disabled:opacity-40"
              )}
            >
              <UserPlus className="h-3 w-3" strokeWidth={1.75} />
              {t("overview.saveContactToClient", "Save contact to client")}
            </button>
          </div>
        ) : null}
      </Stack>
    </div>
  );
}

/**
 * The Attach-client affordance: a button that opens a searchable `useClients()`
 * list in an {@link EditPopover}; selecting an option fires the real
 * {@link useAttachClientToOpportunity} mutation (which also re-parents any
 * client-less estimates). Functional — not a stub.
 */
function AttachClientControl({ opportunityId }: { opportunityId: string }) {
  const { t } = useDictionary("pipeline");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const attach = useAttachClientToOpportunity();
  const clientsQuery = useClients();

  const clients = clientsQuery.data?.clients ?? [];
  const filtered = query.trim()
    ? clients.filter((c) =>
        c.name.toLowerCase().includes(query.trim().toLowerCase())
      )
    : clients;

  function pick(clientId: string) {
    attach.mutate({ opportunityId, clientId });
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="mt-0.5">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[5px] border border-glass-border bg-[var(--surface-input)] px-2 py-1",
          "font-mono text-[10px] uppercase tracking-[0.14em] text-text-2",
          "transition-colors duration-150 hover:bg-surface-hover hover:text-text",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
        )}
      >
        <UserPlus className="h-3 w-3" strokeWidth={1.75} />
        {t("overview.attachClient", "Attach client")}
      </button>

      <EditPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        ariaLabel={t("overview.attachClient", "Attach client")}
        width={260}
      >
        <input
          type="text"
          aria-label={t("overview.searchClients", "Search clients")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(
            "overview.searchClientsPlaceholder",
            "[ search clients ]"
          )}
          className={cn(
            "mb-1 h-9 w-full rounded-[5px] border border-glass-border bg-[var(--surface-input)] px-2",
            "font-mohave text-[14px] text-text outline-none transition-colors duration-150 placeholder:text-text-mute",
            "focus:border-glass-border-strong focus-visible:ring-1 focus-visible:ring-ops-accent"
          )}
        />
        <div
          role="listbox"
          aria-label={t("overview.attachClient", "Attach client")}
        >
          {filtered.length === 0 ? (
            <p className="px-2 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
              {t("overview.noClients", "No clients")}
            </p>
          ) : (
            filtered.slice(0, 50).map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => pick(c.id)}
                className={cn(
                  "flex h-9 w-full min-w-0 items-center rounded-[5px] px-2 text-left",
                  "font-mohave text-[14px] text-text-2 transition-colors duration-100",
                  "hover:bg-surface-hover hover:text-text",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
                )}
              >
                <span className="min-w-0 truncate">{c.name}</span>
              </button>
            ))
          )}
        </div>
      </EditPopover>
    </div>
  );
}

// ─── Location ─────────────────────────────────────────────────────────────────

/**
 * The job site. The {@link AddressField} editor (geocode autocomplete →
 * address+lat/lng, feeding the band map) plus a real "Open in Maps" link. URL
 * logic mirrors the band/project-sidebar: coords → search by `lat,lng`, else the
 * encoded address, else no link.
 */
function LocationSection({
  opportunity,
  edit,
  canManage,
}: {
  opportunity: Opportunity;
  edit: ReturnType<typeof useOpportunityFieldEdit>;
  canManage: boolean;
}) {
  const { t } = useDictionary("pipeline");
  const mapsUrl = buildMapsUrl(opportunity);

  return (
    <Section
      title={t("overview.location", "Location")}
      rightSlot={
        mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-3 transition-colors duration-150 hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
          >
            <MapPin className="h-2.5 w-2.5" strokeWidth={1.75} />
            {t("overview.openInMaps", "Open in Maps")}
          </a>
        ) : undefined
      }
    >
      <AddressField
        edit={edit}
        canManage={canManage}
        value={{
          address: opportunity.address,
          latitude: opportunity.latitude,
          longitude: opportunity.longitude,
        }}
      />
    </Section>
  );
}

/**
 * Build the external Maps link. Coordinates win (most precise); fall back to the
 * encoded address; return null when neither exists (so the link hides). Matches
 * the project sidebar / map-page format already shipping in OPS-Web.
 */
function buildMapsUrl(
  opportunity: Pick<Opportunity, "address" | "latitude" | "longitude">
): string | null {
  if (opportunity.latitude != null && opportunity.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${opportunity.latitude},${opportunity.longitude}`;
  }
  if (opportunity.address && opportunity.address.trim().length > 0) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      opportunity.address
    )}`;
  }
  return null;
}

// ─── Linked records ───────────────────────────────────────────────────────────

/** Estimate status → semantic chip variant (earth tones, always with text). */
function estimateChipVariant(status: EstimateStatus): ChipVariant {
  switch (status) {
    case EstimateStatus.Approved:
      return "olive";
    case EstimateStatus.Sent:
    case EstimateStatus.Viewed:
      return "tan";
    case EstimateStatus.Declined:
      return "rose";
    default:
      // Draft / ChangesRequested / Converted / Expired / Superseded → neutral.
      return "neutral";
  }
}

const ESTIMATE_STATUS_FALLBACK: Record<EstimateStatus, string> = {
  [EstimateStatus.Draft]: "Draft",
  [EstimateStatus.Sent]: "Sent",
  [EstimateStatus.Viewed]: "Viewed",
  [EstimateStatus.Approved]: "Approved",
  [EstimateStatus.ChangesRequested]: "Changes requested",
  [EstimateStatus.Declined]: "Declined",
  [EstimateStatus.Converted]: "Converted",
  [EstimateStatus.Expired]: "Expired",
  [EstimateStatus.Superseded]: "Superseded",
};

const SITE_VISIT_STATUS_FALLBACK: Record<SiteVisitStatus, string> = {
  [SiteVisitStatus.Scheduled]: "Scheduled",
  [SiteVisitStatus.InProgress]: "In progress",
  [SiteVisitStatus.Completed]: "Completed",
  [SiteVisitStatus.Cancelled]: "Cancelled",
};

/** Site-visit status → chip variant (scheduled = attention/tan, done = olive). */
function siteVisitChipVariant(status: SiteVisitStatus): ChipVariant {
  switch (status) {
    case SiteVisitStatus.Completed:
      return "olive";
    case SiteVisitStatus.Scheduled:
    case SiteVisitStatus.InProgress:
      return "tan";
    case SiteVisitStatus.Cancelled:
      return "rose";
    default:
      return "neutral";
  }
}

/**
 * Everything attached to the deal: estimates (list gated on `estimates.view` —
 * the hook returns `undefined` data when denied), the converted project (display
 * + open only — conversion is owned by the won-deal flow, NOT here), and site
 * visits (with a wired **Schedule** affordance via {@link CreateSiteVisitModal}).
 *
 * A **New estimate** action (gated on `estimates.create`) opens the global
 * `CreateEstimateForm` floating window scoped to this deal — a dedicated
 * `create-estimate:<oppId>` window carrying `{ opportunityId, clientId }`
 * metadata — so the drafted estimate writes `opportunity_id` and surfaces back
 * in `useEstimates({ opportunityId })`. (The form is now opportunity-aware via
 * `createEstimateDefaultsFromMeta`; it previously could not be scoped.)
 */
function LinkedSection({
  opportunity,
  canManage,
}: {
  opportunity: Opportunity;
  canManage: boolean;
}) {
  const { t } = useDictionary("pipeline");
  // Creating an estimate is governed by `estimates.create` — independent of the
  // pipeline `canManage` gate (a user may quote without managing the deal).
  const canCreateEstimate = usePermissionStore((s) =>
    s.can("estimates.create")
  );
  const openWindow = useWindowStore((s) => s.openWindow);
  const estimatesQuery = useEstimates({ opportunityId: opportunity.id });
  const siteVisitsQuery = useSiteVisits({ opportunityId: opportunity.id });
  const [scheduling, setScheduling] = useState(false);

  const estimates = estimatesQuery.data ?? [];
  const siteVisits = sortVisits(siteVisitsQuery.data ?? []);

  return (
    <Section title={t("overview.linked", "Linked")}>
      <div data-testid="overview-linked">
        <Stack gap={2}>
          {/* ── Estimates ─────────────────────────────────────────────── */}
          <Stack gap={1}>
            <Inline justify="between">
              <Mono color="text-3" size={11}>
                {t("overview.estimates", "Estimates")}
              </Mono>
              {canCreateEstimate ? (
                <button
                  type="button"
                  onClick={() =>
                    openWindow({
                      // Deal-scoped window id → its own pre-filled instance,
                      // distinct from the FAB's general "create-estimate".
                      id: `create-estimate:${opportunity.id}`,
                      title: t("overview.newEstimate", "New estimate"),
                      type: "create-estimate",
                      metadata: {
                        opportunityId: opportunity.id,
                        clientId: opportunity.clientId,
                      },
                    })
                  }
                  className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-3 transition-colors duration-150 hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
                >
                  <Plus className="h-2.5 w-2.5" strokeWidth={2} />
                  {t("overview.newEstimate", "New estimate")}
                </button>
              ) : null}
            </Inline>
            {estimates.length === 0 ? (
              <div data-testid="overview-estimates-empty">
                <Mono color="text-3" size={11}>
                  {t("overview.noEstimates", "[ no estimates ]")}
                </Mono>
              </div>
            ) : (
              <Stack gap={0.5}>
                {estimates.map((estimate) => (
                  <EstimateRow key={estimate.id} estimate={estimate} />
                ))}
              </Stack>
            )}
          </Stack>

          {/* ── Project (display + open only — no convert here) ────────── */}
          {opportunity.projectId ? (
            <Stack gap={1}>
              <Mono color="text-3" size={11}>
                {t("overview.project", "Project")}
              </Mono>
              <LinkedRow
                href={`/dashboard?openProject=${opportunity.projectId}&mode=view`}
                icon={<ExternalLink className="h-3 w-3" strokeWidth={1.75} />}
                label={t("overview.openProject", "Open project")}
              />
            </Stack>
          ) : null}

          {/* ── Site visits ───────────────────────────────────────────── */}
          <Stack gap={1}>
            <Inline justify="between">
              <Mono color="text-3" size={11}>
                {t("overview.siteVisits", "Site visits")}
              </Mono>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => setScheduling(true)}
                  className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-3 transition-colors duration-150 hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
                >
                  <Plus className="h-2.5 w-2.5" strokeWidth={2} />
                  {t("overview.schedule", "Schedule")}
                </button>
              ) : null}
            </Inline>
            {siteVisits.length === 0 ? (
              <Mono color="text-3" size={11}>
                {t("overview.noSiteVisits", "[ none scheduled ]")}
              </Mono>
            ) : (
              <Stack gap={0.5}>
                {siteVisits.map((visit) => (
                  <SiteVisitRow key={visit.id} visit={visit} />
                ))}
              </Stack>
            )}
          </Stack>
        </Stack>

        {canManage ? (
          <CreateSiteVisitModal
            opportunityId={opportunity.id}
            clientId={opportunity.clientId}
            currentStage={opportunity.stage}
            open={scheduling}
            onOpenChange={setScheduling}
          />
        ) : null}
      </div>
    </Section>
  );
}

/** Upcoming (soonest first) ahead of past — same rhythm as the project dossier. */
function sortVisits(visits: SiteVisit[]): SiteVisit[] {
  const now = Date.now();
  return [...visits].sort((a, b) => {
    const aFuture = a.scheduledAt.getTime() >= now;
    const bFuture = b.scheduledAt.getTime() >= now;
    if (aFuture !== bFuture) return aFuture ? -1 : 1;
    return aFuture
      ? a.scheduledAt.getTime() - b.scheduledAt.getTime()
      : b.scheduledAt.getTime() - a.scheduledAt.getTime();
  });
}

function EstimateRow({ estimate }: { estimate: Estimate }) {
  const { t } = useDictionary("pipeline");
  const variant = estimateChipVariant(estimate.status);
  const label = t(
    `overview.estimateStatus.${estimate.status}`,
    ESTIMATE_STATUS_FALLBACK[estimate.status]
  );

  return (
    <Link
      href={`/estimates?estimate=${estimate.id}`}
      className={cn(
        "group flex items-center gap-2 rounded-[5px] px-1.5 py-1",
        "transition-colors duration-150 hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
      )}
    >
      <FileText className="h-3 w-3 shrink-0 text-text-3" strokeWidth={1.75} />
      <span className="min-w-0 truncate font-mono text-[11px] tabular-nums text-text-2 [font-feature-settings:'tnum'_1,'zero'_1] group-hover:text-text">
        {estimate.estimateNumber}
      </span>
      <Chip variant={variant}>{label}</Chip>
      <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-text-2 [font-feature-settings:'tnum'_1,'zero'_1]">
        {formatCurrency(estimate.total)}
      </span>
      <ArrowUpRight
        className="h-3 w-3 shrink-0 text-text-mute transition-colors group-hover:text-text-2"
        strokeWidth={1.75}
      />
    </Link>
  );
}

function SiteVisitRow({ visit }: { visit: SiteVisit }) {
  const { t } = useDictionary("pipeline");
  const variant = siteVisitChipVariant(visit.status);
  const label = t(
    `overview.siteVisitStatus.${visit.status}`,
    SITE_VISIT_STATUS_FALLBACK[visit.status]
  );

  return (
    <div className="flex items-center gap-2 rounded-[5px] px-1.5 py-1">
      <MapPin className="h-3 w-3 shrink-0 text-text-3" strokeWidth={1.75} />
      <span className="min-w-0 truncate font-mono text-[11px] tabular-nums text-text-2 [font-feature-settings:'tnum'_1,'zero'_1]">
        {formatDate(visit.scheduledAt)}
      </span>
      <Chip variant={variant}>{label}</Chip>
    </div>
  );
}

function LinkedRow({
  href,
  icon,
  label,
}: {
  href: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-2 rounded-[5px] px-1.5 py-1",
        "transition-colors duration-150 hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
      )}
    >
      <span className="shrink-0 text-text-3 group-hover:text-text-2">
        {icon}
      </span>
      <span className="min-w-0 truncate font-mono text-[11px] uppercase tracking-[0.12em] text-text-2 group-hover:text-text">
        {label}
      </span>
      <ArrowUpRight
        className="ml-auto h-3 w-3 shrink-0 text-text-mute transition-colors group-hover:text-text-2"
        strokeWidth={1.75}
      />
    </Link>
  );
}
