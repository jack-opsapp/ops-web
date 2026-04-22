import { describe, it, expect } from 'vitest';
import { deriveAttributionChannel } from '@/lib/pmf/attribution';

describe('deriveAttributionChannel', () => {
  it('google_ads when gclid present', () => {
    expect(deriveAttributionChannel({ gclid: 'abc' })).toBe('google_ads');
  });
  it('google_ads when utm_source contains google', () => {
    expect(deriveAttributionChannel({ utm_source: 'google_cpc' })).toBe('google_ads');
  });
  it('meta_ads when fbclid present', () => {
    expect(deriveAttributionChannel({ fbclid: 'xyz' })).toBe('meta_ads');
  });
  it('meta_ads when utm_source facebook', () => {
    expect(deriveAttributionChannel({ utm_source: 'facebook' })).toBe('meta_ads');
  });
  it('apple_search_ads on explicit match', () => {
    expect(deriveAttributionChannel({ utm_source: 'apple_search_ads' })).toBe('apple_search_ads');
  });
  it('organic when medium=organic', () => {
    expect(deriveAttributionChannel({ utm_medium: 'organic' })).toBe('organic');
  });
  it('direct when nothing set', () => {
    expect(deriveAttributionChannel({})).toBe('direct');
  });
  it('gclid takes precedence over ambiguous utm_source', () => {
    expect(deriveAttributionChannel({ gclid: 'abc', utm_source: 'newsletter' })).toBe('google_ads');
  });
});
