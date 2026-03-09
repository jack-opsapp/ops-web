/**
 * OPS Web - Email Classifier (OpenAI GPT-4o-mini)
 *
 * Analyzes up to 500 scanned emails in a single API call and returns
 * a recommended filter configuration tailored to this specific customer.
 * Big input (~40K tokens), tiny output (~500 tokens). Cost: < 1¢.
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

/** The AI-recommended filter configuration, ready to merge into GmailSyncFilters */
export interface RecommendedFilters {
  /** Domains that are 100% noise — block entirely */
  excludeDomains: string[];
  /** Specific addresses to block (e.g. noreply@vendor.com) */
  excludeAddresses: string[];
  /** Subject keywords/phrases that indicate non-customer email */
  excludeSubjectKeywords: string[];
  /** Whether to enable the preset blocklist (newsletters, notifications) */
  usePresetBlocklist: boolean;
  /** Gmail label IDs to import from (e.g. ["INBOX"] or ["INBOX", "SENT"]) */
  labelIds: string[];
  /** Brief explanation of the filtering strategy for this customer */
  summary: string;
}

export interface ClassificationResult {
  /** AI-recommended filter config */
  filters: RecommendedFilters;
  /** Per-email verdicts: email ID → "import" | "filter" */
  verdicts: Map<string, "import" | "filter">;
}

// ─── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an email filter advisor for trades and service businesses (construction, landscaping, plumbing, electrical, HVAC, roofing, etc.).

You will receive a list of up to 500 emails from a business owner's inbox. Your job is to analyze ALL of them and output a recommended filter configuration that will:
- IMPORT: real customer conversations, leads, website inquiries, estimates, scheduling, project discussions
- FILTER OUT: marketing, newsletters, automated notifications, transactional receipts, spam, vendor promotions, social media alerts

IMPORTANT RULES:
- Website form submissions (from Wix, Squarespace, WordPress, GoDaddy, etc.) are LEADS — their domains should NOT be blocked
- Emails from real people discussing projects, estimates, scheduling → always import
- When a domain has BOTH customer emails and automated emails (e.g. a supplier where they also talk to a rep), do NOT block the domain — use address-level or subject-level filters instead
- Payment notifications from QuickBooks, Stripe, Square → filter out (transactional)
- Google/Yelp/HomeAdvisor review notifications → filter out (marketing)
- Be aggressive about filtering noise, but never filter out a real customer conversation

OUTPUT FORMAT — respond with valid JSON only:
{
  "excludeDomains": ["domain1.com", "domain2.com"],
  "excludeAddresses": ["noreply@specific.com"],
  "excludeSubjectKeywords": ["unsubscribe", "your order"],
  "usePresetBlocklist": true,
  "labelIds": ["INBOX"],
  "verdicts": { "emailId1": "import", "emailId2": "filter" },
  "summary": "Brief 1-2 sentence explanation of the strategy"
}

RULES FOR EACH FILTER FIELD:
- excludeDomains: Only domains where 100% of emails are noise. Never block a domain that has even one customer email.
- excludeAddresses: Specific sender addresses to block from domains you're keeping.
- excludeSubjectKeywords: Short phrases that reliably indicate noise (case-insensitive match). Be precise — don't use words that might appear in customer emails.
- usePresetBlocklist: true if the inbox has typical marketing/newsletter senders, false only if the business seems to have very unusual email patterns.
- labelIds: Usually ["INBOX"]. Add "SENT" only if you see sent-mail replies to customers. Add "IMPORTANT" if the user seems to use Gmail priority inbox.
- verdicts: For EVERY email in the input, output whether it should be "import" or "filter" based on your recommended filters.`;

// ─── Main Function ──────────────────────────────────────────────────────────

/**
 * Analyze all scanned emails in a single API call and return
 * a recommended filter configuration + per-email verdicts.
 */
export async function classifyEmails(
  emails: EmailForClassification[],
): Promise<ClassificationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[email-classifier] OPENAI_API_KEY not set, skipping AI classification");
    return {
      filters: {
        excludeDomains: [],
        excludeAddresses: [],
        excludeSubjectKeywords: [],
        usePresetBlocklist: true,
        labelIds: ["INBOX", "SENT"],
        summary: "AI classification unavailable — using default filters.",
      },
      verdicts: new Map(),
    };
  }

  const openai = new OpenAI({ apiKey });

  // Format all emails as a compact list
  const emailList = emails
    .map(
      (e) =>
        `[${e.id}] From: ${e.fromEmail} | Subject: ${e.subject} | Snippet: ${(e.snippet || "").slice(0, 200)}`,
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
          content: `Analyze these ${emails.length} emails from a trades/service business and recommend the optimal filter configuration.\n\n${emailList}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error("[email-classifier] Empty response from OpenAI");
      return { filters: defaultFilters(), verdicts: new Map() };
    }

    const parsed = JSON.parse(content) as {
      excludeDomains?: string[];
      excludeAddresses?: string[];
      excludeSubjectKeywords?: string[];
      usePresetBlocklist?: boolean;
      labelIds?: string[];
      verdicts?: Record<string, "import" | "filter">;
      summary?: string;
    };

    // Build verdicts map
    const verdicts = new Map<string, "import" | "filter">();
    if (parsed.verdicts) {
      for (const [id, verdict] of Object.entries(parsed.verdicts)) {
        verdicts.set(id, verdict);
      }
    }

    const filters: RecommendedFilters = {
      excludeDomains: parsed.excludeDomains ?? [],
      excludeAddresses: parsed.excludeAddresses ?? [],
      excludeSubjectKeywords: parsed.excludeSubjectKeywords ?? [],
      usePresetBlocklist: parsed.usePresetBlocklist ?? true,
      labelIds: parsed.labelIds ?? ["INBOX", "SENT"],
      summary: parsed.summary ?? "",
    };

    console.log(
      `[email-classifier] Analyzed ${emails.length} emails → ` +
      `${filters.excludeDomains.length} blocked domains, ` +
      `${filters.excludeAddresses.length} blocked addresses, ` +
      `${filters.excludeSubjectKeywords.length} subject keywords, ` +
      `${verdicts.size} verdicts`,
    );

    return { filters, verdicts };
  } catch (err) {
    console.error("[email-classifier] Classification failed:", err);
    return { filters: defaultFilters(), verdicts: new Map() };
  }
}

function defaultFilters(): RecommendedFilters {
  return {
    excludeDomains: [],
    excludeAddresses: [],
    excludeSubjectKeywords: [],
    usePresetBlocklist: true,
    labelIds: ["INBOX", "SENT"],
    summary: "AI classification failed — using default filters.",
  };
}
