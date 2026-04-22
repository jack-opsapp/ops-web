import { z } from 'zod';

export const ProspectSourceSchema = z.enum([
  'outbound_cold','warm_network','paid_ad','organic_search','referral','direct',
]);

export const DealTypeSchema = z.enum(['tier_a','base_saas']);

export const DealStageSchema = z.enum([
  'contacted','qualified','proposal','negotiation',
  'signed','in_delivery','delivered','closed_won','closed_lost',
]);

export const AdChannelSchema = z.enum(['google_ads','meta_ads','apple_search_ads','other']);

export const AttributionChannelSchema = z.enum([
  'google_ads','meta_ads','apple_search_ads','organic','direct','referral','unknown',
]);

export const ProspectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  company: z.string().max(200).optional(),
  email: z.string().email().optional().or(z.literal('')).transform(v => v || undefined),
  phone: z.string().max(50).optional(),
  source: ProspectSourceSchema,
  referred_by_company_id: z.string().uuid().optional(),
  deal_type: DealTypeSchema,
  first_contact_at: z.string().datetime(),
  first_contact_direction: z.enum(['inbound','outbound']),
  notes: z.string().max(5000).optional(),
});

export const ProspectUpdateSchema = ProspectCreateSchema.partial();

export const DealUpdateSchema = z.object({
  stage: DealStageSchema.optional(),
  sow_signed_at: z.string().datetime().nullable().optional(),
  sow_url: z.string().url().nullable().optional(),
  implementation_fee_cents: z.number().int().nonnegative().nullable().optional(),
  deposit_paid_at: z.string().datetime().nullable().optional(),
  deposit_amount_cents: z.number().int().nonnegative().nullable().optional(),
  final_paid_at: z.string().datetime().nullable().optional(),
  delivered_at: z.string().datetime().nullable().optional(),
  closed_at: z.string().datetime().nullable().optional(),
  closed_reason: z.string().max(2000).nullable().optional(),
});

export const AdSpendEntrySchema = z.object({
  channel: AdChannelSchema,
  month: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM format required'),
  spend_cents: z.number().int().nonnegative(),
  impressions: z.number().int().nonnegative().optional(),
  clicks: z.number().int().nonnegative().optional(),
  downloads: z.number().int().nonnegative().optional(),
});

export const TrialAttributionInsertSchema = z.object({
  company_id: z.string().uuid(),
  utm_source: z.string().max(200).optional(),
  utm_medium: z.string().max(200).optional(),
  utm_campaign: z.string().max(200).optional(),
  utm_content: z.string().max(200).optional(),
  utm_term: z.string().max(200).optional(),
  gclid: z.string().max(500).optional(),
  fbclid: z.string().max(500).optional(),
  landing_url: z.string().url().optional(),
  trial_started_at: z.string().datetime(),
});
