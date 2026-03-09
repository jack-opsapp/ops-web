/**
 * OPS Web - Email Classifier (OpenAI GPT-4o-mini)
 *
 * Classifies scanned emails as customer conversations, leads, website inquiries,
 * or noise (automated/marketing/transactional). Used during the email setup wizard
 * scan step to generate tailored filter recommendations per customer.
 *
 * Sends a sample of up to 200 emails in batches of 25 to GPT-4o-mini.
 */

import OpenAI from "openai";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EmailForClassification {
  id: string;
  from: string;
  fromEmail: string;
  domain: string;
  subject: string;
  snippet: string;
}

export type EmailCategory =
  | "customer"
  | "lead"
  | "website_inquiry"
  | "automated"
  | "marketing"
  | "transactional"
  | "internal"
  | "spam";

/** Categories that should be imported into the pipeline */
export const IMPORT_CATEGORIES: EmailCategory[] = [
  "customer",
  "lead",
  "website_inquiry",
];

export interface ClassifiedEmail {
  id: string;
  category: EmailCategory;
  confidence: number;
}

export interface ClassificationResult {
  /** Per-email classification (only for sampled emails) */
  classifications: Map<string, ClassifiedEmail>;
  /** Domains where 100% of sampled emails are noise → recommend blocking */
  recommendedBlockDomains: string[];
  /** Domains with at least one customer/lead email → recommend keeping */
  recommendedKeepDomains: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BATCH_SIZE = 25;
const MAX_SAMPLE = 200;

const SYSTEM_PROMPT = `You classify emails for a trades/service business (construction, landscaping, plumbing, electrical, etc.). Your job is to identify which emails are from real customers, potential leads, or website inquiries — and which are automated noise.

Classify each email into exactly one category:
- "customer": Direct conversation with a customer or client (replies, scheduling, questions about jobs/projects/estimates)
- "lead": New inquiry from a potential customer reaching out for the first time
- "website_inquiry": Form submission from a website platform (Wix, Squarespace, WordPress, GoDaddy, etc.) — these are leads even though the sender is a platform address
- "automated": System notifications, app alerts, software updates, account security, delivery receipts
- "marketing": Newsletters, promotions, sales emails, social media notifications
- "transactional": Vendor invoices, payment confirmations, shipping/order updates, subscription receipts, bank notifications
- "internal": Internal team communications, HR, admin
- "spam": Obvious spam or unsolicited bulk email

IMPORTANT RULES:
- Website form submissions (from addresses like *@customer.wix.com, *@squarespace.info, noreply@wix.com with "New submission" subjects) are "website_inquiry" NOT "automated"
- Emails from real people at real business/personal domains discussing projects, estimates, scheduling → "customer"
- When uncertain between customer and lead, prefer "customer"
- Google/Yelp/HomeAdvisor/Angi review notifications are "marketing" not "lead"
- QuickBooks, Stripe, Square payment notifications from vendors are "transactional"

Respond with valid JSON only.`;

// ─── Sampling ────────────────────────────────────────────────────────────────

/**
 * Select a representative sample of emails for AI classification.
 * Ensures domain diversity: at least 1 email per domain, then proportional fill.
 */
export function sampleEmails(
  emails: EmailForClassification[],
  maxSample = MAX_SAMPLE,
): EmailForClassification[] {
  if (emails.length <= maxSample) return emails;

  // Group by domain
  const byDomain = new Map<string, EmailForClassification[]>();
  for (const email of emails) {
    const list = byDomain.get(email.domain) ?? [];
    list.push(email);
    byDomain.set(email.domain, list);
  }

  const sampled: EmailForClassification[] = [];
  const sampledIds = new Set<string>();

  // First pass: 1 email per domain (ensures diversity)
  for (const [, domainEmails] of byDomain) {
    sampled.push(domainEmails[0]);
    sampledIds.add(domainEmails[0].id);
  }

  // If first pass already exceeds max, trim to max (take from largest domains first)
  if (sampled.length > maxSample) {
    const sorted = Array.from(byDomain.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, maxSample);
    return sorted.map(([, emails]) => emails[0]);
  }

  // Second pass: fill remaining slots proportionally from each domain
  const remaining = maxSample - sampled.length;
  if (remaining > 0) {
    const pool = emails.filter((e) => !sampledIds.has(e.id));
    // Shuffle for randomness
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    sampled.push(...pool.slice(0, remaining));
  }

  return sampled;
}

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Classify a batch of emails using GPT-4o-mini.
 */
async function classifyBatch(
  openai: OpenAI,
  emails: EmailForClassification[],
): Promise<Array<{ index: number; category: EmailCategory; confidence: number }>> {
  const emailList = emails
    .map(
      (e, i) =>
        `[${i}] From: ${e.fromEmail} | Subject: ${e.subject} | Body: ${(e.snippet || "").slice(0, 300)}`,
    )
    .join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Classify these ${emails.length} emails. Respond with JSON: { "results": [{ "index": 0, "category": "customer", "confidence": 0.95 }, ...] }\n\n${emailList}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content) as {
      results: Array<{ index: number; category: EmailCategory; confidence: number }>;
    };

    return parsed.results ?? [];
  } catch (err) {
    console.error("[email-classifier] Batch classification failed:", err);
    return [];
  }
}

/**
 * Classify emails and generate recommended filters.
 *
 * @param emails - All scanned emails (up to 500)
 * @returns Classifications for sampled emails + recommended domain blocks/keeps
 */
export async function classifyEmails(
  emails: EmailForClassification[],
): Promise<ClassificationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[email-classifier] OPENAI_API_KEY not set, skipping AI classification");
    return {
      classifications: new Map(),
      recommendedBlockDomains: [],
      recommendedKeepDomains: [],
    };
  }

  const openai = new OpenAI({ apiKey });

  // Sample for classification
  const sample = sampleEmails(emails, MAX_SAMPLE);
  const classifications = new Map<string, ClassifiedEmail>();

  // Process in batches
  for (let i = 0; i < sample.length; i += BATCH_SIZE) {
    const batch = sample.slice(i, i + BATCH_SIZE);
    const results = await classifyBatch(openai, batch);

    for (const result of results) {
      const email = batch[result.index];
      if (email) {
        classifications.set(email.id, {
          id: email.id,
          category: result.category,
          confidence: result.confidence,
        });
      }
    }
  }

  // Generate domain recommendations from classifications
  const domainCategories = new Map<string, Set<EmailCategory>>();
  for (const [, classified] of classifications) {
    const email = sample.find((e) => e.id === classified.id);
    if (!email) continue;

    const categories = domainCategories.get(email.domain) ?? new Set();
    categories.add(classified.category);
    domainCategories.set(email.domain, categories);
  }

  const recommendedBlockDomains: string[] = [];
  const recommendedKeepDomains: string[] = [];

  for (const [domain, categories] of domainCategories) {
    const hasImportable = [...categories].some((c) =>
      IMPORT_CATEGORIES.includes(c),
    );

    if (hasImportable) {
      recommendedKeepDomains.push(domain);
    } else {
      recommendedBlockDomains.push(domain);
    }
  }

  // Sort block domains by frequency (most emails first)
  const domainCounts = new Map<string, number>();
  for (const email of emails) {
    domainCounts.set(email.domain, (domainCounts.get(email.domain) ?? 0) + 1);
  }
  recommendedBlockDomains.sort(
    (a, b) => (domainCounts.get(b) ?? 0) - (domainCounts.get(a) ?? 0),
  );

  return {
    classifications,
    recommendedBlockDomains,
    recommendedKeepDomains,
  };
}
