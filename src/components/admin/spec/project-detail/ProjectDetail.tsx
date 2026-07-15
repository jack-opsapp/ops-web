import Link from "next/link";
import type { SpecProjectDetailSnapshot } from "@/lib/admin/spec-types";
import { ProjectHeader } from "./ProjectHeader";
import { OverviewTab } from "./OverviewTab";
import { TimelineTab } from "./TimelineTab";
import { IntakeTab } from "./IntakeTab";
import { ScopeTab } from "./ScopeTab";
import { MilestonesTab } from "./MilestonesTab";
import { ChangeOrdersTab } from "./ChangeOrdersTab";
import { SatisfactionTab } from "./SatisfactionTab";
import { TicketsTab } from "./TicketsTab";
import { CommunicationsTab } from "./CommunicationsTab";
import { EntitlementsTab } from "./EntitlementsTab";
import { NotesTab } from "./NotesTab";

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
  { key: "change_orders", label: "CHANGE ORDERS", deferred: false },
  { key: "satisfaction", label: "SATISFACTION", deferred: false },
  { key: "tickets", label: "TICKETS", deferred: false },
  { key: "comms", label: "COMMS", deferred: false },
  { key: "entitlements", label: "ENTITLEMENTS", deferred: false },
  { key: "notes", label: "NOTES", deferred: false },
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
          <ChangeOrdersTab data={snapshot.changeOrders} projectId={snapshot.header.id} />
        )}
        {activeTab === "satisfaction" && <SatisfactionTab data={snapshot.satisfaction} />}
        {activeTab === "tickets" && (
          <TicketsTab data={snapshot.tickets} projectId={snapshot.header.id} />
        )}
        {activeTab === "comms" && (
          <CommunicationsTab data={snapshot.communications} projectId={snapshot.header.id} />
        )}
        {activeTab === "entitlements" && (
          <EntitlementsTab data={snapshot.entitlements} projectId={snapshot.header.id} />
        )}
        {activeTab === "notes" && <NotesTab data={snapshot.notes} projectId={snapshot.header.id} />}
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
                  "group relative flex items-center gap-2 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors duration-150 ease-smooth",
                  isActive ? "text-text" : "text-text-3 hover:text-text",
                ].join(" ")}
              >
                <span>{tab.label}</span>
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-3 -bottom-px h-px bg-text"
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
