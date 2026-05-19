"use client";

/**
 * ContextRail — 3-tab production rail per spec § 6.1
 * (WORK · ACCOUNTING · FILES).
 *
 * Header anatomy (mockup-faithful, per spec § 6.2):
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ // CLIENT                                               │
 *   │ [CR]  Calloway Roofing Co.              [↗ OPEN]        │
 *   │       Property mgmt · 4 buildings                       │
 *   │ [PHONE] (604) 555-0184                                  │
 *   │ [EMAIL] jeanne@callowayroof.co                          │
 *   │ [ADDR]  5421 Ash St, Vancouver BC                       │
 *   └─────────────────────────────────────────────────────────┘
 *
 * The header has two modes:
 *   - linked   → render the avatar, name/subtitle, OPEN button, contact rows
 *   - unlinked → render `// CLIENT :: UNLINKED` + body line. WORK /
 *                ACCOUNTING stay client-gated; FILES remains available when
 *                the current provider thread has attachments.
 *
 * Tabs: work (default) / accounting / files. State resets to work on every
 * threadId change (see <ContextRail/> wrapper). The legacy Pipeline/Tasks/
 * Threads tabs were collapsed in Phase D1 — pipeline + tasks fold into WORK;
 * threads moves to the detail-header thread picker in Phase E.
 */

import { ExternalLink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  TabStrip,
  type ContextTab,
  type ContextTabKey,
} from "./tab-strip";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { InboxAvatar } from "../avatar";

interface ContextRailClient {
  name: string;
  /** "Property mgmt · 4 buildings", "Tier-1 client · Past customer", etc. */
  subtitle?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Single-line address. Renders below email when present. */
  address?: string | null;
}

interface ContextRailProps {
  /** Omit (or pass `undefined`) to render the unlinked-state header. */
  client?: ContextRailClient;
  /** Source-of-truth thread id. Changing this re-mounts the inner state and
   *  resets the active tab to "work". */
  threadId: string;
  onOpenClient?: () => void;
  counts: { work: number; accounting: number; files: number };
  work: ReactNode;
  accounting: ReactNode;
  files: ReactNode;
  className?: string;
}

export function ContextRail(props: ContextRailProps) {
  return <InnerContextRail key={props.threadId} {...props} />;
}

