"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ChevronRight, Mail, ArrowUpRight } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetMoreButton } from "./shared/widget-more-button";
import { WidgetInlineAction } from "./shared/widget-inline-action";
import { WidgetTooltip, TooltipRow } from "./shared/widget-tooltip";
import { showWidgetActionToast } from "./shared/widget-action-toast";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WIDGET_EASE_CSS } from "./shared/widget-motion";
import { formatCompactCurrency } from "./shared/widget-utils";
import { showActions } from "@/lib/widget-tokens";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import {
  OpportunityStage,
  getStageDisplayName,
  getActiveStages,
  nextOpportunityStage,
  isTerminalStage,
  OPPORTUNITY_STAGE_COLORS,
} from "@/lib/types/pipeline";
import type { Opportunity } from "@/lib/types/pipeline";
import { ActivityType } from "@/lib/types/pipeline";
import { resolveMergeFields } from "@/lib/types/email-template";
import {
  useOpportunities,
  useClientMap,
  useMoveOpportunityStage,
  useCreateActivity,
} from "@/lib/hooks";
import { useEmailConnections } from "@/lib/hooks/use-email-connections";
import { useEmailTemplates } from "@/lib/hooks/use-email-templates";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";
import { useWidgetEntityOpen } from "./shared/use-widget-entity-open";
import { WidgetTitle } from "./shared/widget-title";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PipelineListWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StageFilter =
  | "all-active"
  | "new_lead"
  | "contacted"
  | "qualified"
  | "proposal_sent"
  | "negotiation";

const FILTER_LABEL_KEYS: Record<StageFilter, string> = {
  "all-active": "pipelineList.filterActivePipeline",
  new_lead: "pipelineList.filterNewLeads",
  contacted: "pipelineList.filterContacted",
  qualified: "pipelineList.filterQualified",
  proposal_sent: "pipelineList.filterProposalSent",
  negotiation: "pipelineList.filterNegotiation",
};

function mapFilterToStage(filter: StageFilter): OpportunityStage | null {
  switch (filter) {
    case "new_lead":
      return OpportunityStage.NewLead;
    case "contacted":
      return OpportunityStage.Qualifying;
    case "qualified":
      return OpportunityStage.Quoting;
    case "proposal_sent":
      return OpportunityStage.Quoted;
    case "negotiation":
      return OpportunityStage.Negotiation;
    default:
      return null;
  }
}

function filterOpportunities(
  opportunities: Opportunity[],
  filter: StageFilter
): Opportunity[] {
  const active = opportunities.filter((o) => !o.deletedAt);
  if (filter === "all-active") {
    return active.filter(
      (o) =>
        o.stage !== OpportunityStage.Won && o.stage !== OpportunityStage.Lost
    );
  }
  const stage = mapFilterToStage(filter);
  if (!stage) return active;
  return active.filter((o) => o.stage === stage);
}

function daysInStage(stageEnteredAt: Date | string): number {
  const entered =
    typeof stageEnteredAt === "string"
      ? new Date(stageEnteredAt)
      : stageEnteredAt;
  const now = new Date();
  return Math.floor((now.getTime() - entered.getTime()) / (1000 * 60 * 60 * 24));
}

/** Primary: client/contact name — who is this lead? */
function getOpportunityPrimary(opportunity: Opportunity, unknownLabel: string): string {
  return opportunity.client?.name ?? opportunity.contactName ?? opportunity.title ?? unknownLabel;
}

