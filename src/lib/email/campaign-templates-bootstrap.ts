/**
 * Wires the four PR β / PR 3 marketing senders into the campaign template
 * registry. Bootstrap is idempotent — safe to call from every cron tick
 * since worker entry points run cold.
 *
 * NOTE: senders live in `./sendgrid` (the .tsx chokepoint), not `./senders`
 * — `./senders.ts` only exposes the four sender-identity buckets (DISPATCH,
 * GATE, FIELD_NOTES, portalSender).
 */
import { registerCampaignTemplate } from "./campaign-templates";
import {
  sendProductUpdate,
  sendTrialExpiryWarning,
  sendFeatureAnnouncement,
  sendReengagement,
} from "./sendgrid";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";

let booted = false;
export function bootstrapCampaignTemplates(): void {
  if (booted) return;

  registerCampaignTemplate({
    id: "product_update",
    label: "Product update",
    description: "Periodic product news to active subscribers and trials.",
    sender: async (ctx) => {
      const p = ctx.payload as Record<string, unknown>;
      const items = Array.isArray(p.items)
        ? (p.items as Array<{ title: string; body: string }>)
        : [];
      return sendProductUpdate({
        email: ctx.recipientEmail,
        userId: ctx.recipientUserId,
        campaignId: ctx.campaignId,
        firstName: typeof p.firstName === "string" ? p.firstName : null,
        headline: typeof p.headline === "string" ? p.headline : undefined,
        eyebrow: typeof p.eyebrow === "string" ? p.eyebrow : undefined,
        intro:
          typeof p.intro === "string"
            ? p.intro
            : "A few small changes shipped this week.",
        items: items.length > 0 ? items : [
          {
            title: "OPS just got faster",
            body: "Faster project lookup, faster pipeline triage, faster crew dispatch.",
          },
        ],
        closing: typeof p.closing === "string" ? p.closing : undefined,
        ctaLabel: typeof p.ctaLabel === "string" ? p.ctaLabel : undefined,
        ctaUrl: typeof p.ctaUrl === "string" ? p.ctaUrl : APP_URL,
        subject: typeof p.subject === "string" ? p.subject : undefined,
      });
    },
  });

  registerCampaignTemplate({
    id: "trial_expiry_campaign",
    label: "Trial expiry warning",
    description: "Trial expiry urgency campaign — points users at billing.",
    sender: async (ctx) => {
      const p = ctx.payload as Record<string, unknown>;
      return sendTrialExpiryWarning({
        email: ctx.recipientEmail,
        userId: ctx.recipientUserId,
        campaignId: ctx.campaignId,
        companyName: typeof p.companyName === "string" ? p.companyName : "your team",
        daysRemaining: typeof p.daysRemaining === "number" ? p.daysRemaining : 3,
        trialEndDisplay: typeof p.trialEndDisplay === "string" ? p.trialEndDisplay : "soon",
        subscribeUrl:
          typeof p.subscribeUrl === "string"
            ? p.subscribeUrl
            : `${APP_URL}/settings/billing`,
      });
    },
  });

  registerCampaignTemplate({
    id: "feature_announcement",
    label: "Feature announcement",
    description: "Major feature ship announcement.",
    sender: async (ctx) => {
      const p = ctx.payload as Record<string, unknown>;
      const featureName =
        typeof p.featureName === "string" ? p.featureName : "A new feature";
      return sendFeatureAnnouncement({
        email: ctx.recipientEmail,
        userId: ctx.recipientUserId,
        campaignId: ctx.campaignId,
        firstName: typeof p.firstName === "string" ? p.firstName : null,
        featureName,
        headline:
          typeof p.headline === "string"
            ? p.headline
            : `${featureName} just shipped.`,
        whatItDoes:
          typeof p.whatItDoes === "string"
            ? p.whatItDoes
            : `${featureName} is live in OPS today.`,
        whyItMatters:
          typeof p.whyItMatters === "string"
            ? p.whyItMatters
            : "Built to take one more piece of busywork off your plate.",
        howToFindIt:
          typeof p.howToFindIt === "string" ? p.howToFindIt : undefined,
        ctaUrl: typeof p.ctaUrl === "string" ? p.ctaUrl : APP_URL,
        ctaLabel: typeof p.ctaLabel === "string" ? p.ctaLabel : undefined,
        subject: typeof p.subject === "string" ? p.subject : undefined,
      });
    },
  });

  registerCampaignTemplate({
    id: "reengagement",
    label: "Reengagement",
    description: "Win-back for dormant users (not trial-specific).",
    sender: async (ctx) => {
      const p = ctx.payload as Record<string, unknown>;
      return sendReengagement({
        email: ctx.recipientEmail,
        userId: ctx.recipientUserId,
        campaignId: ctx.campaignId,
        firstName: typeof p.firstName === "string" ? p.firstName : null,
        headline: typeof p.headline === "string" ? p.headline : undefined,
        eyebrow: typeof p.eyebrow === "string" ? p.eyebrow : undefined,
        daysSinceActive:
          typeof p.daysSinceActive === "number" ? p.daysSinceActive : undefined,
        opener: typeof p.opener === "string" ? p.opener : undefined,
        body: typeof p.body === "string" ? p.body : undefined,
        closing: typeof p.closing === "string" ? p.closing : undefined,
        ctaLabel: typeof p.ctaLabel === "string" ? p.ctaLabel : undefined,
        ctaUrl: typeof p.ctaUrl === "string" ? p.ctaUrl : APP_URL,
        subject: typeof p.subject === "string" ? p.subject : undefined,
      });
    },
  });

  booted = true;
}

/** Test helper. Resets the booted flag so reset+rebootstrap works. */
export function __resetCampaignTemplatesBootstrap(): void {
  booted = false;
}
