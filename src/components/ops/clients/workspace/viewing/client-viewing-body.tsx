"use client";

import * as React from "react";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { Client } from "@/lib/types/models";
import {
  ClientViewingTabs,
  type ClientViewingTabId,
} from "./client-viewing-tabs";
import { ContactTab } from "./contact-tab";
import { ProjectsTab } from "./projects-tab";
import { MoneyTab } from "./money-tab";
import { ActivityTab } from "./activity-tab";

// `ClientViewingBody` — the Direction-B tabbed dossier. Owns the active tab
// (CONTACT / PROJECTS / MONEY / ACTIVITY); the tab strip pins to the top of
// the shell's scroll region while the active tab body scrolls beneath it.
// MONEY is disabled when the operator lacks invoices.view (no empty tab).

export function ClientViewingBody({
  client,
  clientId,
}: {
  client: Client;
  clientId: string;
}) {
  const { t } = useDictionary("clients");
  const canViewInvoices = usePermissionStore((s) => s.can("invoices.view"));
  const [tab, setTab] = React.useState<ClientViewingTabId>("contact");

  const tabs = React.useMemo(
    () => [
      { id: "contact" as const, label: t("window.tab.contact") },
      { id: "projects" as const, label: t("window.tab.projects") },
      { id: "money" as const, label: t("window.tab.money"), disabled: !canViewInvoices },
      { id: "activity" as const, label: t("window.tab.activity") },
    ],
    [t, canViewInvoices],
  );

  // Own the scroll (matches the project viewing body): the body is a full-
  // height flex column — the tab strip is a fixed, non-scrolling child, and
  // the active tab is the single scroller beneath it. This replaces the old
  // `sticky top-0` hack, which depended on the shell slot being the scroller
  // and left each tab's own overflow ambiguous.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ClientViewingTabs tabs={tabs} activeId={tab} onChange={setTab} />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        {tab === "contact" && <ContactTab client={client} clientId={clientId} />}
        {tab === "projects" && <ProjectsTab clientId={clientId} />}
        {tab === "money" && canViewInvoices && <MoneyTab clientId={clientId} />}
        {tab === "activity" && <ActivityTab clientId={clientId} />}
      </div>
    </div>
  );
}