/** Secondary: opportunity context — what do they want + where in pipeline */
function getOpportunitySecondary(opportunity: Opportunity): string {
  const parts: string[] = [];
  // Clean title: strip "Lead[Name]" prefix artifacts from AI-generated titles
  const clientName = opportunity.client?.name ?? opportunity.contactName ?? "";
  const title = opportunity.title;
  if (title && title !== clientName) {
    // Remove the client name or "Lead" prefix duplications from the title
    let cleanTitle = title;
    if (clientName) {
      // Strip exact client name prefix (e.g., "Jared Lantzmann - Deck Rebuild" → "Deck Rebuild")
      const prefixPattern = new RegExp(`^${clientName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-–—]\\s*`, "i");
      cleanTitle = cleanTitle.replace(prefixPattern, "");
      // Strip "Lead[LastName]" prefix (e.g., "LeadLantzmann Deck Rebuild" → "Deck Rebuild")
      const lastName = clientName.split(/\s+/).pop() ?? "";
      if (lastName && cleanTitle.startsWith(`Lead${lastName}`)) {
        cleanTitle = cleanTitle.slice(`Lead${lastName}`.length).trim();
      }
    }
    if (cleanTitle && cleanTitle !== clientName) {
      parts.push(cleanTitle);
    }
  }
  parts.push(`${getStageDisplayName(opportunity.stage)} · ${daysInStage(opportunity.stageEnteredAt)}d`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Stage Distribution Bar
// ---------------------------------------------------------------------------

function StageDistributionBar({
  opportunities,
  isVisible,
  reducedMotion,
  enableTooltip = false,
}: {
  opportunities: Opportunity[];
  isVisible: boolean;
  reducedMotion: boolean | null;
  enableTooltip?: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    label: string;
    count: number;
    value: number;
  }>({ visible: false, x: 0, y: 0, label: "", count: 0, value: 0 });

  const activeStageList = getActiveStages();
  const active = opportunities.filter(
    (o) => !o.deletedAt && !isTerminalStage(o.stage)
  );
  const total = active.length;
  if (total === 0) return null;

  const segments = activeStageList
    .map((stage) => {
      const stageOpps = active.filter((o) => o.stage === stage);
      return {
        stage,
        count: stageOpps.length,
        value: stageOpps.reduce((sum, o) => sum + (o.estimatedValue ?? 0), 0),
        color: OPPORTUNITY_STAGE_COLORS[stage],
      };
    })
    .filter((s) => s.count > 0);

  const handleSegmentHover = (e: React.MouseEvent, seg: typeof segments[number]) => {
    if (!enableTooltip || !barRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const parentRect = barRef.current.getBoundingClientRect();
    setTip({
      visible: true,
      x: rect.left - parentRect.left + rect.width / 2,
      y: 0,
      label: getStageDisplayName(seg.stage),
      count: seg.count,
      value: seg.value,
    });
  };

  return (
    <div ref={barRef} className="relative mb-2">
      {enableTooltip && (
        <WidgetTooltip visible={tip.visible} x={tip.x} y={tip.y} anchorRef={barRef} anchor="above">
          <TooltipRow label={tip.label} value={`${tip.count}`} />
          <TooltipRow label="Value" value={formatCompactCurrency(tip.value)} />
        </WidgetTooltip>
      )}
      <div className="flex h-[6px] rounded-sm overflow-hidden">
        {segments.map((seg) => (
          <div
            key={seg.stage}
            className={enableTooltip ? "cursor-pointer" : undefined}
            style={{
              width: isVisible ? `${(seg.count / total) * 100}%` : "0%",
              backgroundColor: seg.color,
              transitionProperty: "width",
              transitionDuration: reducedMotion ? "200ms" : "500ms",
              transitionTimingFunction: WIDGET_EASE_CSS,
            }}
            onMouseEnter={(e) => handleSegmentHover(e, seg)}
            onMouseLeave={() => setTip((prev) => ({ ...prev, visible: false }))}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Actions (Advance + Follow Up)
// ---------------------------------------------------------------------------

function PipelineInlineActions({
  opportunity,
  navigate,
}: {
  opportunity: Opportunity;
  navigate: (path: string) => void;
}) {
  const { t } = useDictionary("dashboard");
  const { currentUser: user, company } = useAuthStore();
  const moveStage = useMoveOpportunityStage();
  const createActivity = useCreateActivity();
  const { data: connections } = useEmailConnections();
  const { data: templates } = useEmailTemplates();
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [sending, setSending] = useState(false);

  const activeConnection = connections?.find((c) => c.status === "active");
  const followUpTemplate = templates?.find(
    (tmpl) => tmpl.category === "follow_up" && tmpl.isActive
  );

  const nextStage = nextOpportunityStage(opportunity.stage);
  const canAdvance = nextStage && !isTerminalStage(nextStage);
  const hasEmail = !!opportunity.contactEmail;

  const handleAdvance = useCallback(() => {
    if (!nextStage || !canAdvance) return;
    const previousStage = opportunity.stage;
    moveStage.mutate({
      id: opportunity.id,
      stage: nextStage,
      userId: user?.id,
    });
    showWidgetActionToast({
      label: `${t("pipelineList.advancedTo") ?? "Advanced to"} ${getStageDisplayName(nextStage)}`,
      undoLabel: t("pipelineList.undo") ?? "Undo",
      onUndo: () => {
        moveStage.mutate({
          id: opportunity.id,
          stage: previousStage,
          userId: user?.id,
        });
      },
    });
  }, [opportunity, nextStage, canAdvance, moveStage, user, t]);

  const sendFollowUp = useCallback(
    async (body: string, subject: string) => {
      if (!activeConnection || !opportunity.contactEmail || !company) return;
      setSending(true);
      try {
        const res = await fetch("/api/integrations/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user?.id,
            companyId: company.id,
            connectionId: activeConnection.id,
            to: [opportunity.contactEmail],
            subject,
            body,
            format: "markdown",
            opportunityId: opportunity.id,
          }),
        });
        if (!res.ok) throw new Error("Send failed");

        const recipientName =
          opportunity.contactName ?? opportunity.client?.name ?? opportunity.contactEmail;
        showWidgetActionToast({
          label: `${t("pipelineList.followUpSent") ?? "Follow-up sent to"} ${recipientName}`,
          undoLabel: t("pipelineList.undo") ?? "Undo",
          onUndo: () => {
            createActivity.mutate({
              companyId: company.id,
              opportunityId: opportunity.id,
              clientId: opportunity.clientId,
              estimateId: null,
              invoiceId: null,
              type: ActivityType.Note,
              subject: t("pipelineList.followUpUndoSubject") ?? "Follow-up undo",
              content:
                t("pipelineList.sentInError") ??
                "Follow-up sent in error (undone from dashboard)",
              outcome: null,
              direction: null,
              durationMinutes: null,
              createdBy: user?.id ?? null,
            });
          },
        });
      } catch {
        toast.error(t("pipelineList.sendFailed") ?? "Failed to send follow-up");
      } finally {
        setSending(false);
        setComposeOpen(false);
        setComposeText("");
      }
    },
    [activeConnection, opportunity, company, user, createActivity, t]
  );

  const handleFollowUp = useCallback(() => {
    if (!activeConnection) {
      toast(
        t("pipelineList.noConnection") ??
          "Connect your email in Settings to send follow-ups",
        {
          action: {
            label: t("pipelineList.settings") ?? "Settings",
            onClick: () => navigate("/settings/email"),
          },
        }
      );
      return;
    }
    if (followUpTemplate) {
      const ctx = {
        clientName: opportunity.contactName ?? opportunity.client?.name,
        projectTitle: opportunity.title,
        companyName: company?.name,
      };
      const resolvedBody = resolveMergeFields(followUpTemplate.body, ctx);
      const resolvedSubject = resolveMergeFields(followUpTemplate.subject, ctx);
      sendFollowUp(resolvedBody, resolvedSubject);
    }
    // Path B (no template) handled by the Popover below
  }, [activeConnection, followUpTemplate, opportunity, company, sendFollowUp, navigate, t]);

  return (
    <div className="flex items-center gap-0.5">
      {canAdvance && (
        <WidgetInlineAction
          icon={ChevronRight}
          label={t("pipelineList.advance") ?? "Advance"}
          onAction={handleAdvance}
        />
      )}
      {hasEmail && activeConnection && !followUpTemplate ? (
        // Path B: inline compose popover (no template available)
        <Popover open={composeOpen} onOpenChange={setComposeOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="w-[20px] h-[20px] flex items-center justify-center rounded-sm hover:bg-surface-hover transition-colors text-text-mute hover:text-text-2"
              title={t("pipelineList.followUp") ?? "Follow Up"}
              aria-label={t("pipelineList.followUp") ?? "Follow Up"}
            >
              <Mail className="w-[14px] h-[14px]" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[260px] p-2">
            <textarea
              className="w-full bg-transparent border border-border-subtle rounded-sm p-1.5 font-mohave text-caption-sm text-text resize-none focus:outline-none focus:border-[rgba(255,255,255,0.20)]/50"
              rows={3}
              placeholder={
                t("pipelineList.composePlaceholder") ??
                "Quick follow-up message..."
              }
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
            />
            <div className="flex items-center justify-between mt-1">
              <span className="font-mono text-micro text-text-mute">
                {t("pipelineList.mergeHint") ??
                  "Use {{client_name}}, {{project_title}}"}
              </span>
              <button
                onClick={() => {
                  if (!composeText.trim()) return;
                  const ctx = {
                    clientName:
                      opportunity.contactName ?? opportunity.client?.name,
                    projectTitle: opportunity.title,
                    companyName: company?.name,
                  };
                  sendFollowUp(
                    resolveMergeFields(composeText, ctx),
                    `${t("pipelineList.followUpSubjectPrefix") ?? "Follow up"}: ${opportunity.title || (t("pipelineList.defaultProjectTitle") ?? "Your project")}`
                  );
                }}
                disabled={!composeText.trim() || sending}
                className={cn(
                  "font-mono text-micro uppercase tracking-[0.16em] px-2 py-[2px] rounded-sm transition-colors",
                  composeText.trim() && !sending
                    ? "text-text hover:bg-surface-hover"
                    : "text-text-mute cursor-not-allowed"
                )}
              >
                {sending ? "..." : (t("pipelineList.send") ?? "Send")}
              </button>
            </div>
          </PopoverContent>
        </Popover>
      ) : hasEmail ? (
        // Path A (template exists) or Path C (no connection) — single action
        <WidgetInlineAction
          icon={Mail}
          label={t("pipelineList.followUp") ?? "Follow Up"}
          onAction={handleFollowUp}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PipelineListWidget({ size, config }: PipelineListWidgetProps) {
  const { t } = useDictionary("dashboard");
  const router = useRouter();
  const navigate = (path: string) => router.push(path);
  const openEntity = useWidgetEntityOpen();
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();

  const filter = (config.stageFilter as StageFilter) ?? "all-active";
  const { data: rawOpportunities, isLoading } = useOpportunities();
  const clientMap = useClientMap();

  const filtered = useMemo(() => {
    if (!rawOpportunities) return [];
    const enriched = rawOpportunities.map((opp) => {
      if (opp.client?.name) return opp;
      const c = opp.clientId ? clientMap.get(opp.clientId) : undefined;
      return c ? { ...opp, client: c as Opportunity["client"] } : opp;
    });
    return filterOpportunities(enriched, filter);
  }, [rawOpportunities, filter, clientMap]);

  const totalValue = useMemo(
    () => filtered.reduce((sum, o) => sum + (o.estimatedValue ?? 0), 0),
    [filtered]
  );

  const [showAllItems, setShowAllItems] = useState(false);

  // ── SM: Hero + distribution bar + value ─────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none text-text">
              {isLoading ? "—" : filtered.length}
            </span>
            <button
              onClick={() => navigate("/pipeline")}
              className="p-0.5 rounded-sm text-text-mute hover:text-text-2 hover:bg-surface-hover transition-colors"
            >
              <ArrowUpRight className="w-[14px] h-[14px]" />
            </button>
          </div>
          <WidgetTitle className="mt-1">
            {t(FILTER_LABEL_KEYS[filter])}
          </WidgetTitle>
          {!isLoading && rawOpportunities && (
            <StageDistributionBar
              opportunities={rawOpportunities}
              isVisible={isVisible}
              reducedMotion={reducedMotion}
            />
          )}
          {!isLoading && (
            <span className="font-mono text-micro text-text-3 mt-0.5">
              {formatCompactCurrency(totalValue)}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── LG: Grouped by stage ───────────────────────────────────────────────
  if (size === "lg") {
    const activeStageList = getActiveStages();
    const grouped = activeStageList
      .map((stage) => ({
        stage,
        label: getStageDisplayName(stage),
        color: OPPORTUNITY_STAGE_COLORS[stage],
        items: filtered.filter((o) => o.stage === stage),
      }))
      .filter((g) => g.items.length > 0);

    const MAX_VISIBLE = 10;

    // Pre-compute slot allocation per group (safe under concurrent mode)
    const groupSlotAllocation = (() => {
      let remaining = showAllItems ? Infinity : MAX_VISIBLE;
      return grouped.map((group) => {
        const slots = Math.min(group.items.length, remaining);
        remaining -= slots;
        return slots;
      });
    })();

    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3">
          <div className="flex items-center justify-between mb-1">
            <WidgetTitle>
              {t(FILTER_LABEL_KEYS[filter])}
            </WidgetTitle>
            <span className="font-mono text-micro text-text-3">
              {isLoading
                ? "..."
                : `${filtered.length} · ${formatCompactCurrency(totalValue)}`}
            </span>
          </div>
          {!isLoading && rawOpportunities && (
            <StageDistributionBar
              opportunities={rawOpportunities}
              isVisible={isVisible}
              reducedMotion={reducedMotion}
              enableTooltip
            />
          )}
          <ScrollFade>
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-[16px] h-[16px] text-text-mute animate-spin" />
                <span className="font-mono text-micro text-text-mute ml-1">
                  {t("pipelineList.loading")}
                </span>
              </div>
            ) : filtered.length === 0 ? (
              <p className="font-mohave text-body-sm text-text-mute py-2">
                {t("pipelineList.empty")}
              </p>
            ) : (
              <div className="space-y-2">
                {grouped.map((group, gi) => {
                  const slots = groupSlotAllocation[gi];
                  if (slots <= 0) return null;
                  const visibleItems = group.items.slice(0, slots);

                  return (
                    <div key={group.stage}>
                      {/* Stage header */}
                      <div className="flex items-center gap-1 mb-0.5 px-1">
                        <span
                          className="w-[8px] h-[8px] rounded-sm shrink-0"
                          style={{ backgroundColor: group.color }}
                        />
                        <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-2">
                          {group.label}
                        </span>
                        <span className="font-mono text-micro text-text-mute ml-auto">
                          {group.items.length}
                        </span>
                      </div>
                      {/* Items */}
                      {visibleItems.map((opp, i) => (
                        <WidgetLineItem
                          key={opp.id}
                          indicator={{ type: "bar", color: group.color, label: group.label }}
                          primary={getOpportunityPrimary(opp, t("pipelineList.unknown"))}
                          secondary={getOpportunitySecondary(opp)}
                          metric={
                            opp.estimatedValue != null
                              ? formatCompactCurrency(opp.estimatedValue)
                              : undefined
                          }
                          action={
                            <PipelineInlineActions
                              opportunity={opp}
                              navigate={navigate}
                            />
                          }
                          index={i}
                          isVisible={isVisible}
                          reducedMotion={reducedMotion}
                          onClick={(e) => openEntity({
                          entityType: "opportunity",
                          entityId: opp.id,
                          title: getOpportunityPrimary(opp, t("pipelineList.unknown")),
                          color: group.color,
                          event: e,
                          fallbackPath: "/pipeline",
                        })}
                        />
                      ))}
                      {group.items.length > visibleItems.length && (
                        <WidgetMoreButton
                          remaining={group.items.length - visibleItems.length}
                          expanded={showAllItems}
                          onToggle={() => setShowAllItems((prev) => !prev)}
                        />
                      )}
                    </div>
                  );
                })}
                {filtered.length > MAX_VISIBLE && (
                  <WidgetMoreButton
                    remaining={filtered.length - MAX_VISIBLE}
                    expanded={showAllItems}
                    onToggle={() => setShowAllItems((prev) => !prev)}
                  />
                )}
              </div>
            )}
          </ScrollFade>

        </div>
      </Card>
    );
  }

  // ── MD: List of opportunities ──────────────────────────────────────────
  const MAX_MD_ITEMS = 5;
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        <div className="flex items-center justify-between mb-1">
          <WidgetTitle>
            {t(FILTER_LABEL_KEYS[filter])}
          </WidgetTitle>
          <span className="font-mono text-micro text-text-3">
            {isLoading
              ? "..."
              : `${filtered.length} · ${formatCompactCurrency(totalValue)}`}
          </span>
        </div>
        {!isLoading && rawOpportunities && (
          <StageDistributionBar
            opportunities={rawOpportunities}
            isVisible={isVisible}
            reducedMotion={reducedMotion}
            enableTooltip
          />
        )}
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-mute animate-spin" />
            <span className="font-mono text-micro text-text-mute ml-1">
              {t("pipelineList.loading")}
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-mute py-2">
            {t("pipelineList.empty")}
          </p>
        ) : (
          <>
            <ScrollFade>
              {(showAllItems ? filtered : filtered.slice(0, MAX_MD_ITEMS)).map((opp, i) => (
                <WidgetLineItem
                  key={opp.id}
                  indicator={{
                    type: "bar",
                    color: OPPORTUNITY_STAGE_COLORS[opp.stage],
                    label: getStageDisplayName(opp.stage),
                  }}
                  primary={getOpportunityPrimary(opp, t("pipelineList.unknown"))}
                  secondary={getOpportunitySecondary(opp)}
                  metric={
                    opp.estimatedValue != null
                      ? formatCompactCurrency(opp.estimatedValue)
                      : undefined
                  }
                  action={
                    showActions(size) ? (
                      <PipelineInlineActions
                        opportunity={opp}
                        navigate={navigate}
                      />
                    ) : undefined
                  }
                  index={i}
                  isVisible={isVisible}
                  reducedMotion={reducedMotion}
                  onClick={(e) => openEntity({
                    entityType: "opportunity",
                    entityId: opp.id,
                    title: getOpportunityPrimary(opp, t("pipelineList.unknown")),
                    color: OPPORTUNITY_STAGE_COLORS[opp.stage],
                    event: e,
                    fallbackPath: "/pipeline",
                  })}
                />
              ))}
            </ScrollFade>
            {filtered.length > MAX_MD_ITEMS && (
              <WidgetMoreButton
                remaining={filtered.length - MAX_MD_ITEMS}
                expanded={showAllItems}
                onToggle={() => setShowAllItems((prev) => !prev)}
                className="shrink-0"
              />
            )}
          </>
        )}

      </div>
    </Card>
  );
}