function InnerContextRail({
  client,
  onOpenClient,
  counts,
  work,
  accounting,
  files,
  className,
}: Omit<ContextRailProps, "threadId">) {
  const { t } = useDictionary("inbox");
  const isUnlinked = !client;
  const unlinkedFilesAvailable = isUnlinked && counts.files > 0;
  const [active, setActive] = useState<ContextTabKey>(() =>
    unlinkedFilesAvailable ? "files" : "work",
  );

  // The wrapper key resets state on thread changes. This effect handles the
  // second step: provider attachments arrive after the unlinked rail mounts,
  // and FILES should become the visible tab as soon as they exist.
  useEffect(() => {
    if (unlinkedFilesAvailable) {
      setActive("files");
      return;
    }
    if (isUnlinked) {
      setActive("work");
    }
  }, [isUnlinked, unlinkedFilesAvailable]);

  const tabs: ContextTab[] = [
    {
      key: "work",
      label: t("rail.tabWork", "WORK"),
      count: counts.work,
      disabled: isUnlinked,
    },
    {
      key: "accounting",
      label: t("rail.tabAccounting", "ACCOUNTING"),
      count: counts.accounting,
      disabled: isUnlinked,
    },
    {
      key: "files",
      label: t("rail.tabFiles", "FILES"),
      count: counts.files,
      disabled: isUnlinked && !unlinkedFilesAvailable,
    },
  ];

  const onTabSelect = (key: ContextTabKey) => {
    if (isUnlinked && key !== "files") return;
    if (isUnlinked && key === "files" && !unlinkedFilesAvailable) return;
    setActive(key);
  };

  return (
    <div
      data-inbox-debug-id="D1"
      data-inbox-debug-label="CONTEXT RAIL CONTENT"
      className={cn("flex min-h-0 flex-1 flex-col bg-inbox-bg-deep", className)}
    >
      {isUnlinked ? (
        <UnlinkedHeader t={t} />
      ) : (
        <LinkedHeader t={t} client={client} onOpenClient={onOpenClient} />
      )}
      <div
        data-inbox-debug-id="D3"
        data-inbox-debug-label="CONTEXT TABS"
        data-testid="rail-tabstrip-wrap"
        className={cn(
          isUnlinked && !unlinkedFilesAvailable && "pointer-events-none opacity-40",
        )}
      >
        <TabStrip tabs={tabs} active={active} onSelect={onTabSelect} />
      </div>
      <div
        data-inbox-debug-id="D4"
        data-inbox-debug-label="CONTEXT BODY"
        role="tabpanel"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-hide p-3"
      >
        {isUnlinked && !(active === "files" && unlinkedFilesAvailable) ? (
          <p className="font-mono text-[11px] text-text-mute">
            {t("rail.emptyUnlinkedBody", "[—] link a client to see context")}
          </p>
        ) : (
          <>
            {active === "work" && work}
            {active === "accounting" && accounting}
            {active === "files" && files}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Header variants ─────────────────────────────────────────────────────────

type TFn = (key: string, fallback: string) => string;

const TNUM_ZERO = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

function LinkedHeader({
  t,
  client,
  onOpenClient,
}: {
  t: TFn;
  client: ContextRailClient;
  onOpenClient?: () => void;
}) {
  return (
    <header
      data-inbox-debug-id="D2"
      data-inbox-debug-label="CLIENT HEADER"
      className="shrink-0 border-b border-line bg-inbox-panel px-3.5 pb-2.5 pt-2.5"
    >
      {/* // CLIENT label */}
      <p className="font-cakemono text-[11px] font-light uppercase leading-none tracking-[0.18em] text-text-mute">
        {t("rail.clientLabel", "// CLIENT")}
      </p>

      {/* Identity row — avatar + name/subtitle + OPEN button */}
      <div className="mt-2 flex items-start gap-2">
        <InboxAvatar name={client.name} size={24} />
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 break-words font-mohave text-[14px] font-medium leading-[1.05] text-text">
            {client.name}
          </h2>
          {client.subtitle && (
            <p
              className="mt-0.5 break-words font-mono text-[11px] uppercase leading-[1.2] tracking-[0.10em] text-text-3"
              style={TNUM_ZERO}
            >
              {client.subtitle}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenClient}
          aria-label={t("rail.openClient", "Open client")}
          title={t("rail.openClient", "Open client")}
          className="inline-flex shrink-0 items-center justify-center rounded-[2px] border border-line p-0.5 text-text-3 transition-colors hover:bg-inbox-elev hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          <ExternalLink
            aria-hidden
            className="h-3 w-3"
            strokeWidth={1.5}
          />
        </button>
      </div>

      {/* Contact lines — [PHONE] / [EMAIL] / [ADDR] bracket labels */}
      {(client.phone || client.email || client.address) && (
        <ul className="mt-2.5 grid gap-1">
          {client.phone && (
            <ContactLine
              label={t("rail.contactPhone", "[PHONE]")}
              value={client.phone}
              href={`tel:${client.phone}`}
              valueClassName="whitespace-nowrap"
            />
          )}
          {client.email && (
            <ContactLine
              label={t("rail.contactEmail", "[EMAIL]")}
              value={client.email}
              href={`mailto:${client.email}`}
              valueClassName="break-all"
            />
          )}
          {client.address && (
            <ContactLine
              label={t("rail.contactAddr", "[ADDR]")}
              value={client.address}
              valueClassName="break-words"
            />
          )}
        </ul>
      )}
    </header>
  );
}

function ContactLine({
  label,
  value,
  href,
  valueClassName,
}: {
  label: string;
  value: string;
  href?: string;
  valueClassName?: string;
}) {
  const className = cn(
    "grid grid-cols-[48px_minmax(0,1fr)] items-baseline gap-2 font-mono text-[11px] leading-[1.25] text-text-2",
    href && "transition-colors hover:text-text",
  );
  const content = (
    <>
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-mute">
        {label}
      </span>
      <span className={cn("min-w-0", valueClassName)}>{value}</span>
    </>
  );

  return (
    <li style={TNUM_ZERO}>
      {href ? (
        <a href={href} className={className}>
          {content}
        </a>
      ) : (
        <span className={className}>{content}</span>
      )}
    </li>
  );
}

function UnlinkedHeader({
  t,
}: {
  t: TFn;
}) {
  return (
    <header
      data-inbox-debug-id="D2"
      data-inbox-debug-label="UNLINKED CLIENT HEADER"
      className="shrink-0 border-b border-line bg-inbox-panel px-3.5 pb-3 pt-3"
    >
      <p className="font-cakemono text-[11px] font-light uppercase leading-none tracking-[0.18em] text-text-2">
        {t("rail.clientUnlinked", "// CLIENT :: UNLINKED")}
      </p>
      <p className="mt-2 font-mono text-[11px] text-text-3">
        {t("rail.clientUnlinkedBody", "[—] thread has no client attached")}
      </p>
    </header>
  );
}
