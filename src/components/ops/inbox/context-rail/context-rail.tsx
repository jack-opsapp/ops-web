"use client";

/**
 * ContextRail — 3-tab production rail per spec § 6.1
 * (WORK · ACCOUNTING · FILES).
 *
 * Header anatomy (mockup-faithful):
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ [CR]  Calloway Roofing Co.                  [↗]         │
 *   │       Property mgmt · 4 buildings                       │
 *   │ ☎ (604) 555-0184                                        │
 *   │ ✉ jeanne@callowayroof.co                                │
 *   │ ⌂ 5421 Ash St, Vancouver BC                             │
 *   └─────────────────────────────────────────────────────────┘
 *
 * The contact lines use Mohave 11.5 / -0.003em / text-2 with muted Lucide
 * icons (1.5 stroke). The avatar is a circular monogram in the V3Avatar
 * pattern (panel-hi background, lineHi border, text-2 initials).
 *
 * Tabs: work (default) / accounting / files. State resets to work on
 * every threadId change (see <ContextRail/> wrapper). The legacy
 * Pipeline/Tasks/Threads tabs were collapsed in Phase D1 — pipeline +
 * tasks fold into WORK; threads moves to the detail-header thread
 * picker in Phase E.
 */

import { ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  TabStrip,
  type ContextTab,
  type ContextTabKey,
} from "./tab-strip";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { InboxAvatar } from "../avatar";

interface ContextRailProps {
  client: {
    name: string;
    /** "Property mgmt · 4 buildings", "Tier-1 client · Past customer", etc. */
    subtitle?: string | null;
    phone?: string | null;
    email?: string | null;
    /** Single-line address. Renders below email when present. */
    address?: string | null;
  };
  /** Source-of-truth thread id. Changing this re-mounts the inner state and
   *  resets the active tab to "work". */
  threadId: string;
  onOpenClient: () => void;
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
  const [active, setActive] = useState<ContextTabKey>("work");

  // Belt-and-braces: in case React keeps the instance for any reason, force
  // a state reset when counts change. The key prop on the wrapper is the
  // primary mechanism.
  useEffect(() => setActive("work"), []);

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
      <header className="shrink-0 border-b border-line bg-inbox-panel px-4 pb-3 pt-3.5">
        {/* Identity row — avatar + name/subtitle + open-client icon */}
        <div className="flex items-start gap-3">
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
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-chip text-text-3 transition-colors hover:bg-inbox-elev hover:text-text-2"
          >
            <ExternalLink
              aria-hidden
              className="h-3.5 w-3.5"
              strokeWidth={1.5}
            />
          </button>
        </div>

        {/* Contact lines */}
        {(client.phone || client.email || client.address) && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {client.phone && (
              <li>
                <a
                  href={`tel:${client.phone}`}
                  className="inline-flex items-center gap-2 font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                  style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                >
                  <Phone
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 text-text-mute"
                    strokeWidth={1.5}
                  />
                  <span>{client.phone}</span>
                </a>
              </li>
            )}
            {client.email && (
              <li>
                <a
                  href={`mailto:${client.email}`}
                  className="inline-flex items-center gap-2 font-mono text-[11px] text-text-2 transition-colors hover:text-text"
                >
                  <Mail
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 text-text-mute"
                    strokeWidth={1.5}
                  />
                  <span className="truncate">{client.email}</span>
                </a>
              </li>
            )}
            {client.address && (
              <li>
                <span
                  className="inline-flex items-center gap-2 font-mono text-[11px] text-text-2"
                  style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                >
                  <MapPin
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 text-text-mute"
                    strokeWidth={1.5}
                  />
                  <span className="truncate">{client.address}</span>
                </span>
              </li>
            )}
          </ul>
        )}
      </header>
      <TabStrip tabs={tabs} active={active} onSelect={setActive} />
      <div
        role="tabpanel"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-hide p-3"
      >
        {active === "work" && work}
        {active === "accounting" && accounting}
        {active === "files" && files}
      </div>
    </div>
  );
}
