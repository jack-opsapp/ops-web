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
 *   - unlinked → render `// CLIENT :: UNLINKED` + body line + `LINK CLIENT`
 *                button. Tab strip dims to 40% opacity and tab bodies are
 *                replaced by `[—] link a client to see context`.
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
  /** Fired by the LINK CLIENT button in the unlinked state. */
  onLinkClient?: () => void;
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
  onLinkClient,
  counts,
  work,
  accounting,
  files,
  className,
}: Omit<ContextRailProps, "threadId">) {
  const { t } = useDictionary("inbox");
  const [active, setActive] = useState<ContextTabKey>("work");

  // Belt-and-braces: in case React keeps the instance for any reason, force
  // a state reset when counts change. The key prop on the wrapper is the
  // primary mechanism.
  useEffect(() => setActive("work"), []);

  const isUnlinked = !client;

  const tabs: ContextTab[] = [
    {
      key: "work",
      label: t("rail.tabWork", "WORK"),
      count: counts.work,
    },
    {
      key: "accounting",
      label: t("rail.tabAccounting", "ACCOUNTING"),
      count: counts.accounting,
    },
    {
      key: "files",
      label: t("rail.tabFiles", "FILES"),
      count: counts.files,
    },
  ];

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-inbox-bg-deep", className)}>
      {isUnlinked ? (
        <UnlinkedHeader t={t} onLinkClient={onLinkClient} />
      ) : (
        <LinkedHeader t={t} client={client} onOpenClient={onOpenClient} />
      )}
      <div
        data-testid="rail-tabstrip-wrap"
        className={cn(isUnlinked && "pointer-events-none opacity-40")}
      >
        <TabStrip tabs={tabs} active={active} onSelect={setActive} />
      </div>
      <div
        role="tabpanel"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-hide p-3"
      >
        {isUnlinked ? (
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
    <header className="shrink-0 border-b border-line bg-inbox-panel px-4 pb-3 pt-3.5">
      {/* // CLIENT label */}
      <p className="font-cakemono text-[11px] font-light uppercase leading-none tracking-[0.18em] text-text-mute">
        {t("rail.clientLabel", "// CLIENT")}
      </p>

      {/* Identity row — avatar + name/subtitle + OPEN button */}
      <div className="mt-2.5 flex items-start gap-3">
        <InboxAvatar name={client.name} size={36} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mohave text-[14px] font-medium tracking-[-0.005em] text-text">
            {client.name}
          </h2>
          {client.subtitle && (
            <p
              className="mt-0.5 truncate font-mono text-[11px] text-text-3"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {client.subtitle}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenClient}
          aria-label={t("rail.openClient", "Open client")}
          className="inline-flex shrink-0 items-center gap-1 rounded-[2px] border border-line px-2 py-1 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-text-2 transition-colors hover:bg-inbox-elev"
        >
          <ExternalLink
            aria-hidden
            className="h-3.5 w-3.5"
            strokeWidth={1.5}
          />
          {t("rail.openButton", "OPEN")}
        </button>
      </div>

      {/* Contact lines — [PHONE] / [EMAIL] / [ADDR] bracket labels */}
      {(client.phone || client.email || client.address) && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {client.phone && (
            <li>
              <a
                href={`tel:${client.phone}`}
                className="inline-flex items-baseline gap-2 font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-mute">
                  {t("rail.contactPhone", "[PHONE]")}
                </span>
                <span>{client.phone}</span>
              </a>
            </li>
          )}
          {client.email && (
            <li>
              <a
                href={`mailto:${client.email}`}
                className="inline-flex items-baseline gap-2 font-mono text-[11px] text-text-2 transition-colors hover:text-text"
              >
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-mute">
                  {t("rail.contactEmail", "[EMAIL]")}
                </span>
                <span className="truncate">{client.email}</span>
              </a>
            </li>
          )}
          {client.address && (
            <li>
              <span
                className="inline-flex items-baseline gap-2 font-mono text-[11px] text-text-2"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-mute">
                  {t("rail.contactAddr", "[ADDR]")}
                </span>
                <span className="truncate">{client.address}</span>
              </span>
            </li>
          )}
        </ul>
      )}
    </header>
  );
}

function UnlinkedHeader({
  t,
  onLinkClient,
}: {
  t: TFn;
  onLinkClient?: () => void;
}) {
  return (
    <header className="shrink-0 border-b border-line bg-inbox-panel px-4 pb-3 pt-3.5">
      <p className="font-cakemono text-[11px] font-light uppercase leading-none tracking-[0.18em] text-text-2">
        {t("rail.clientUnlinked", "// CLIENT :: UNLINKED")}
      </p>
      <p className="mt-2 font-mono text-[11px] text-text-3">
        {t("rail.clientUnlinkedBody", "[—] thread has no client attached")}
      </p>
      <button
        type="button"
        onClick={onLinkClient}
        className="mt-3 inline-flex items-center gap-1 rounded-[2px] border border-line-hi px-3 py-1.5 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-text-2 transition-colors hover:bg-inbox-elev"
      >
        {t("rail.linkClient", "LINK CLIENT")}
      </button>
    </header>
  );
}
