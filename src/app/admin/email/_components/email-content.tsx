"use client";

import { SubTabs } from "../../_components/sub-tabs";
import { OverviewTab } from "./overview-tab";
import { FunnelsTab } from "./funnels-tab";
import { EmailLogTab } from "./email-log-tab";
import { NewsletterTab } from "./newsletter-tab";
import { TriggersTab } from "./triggers-tab";
import type {
  EmailOverviewStats,
  EmailFunnelData,
  EmailLogRow,
  NewsletterContent,
} from "@/lib/admin/types";

interface EmailContentProps {
  overview: EmailOverviewStats;
  funnels: EmailFunnelData;
  emailLog: EmailLogRow[];
  newsletters: NewsletterContent[];
}

export function EmailContent({ overview, funnels, emailLog, newsletters }: EmailContentProps) {
  return (
    <SubTabs tabs={["Overview", "Funnels", "Email Log", "Newsletter", "Triggers"]}>
      {(tab) => {
        if (tab === "Overview") return <OverviewTab stats={overview} />;
        if (tab === "Funnels") return <FunnelsTab data={funnels} />;
        if (tab === "Email Log") return <EmailLogTab entries={emailLog} />;
        if (tab === "Newsletter") return <NewsletterTab newsletters={newsletters} />;
        if (tab === "Triggers") return <TriggersTab />;
        return null;
      }}
    </SubTabs>
  );
}
