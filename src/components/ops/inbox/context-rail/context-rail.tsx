"use client";

import { ExternalLink } from "lucide-react";
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
  };
  /** Source-of-truth thread id. Changing this re-mounts the inner state and
   *  resets the active tab to "projects". This is the explicit no-persistence
   *  rule from the design spec. */
  threadId: string;
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

function InnerContextRail({
  client,
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

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-inbox-bg-deep", className)}>
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-inbox-panel px-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mohave text-[14px] font-medium tracking-[-0.005em] text-text">
            {client.name}
          </h2>
          {client.tier && (
            <p className="font-cakemono text-[9.5px] font-light uppercase leading-none tracking-[0.18em] text-text-3">
              {client.tier}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenClient}
          aria-label={t("rail.openClient", "Open client record")}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-text-3 hover:bg-inbox-elev hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
        >
          <ExternalLink aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
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
