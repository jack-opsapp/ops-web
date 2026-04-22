import { describe, it, expect } from 'vitest';
import {
  ProspectCreateSchema,
  DealStageSchema,
  AdSpendEntrySchema,
  AttributionChannelSchema,
} from '@/lib/pmf/schemas';

describe('ProspectCreateSchema', () => {
  it('accepts minimal valid input', () => {
    const result = ProspectCreateSchema.safeParse({
      name: 'Ada Lovelace',
      source: 'referral',
      deal_type: 'tier_a',
      first_contact_at: '2026-04-21T14:00:00Z',
      first_contact_direction: 'inbound',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown source', () => {
    const result = ProspectCreateSchema.safeParse({
      name: 'X', source: 'spam', deal_type: 'tier_a',
      first_contact_at: '2026-04-21T00:00:00Z',
      first_contact_direction: 'inbound',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = ProspectCreateSchema.safeParse({
      name: '', source: 'referral', deal_type: 'tier_a',
      first_contact_at: '2026-04-21T00:00:00Z',
      first_contact_direction: 'inbound',
    });
    expect(result.success).toBe(false);
  });
});

describe('DealStageSchema', () => {
  it('accepts all valid stages', () => {
    for (const s of ['contacted','qualified','proposal','negotiation','signed','in_delivery','delivered','closed_won','closed_lost']) {
      expect(DealStageSchema.safeParse(s).success).toBe(true);
    }
  });
  it('rejects bogus stages', () => {
    expect(DealStageSchema.safeParse('won').success).toBe(false);
  });
});

describe('AdSpendEntrySchema', () => {
  it('accepts positive cents', () => {
    expect(AdSpendEntrySchema.safeParse({
      channel: 'meta_ads', month: '2026-04', spend_cents: 250000,
    }).success).toBe(true);
  });
  it('rejects negative cents', () => {
    expect(AdSpendEntrySchema.safeParse({
      channel: 'meta_ads', month: '2026-04', spend_cents: -1,
    }).success).toBe(false);
  });
  it('rejects invalid month format', () => {
    expect(AdSpendEntrySchema.safeParse({
      channel: 'meta_ads', month: 'April 2026', spend_cents: 100,
    }).success).toBe(false);
  });
});

describe('AttributionChannelSchema', () => {
  it('includes unknown as valid default', () => {
    expect(AttributionChannelSchema.safeParse('unknown').success).toBe(true);
  });
});
