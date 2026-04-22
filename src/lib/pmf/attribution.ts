import type { AttributionChannel } from './types';

export interface AttributionInput {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  landing_url?: string | null;
  referrer?: string | null;
}

export function deriveAttributionChannel(input: AttributionInput): AttributionChannel {
  const src = (input.utm_source ?? '').toLowerCase();
  const med = (input.utm_medium ?? '').toLowerCase();

  if (input.gclid) return 'google_ads';
  if (input.fbclid) return 'meta_ads';
  if (src.includes('google')) return 'google_ads';
  if (src.includes('facebook') || src.includes('meta') || src.includes('instagram')) return 'meta_ads';
  if (src === 'apple_search_ads' || src === 'asa') return 'apple_search_ads';
  if (med === 'organic' || med === 'search') return 'organic';
  if (med === 'referral' || src === 'referral') return 'referral';
  if (!src && !med && !input.landing_url && !input.referrer) return 'direct';
  if (!src && !med) return 'direct';
  return 'unknown';
}
