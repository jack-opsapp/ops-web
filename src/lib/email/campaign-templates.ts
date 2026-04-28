/**
 * Campaign template registry. Each entry maps a campaign template_id
 * to a sender function from the PR β template suite. PR 7 replaces
 * with a versioned registry pulled from the email_template_versions table.
 */
import type { GatedSendResult } from "@/lib/email/sendgrid";

export interface CampaignTemplateContext {
  recipientEmail: string;
  recipientUserId: string | null;
  payload: Record<string, unknown>;
  campaignId: string;
}

export type CampaignTemplateSender = (
  ctx: CampaignTemplateContext
) => Promise<GatedSendResult>;

export interface CampaignTemplateMeta {
  id: string;
  label: string;
  description: string;
  sender: CampaignTemplateSender;
}

const REGISTRY: Record<string, CampaignTemplateMeta> = {};

export function registerCampaignTemplate(meta: CampaignTemplateMeta): void {
  REGISTRY[meta.id] = meta;
}

export function getCampaignTemplate(id: string): CampaignTemplateMeta | null {
  return REGISTRY[id] ?? null;
}

export function listCampaignTemplates(): CampaignTemplateMeta[] {
  return Object.values(REGISTRY);
}

/** Test helper. Resets the registry so tests don't leak state. */
export function __resetCampaignTemplatesForTests(): void {
  for (const k of Object.keys(REGISTRY)) delete REGISTRY[k];
}
