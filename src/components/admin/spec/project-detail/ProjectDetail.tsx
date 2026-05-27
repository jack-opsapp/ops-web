import Link from "next/link";
import type { SpecProjectDetailSnapshot } from "@/lib/admin/spec-types";
import { ProjectHeader } from "./ProjectHeader";
import { OverviewTab } from "./OverviewTab";
import { TimelineTab } from "./TimelineTab";
import { IntakeTab } from "./IntakeTab";
import { ScopeTab } from "./ScopeTab";
import { MilestonesTab } from "./MilestonesTab";
import { DeferredTab } from "./DeferredTab";

interface ProjectDetailProps {
  snapshot: SpecProjectDetailSnapshot;
  activeTab: TabKey;
}

export type TabKey =
  | "overview"
  | "timeline"
  | "intake"
  | "scope"
  | "milestones"
  | "change_orders"
  | "satisfaction"
  | "tickets"
  | "comms"
  | "entitlements"
  | "notes";

interface TabDef {
  key: TabKey;
  label: string;
  deferred: boolean;
}

const TABS: TabDef[] = [
  { key: "overview", label: "OVERVIEW", deferred: false },
  { key: "timeline", label: "TIMELINE", deferred: false },
  { key: "intake", label: "INTAKE", deferred: false },
  { key: "scope", label: "SCOPE DOC", deferred: false },
  { key: "milestones", label: "MILESTONES", deferred: false },
  { key: "change_orders", label: "CHANGE ORDERS", deferred: true },
  { key: "satisfaction", label: "SATISFACTION", deferred: true },
  { key: "tickets", label: "TICKETS", deferred: true },
  { key: "comms", label: "COMMS", deferred: true },
  { key: "entitlements", label: "ENTITLEMENTS", deferred: true },
  { key: "notes", label: "NOTES", deferred: true },
];

export function ProjectDetail({ snapshot, activeTab }: ProjectDetailProps) {
  return (
    <div className="flex min-h-screen flex-col bg-black">
      <ProjectHeader header={snapshot.header} />
      <TabStrip activeTab={activeTab} projectId={snapshot.header.id} />
      <div className="flex-1 px-8 py-8">
        {activeTab === "overview" && <OverviewTab data={snapshot.overview} header={snapshot.header} />}
        {activeTab === "timeline" && <TimelineTab events={snapshot.timeline} />}
        {activeTab === "intake" && <IntakeTab data={snapshot.intake} />}
        {activeTab === "scope" && <ScopeTab data={snapshot.scope} projectId={snapshot.header.id} />}
        {activeTab === "milestones" && (
          <MilestonesTab data={snapshot.milestones} projectId={snapshot.header.id} />
        )}
        {activeTab === "change_orders" && (
          <DeferredTab label="CHANGE ORDERS" rationale="Ships in sub-chip F.2.b — change orders proposal, customer-acceptance link, polish-budget tracking." />
        )}
        {activeTab === "satisfaction" && (
          <DeferredTab label="SATISFACTION" rationale="Ships in sub-chip F.2.b — per-feature midpoint/delivery ratings, heat-map render." />
        )}
        {activeTab === "tickets" && (
          <DeferredTab label="TICKETS" rationale="Ships in sub-chip F.2.b — open ticket triage, severity reclass, escalate-to-change-order." />
        )}
        {activeTab === "comms" && (
          <DeferredTab label="COMMS" rationale="Ships in sub-chip F.2.b — inbound/outbound email log, manual call/video entries, template send." />
        )}
        {activeTab === "entitlements" && (
          <DeferredTab label="ENTITLEMENTS" rationale="Ships in sub-chip F.2.b — module on/off toggles with reason codes, used in dispute/refund/non-payment flows." />
        )}
        {activeTab === "notes" && (
          <DeferredTab label="NOTES" rationale="Ships in sub-chip F.2.b — internal markdown notes with timestamped revisions." />
        )}
      </div>
    </div>
  );
}

function TabStrip({ activeTab, projectId }: { activeTab: TabKey; projectId: string }) {
  return (
    <nav
      aria-label="Project tabs"
      className="sticky top-0 z-10 overflow-x-auto border-b border-white/[0.08] bg-black/90 backdrop-blur-[28px]"
    >
      <ul className="flex min-w-max items-stretch px-8">
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          const href = `/admin/spec/${projectId}${tab.key === "overview" ? "" : `?tab=${tab.key}`}`;
          return (
            <li key={tab.key} className="flex">
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "group relative flex items-center gap-2 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  isActive
                    ? "text-[#EDEDED]"
                    : tab.deferred
                      ? "text-[#6A6A6A] hover:text-[#8A8A8A]"
                      : "text-[#8A8A8A] hover:text-[#EDEDED]",
                ].join(" ")}
              >
                <span>{tab.label}</span>
                {tab.deferred && (
                  <span
                    aria-label="deferred to F.2.b"
                    title="Ships in F.2.b"
                    className="rounded-[3px] border border-white/[0.10] px-1 py-px text-[9px] uppercase tracking-[0.18em] text-[#6A6A6A]"
                  >
                    F.2.b
                  </span>
                )}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-3 -bottom-px h-px bg-[#6F94B0]"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
