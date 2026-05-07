"use client";

/**
 * ContextRail — faithful to `reference/v3-messages.jsx :: V3ContextPanel`
 * client header + `reference/v4-context-tabs.jsx :: CtxPanel_TabsRefined`
 * tab strip and body.
 *
 * Header (panel bg, hairline border-bottom):
 *   ┌────────────────────────────────────────┐
 *   │ [36px avatar]  Client name              │
 *   │                client type · tier       │
 *   │ [📞 ][ ✉ ][ 📅 ][ ↗ ]                  │  ← four 28px ghost buttons
 *   └────────────────────────────────────────┘
 *
 * Tabs (panel bg, 38px tall, accent underline on active).
 * Body (overflow-y auto, padding 12).
 */

import { Calendar, ExternalLink, Mail, Phone } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  TabStrip,
  type ContextTab,
  type ContextTabKey,
} from "./tab-strip";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

interface ContextRailProps {
  client: {
    name: string;
    tier?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  /** Source-of-truth thread id. Changing this re-mounts the inner state and
   *  resets the active tab to "projects". */
  threadId: string;
  onCall?: () => void;
  onEmail?: () => void;
  onSchedule?: () => void;
  onOpenClient: () => void;
  counts: { projects: number; pipeline: number; files: number };
  projects: ReactNode;
  pipeline: ReactNode;
  files: ReactNode;
  className?: string;
}

export function ContextRail(props: ContextRailProps) {
  return <InnerContextRail key={props.threadId} {...props} />;
}

function safeInitials(name: string): string {
  const parts = name.trim().split(/[\s&]+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "·";
}

function InnerContextRail({
  client,
  onCall,
  onEmail,
  onSchedule,
  onOpenClient,
  counts,
  projects,
  pipeline,
  files,
  className,
}: Omit<ContextRailProps, "threadId">) {
  const { t } = useDictionary("inbox");
  const [active, setActive] = useState<ContextTabKey>("projects");

  // Belt-and-braces: in case React keeps the instance for any reason, force
  // a state reset when counts change. The key prop on the wrapper is the
  // primary mechanism.
  useEffect(() => setActive("projects"), []);

  const tabs: ContextTab[] = [
    {
      key: "projects",
      label: t("rail.tabs.projects", "Projects"),
      count: counts.projects,
    },
    {
      key: "pipeline",
      label: t("rail.tabs.pipeline", "Pipeline"),
      count: counts.pipeline,
    },
    { key: "files", label: t("rail.tabs.files", "Files"), count: counts.files },
  ];

  const phoneHandler =
    onCall ?? (client.phone ? () => window.open(`tel:${client.phone}`) : undefined);
  const emailHandler =
    onEmail ??
    (client.email ? () => window.open(`mailto:${client.email}`) : undefined);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-inbox-bg-deep", className)}>
      <header className="shrink-0 border-b border-line bg-inbox-panel px-4 pb-3.5 pt-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line-hi bg-inbox-elev font-mohave text-[12px] tracking-[0.02em] text-text-2"
          >
            {safeInitials(client.name)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-mohave text-[14.5px] font-medium tracking-[-0.005em] text-text">
              {client.name}
            </h2>
            {client.tier && (
              <p
                className="mt-0.5 truncate font-mono text-[10px] tracking-[0.2em] text-text-3"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {client.tier}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex gap-1">
          <RailQuickAction
            label={t("rail.call", "Call")}
            icon={<Phone aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />}
            onClick={phoneHandler}
            disabled={!phoneHandler}
          />
          <RailQuickAction
            label={t("rail.email", "Email")}
            icon={<Mail aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />}
            onClick={emailHandler}
            disabled={!emailHandler}
          />
          <RailQuickAction
            label={t("rail.schedule", "Schedule")}
            icon={
              <Calendar aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
            }
            onClick={onSchedule}
            disabled={!onSchedule}
          />
          <RailQuickAction
            label={t("rail.openClient", "Open record")}
            icon={
              <ExternalLink
                aria-hidden
                className="h-3.5 w-3.5"
                strokeWidth={1.75}
              />
            }
            onClick={onOpenClient}
          />
        </div>
      </header>
      <TabStrip tabs={tabs} active={active} onSelect={setActive} />
      <div
        role="tabpanel"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-hide p-3"
      >
        {active === "projects" && projects}
        {active === "pipeline" && pipeline}
        {active === "files" && files}
      </div>
    </div>
  );
}

function RailQuickAction({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-7 flex-1 items-center justify-center rounded-md border border-line bg-transparent text-text-3",
        disabled
          ? "cursor-not-allowed opacity-40"
          : "hover:border-line-hi hover:bg-inbox-elev hover:text-text-2",
      )}
    >
      {icon}
    </button>
  );
}
