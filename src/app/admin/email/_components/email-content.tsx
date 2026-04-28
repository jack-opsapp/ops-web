"use client";

import { SubTabs } from "../../_components/sub-tabs";
import { OverviewTab } from "./overview-tab";
import { FunnelsTab } from "./funnels-tab";
import { EmailLogTab } from "./email-log-tab";
import { NewsletterTab } from "./newsletter-tab";
import { TriggersTab } from "./triggers-tab";
import { ScheduleTab } from "./schedule-tab";
import { ScheduledSendsTab } from "./scheduled-sends-tab";
import { KillswitchesTab } from "./killswitches-tab";
import { ActivePauseBanner } from "./active-pause-banner";
import { TemplatesTab } from "./templates-tab";
import { AudienceBuilderTab } from "./audience-builder-tab";
import { SuppressionsTab } from "./suppressions-tab";
import { CampaignAnalyticsTab } from "@/components/admin/email/campaign-analytics-tab";
import { EventMonitorTab } from "./event-monitor-tab";
import type {
  EmailOverviewStats,
  EmailEngagementStats,
  EmailFunnelData,
  EmailLogRow,
  NewsletterContent,
} from "@/lib/admin/types";

interface EmailContentProps {
  overview: EmailOverviewStats;
  engagement: EmailEngagementStats;
  funnels: EmailFunnelData;
  emailLog: EmailLogRow[];
  newsletters: NewsletterContent[];
}

export function EmailContent({ overview, engagement, funnels, emailLog, newsletters }: EmailContentProps) {
  return (
    <>
      <ActivePauseBanner />
      <SubTabs
        tabs={[
          "Overview",
          "Event Monitor",
          "Campaign Analytics",
          "Scheduled Sends",
          "Audience",
          "Suppressions",
          "Funnels",
          "Email Log",
          "Newsletter",
          "Templates",
          "Lifecycle",
          "Triggers",
          "Killswitches",
        ]}
      >
        {(tab) => {
          if (tab === "Overview") return <OverviewTab stats={overview} engagement={engagement} />;
          if (tab === "Event Monitor") return <EventMonitorTab />;
          if (tab === "Campaign Analytics") return <CampaignAnalyticsTab />;
          if (tab === "Scheduled Sends") return <ScheduledSendsTab />;
          if (tab === "Audience") return <AudienceBuilderTab />;
          if (tab === "Suppressions") return <SuppressionsTab />;
          if (tab === "Funnels") return <FunnelsTab data={funnels} />;
          if (tab === "Email Log") return <EmailLogTab entries={emailLog} />;
          if (tab === "Newsletter") return <NewsletterTab newsletters={newsletters} />;
          if (tab === "Templates") return <TemplatesTab />;
          if (tab === "Lifecycle") return <ScheduleTab />;
          if (tab === "Triggers") return <TriggersTab />;
          if (tab === "Killswitches") return <KillswitchesTab />;
          return null;
        }}
      </SubTabs>
    </>
  );
}
