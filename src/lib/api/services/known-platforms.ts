// src/lib/api/services/known-platforms.ts
// Registry of known form notification senders, bid platforms, CRM/lead gen, and review sources

export interface PlatformMatch {
  category: 'website_form' | 'bid_platform' | 'crm_lead_gen' | 'review';
  platformName: string;
}

// Domain-based matching (sender domain contains or equals)
const PLATFORM_DOMAINS: Record<string, PlatformMatch> = {
  // Website form builders
  'wix-forms.com': { category: 'website_form', platformName: 'Wix' },
  'wix.com': { category: 'website_form', platformName: 'Wix' },
  'wordpress.com': { category: 'website_form', platformName: 'WordPress' },
  'squarespace.com': { category: 'website_form', platformName: 'Squarespace' },
  'jotform.com': { category: 'website_form', platformName: 'Jotform' },
  'typeform.com': { category: 'website_form', platformName: 'Typeform' },
  '123formbuilder.com': { category: 'website_form', platformName: '123FormBuilder' },
  'gravity.com': { category: 'website_form', platformName: 'Gravity Forms' },
  'wpforms.com': { category: 'website_form', platformName: 'WPForms' },
  'formstack.com': { category: 'website_form', platformName: 'Formstack' },

  // Bid/construction platforms
  'smartbidnet.com': { category: 'bid_platform', platformName: 'SmartBidNet' },
  'procore.com': { category: 'bid_platform', platformName: 'Procore' },
  'buildertrend.com': { category: 'bid_platform', platformName: 'BuilderTrend' },
  'plangrid.com': { category: 'bid_platform', platformName: 'PlanGrid' },
  'buildingconnected.com': { category: 'bid_platform', platformName: 'BuildingConnected' },
  'constructconnect.com': { category: 'bid_platform', platformName: 'ConstructConnect' },
  'isqft.com': { category: 'bid_platform', platformName: 'iSqFt' },

  // CRM / lead generation
  'hubspot.com': { category: 'crm_lead_gen', platformName: 'HubSpot' },
  'salesforce.com': { category: 'crm_lead_gen', platformName: 'Salesforce' },
  'thumbtack.com': { category: 'crm_lead_gen', platformName: 'Thumbtack' },
  'homeadvisor.com': { category: 'crm_lead_gen', platformName: 'HomeAdvisor' },
  'houzz.com': { category: 'crm_lead_gen', platformName: 'Houzz' },
  'bark.com': { category: 'crm_lead_gen', platformName: 'Bark' },
  'angi.com': { category: 'crm_lead_gen', platformName: 'Angi' },
  'homestars.com': { category: 'crm_lead_gen', platformName: 'HomeStars' },

  // Review platforms
  'businessprofile-noreply@google.com': { category: 'review', platformName: 'Google Business' },
};

// Subject patterns for forwarded form submissions
const FORM_SUBJECT_PATTERNS = [
  'got a new submission',
  'new form entry',
  'new contact form',
  'new submission',
  'form submission',
  'new inquiry',
  'new lead',
  'contact us form',
  'quote request',
  'free quote form',
];

/**
 * Check if a sender domain matches a known platform
 */
export function matchPlatform(senderEmail: string): PlatformMatch | null {
  const domain = senderEmail.split('@')[1]?.toLowerCase();
  if (!domain) return null;

  // Exact domain match
  if (PLATFORM_DOMAINS[domain]) return PLATFORM_DOMAINS[domain];

  // Check if sender is a subdomain of a known platform
  for (const [platformDomain, match] of Object.entries(PLATFORM_DOMAINS)) {
    if (domain.endsWith(`.${platformDomain}`) || domain === platformDomain) {
      return match;
    }
  }

  // Check full email for specific address matches (e.g., Google Business)
  const fullEmail = senderEmail.toLowerCase();
  if (PLATFORM_DOMAINS[fullEmail]) return PLATFORM_DOMAINS[fullEmail];

  return null;
}

/**
 * Check if a subject line indicates a forwarded form submission
 */
export function isFormSubmissionSubject(subject: string): boolean {
  const lower = subject.toLowerCase();
  return FORM_SUBJECT_PATTERNS.some((pattern) => lower.includes(pattern));
}

export { FORM_SUBJECT_PATTERNS, PLATFORM_DOMAINS };
