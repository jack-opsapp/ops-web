// src/lib/api/services/writing-profile-service.ts
// Extracts and maintains per-user communication style from outbound emails.
// 12-dimension writing profile: formality, sentence length, paragraph structure,
// hedging, punctuation, vocabulary complexity, engagement, greetings, closings,
// response structure, tone markers, email length per context.

import { requireSupabase } from "@/lib/supabase/helpers";
import { getSyncOpenAI } from "./openai-clients";

// Uses OPENAI_API_KEY_SYNC — writing profile analysis runs during ongoing sync.
function getOpenAI() {
  return getSyncOpenAI();
}

// ─── Constants ─────────────────────────────────────────────────────────────

const CONTRACTION_PATTERNS = /\b(don'?t|won'?t|can'?t|isn'?t|aren'?t|wasn'?t|weren'?t|hasn'?t|haven'?t|hadn'?t|wouldn'?t|couldn'?t|shouldn'?t|didn'?t|ain'?t|it'?s|i'?m|i'?ll|i'?ve|i'?d|we'?re|we'?ll|we'?ve|they'?re|they'?ll|they'?ve|you'?re|you'?ll|you'?ve|he'?s|she'?s|that'?s|there'?s|here'?s|what'?s|who'?s|let'?s)\b/gi;

const COLLOQUIALISMS = [
  "gonna", "wanna", "gotta", "kinda", "sorta", "yeah", "yep", "nope",
  "hey", "btw", "fyi", "asap", "lol", "haha", "no worries", "sounds good",
  "cool", "awesome", "great", "perfect", "gotcha", "alright",
];

const HEDGING_PHRASES = [
  "perhaps", "might", "maybe", "i think", "possibly", "it seems",
  "if i'm not mistaken", "i believe", "not sure but", "could be",
  "it appears", "presumably", "arguably", "in my opinion", "i suppose",
  "more or less", "kind of", "sort of", "to some extent", "roughly",
];

const TRADE_JARGON = [
  "lf", "sqft", "sq ft", "fascia", "soffit", "joist", "riser", "baluster",
  "flashing", "shingle", "truss", "stud", "drywall", "plywood", "osb",
  "subfloor", "underlayment", "decking", "railing", "post", "beam",
  "footing", "grade", "pitch", "slope", "eave", "ridge", "valley",
  "gutter", "downspout", "hvac", "conduit", "romex", "pex", "abs",
  "backfill", "grading", "excavation", "concrete", "rebar", "form",
  "header", "sill plate", "top plate", "blocking", "bridging", "furring",
  "trim", "casing", "baseboard", "crown", "wainscot", "bead board",
  "p-trap", "shutoff", "rough-in", "finish", "punch list", "change order",
  "scope", "spec", "bid", "estimate", "invoice", "draw", "progress payment",
];

// ─── Dimension Extractors ──────────────────────────────────────────────────

/** Dim 1: Enhanced formality score — contractions + colloquialisms (0-1 scale). */
function extractFormality(body: string): { formalityScore: number; contractionCount: number; colloquialismCount: number } {
  const words = body.split(/\s+/);
  const wordCount = words.length || 1;

  const contractions = (body.match(CONTRACTION_PATTERNS) || []).length;
  const contractionDensity = contractions / wordCount;

  const lowerBody = body.toLowerCase();
  let colloquialismCount = 0;
  for (const c of COLLOQUIALISMS) {
    const regex = new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    colloquialismCount += (body.match(regex) || []).length;
  }
  const colloquialismDensity = colloquialismCount / wordCount;

  // Formal markers
  let formalMarkers = 0;
  const formalPhrases = ["please", "kindly", "regarding", "furthermore", "however", "therefore", "accordingly", "pursuant"];
  for (const fp of formalPhrases) {
    if (lowerBody.includes(fp)) formalMarkers++;
  }
  const formalDensity = formalMarkers / wordCount;

  // Score: higher = more formal. Contractions/colloquialisms pull it down, formal words push up.
  const rawScore = 0.5 - (contractionDensity * 5) - (colloquialismDensity * 8) + (formalDensity * 10);
  const formalityScore = Math.max(0, Math.min(1, rawScore));

  return { formalityScore, contractionCount: contractions, colloquialismCount };
}

/** Dim 2: Average sentence length (word count). */
function extractSentenceLength(body: string): number {
  const sentences = body.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  if (sentences.length === 0) return 0;
  return sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / sentences.length;
}

/** Dim 3: Paragraph structure — bullets, paragraph length, bullet preference. */
function extractParagraphStructure(body: string): {
  bulletFrequency: number;
  avgParagraphLines: number;
  prefersBullets: boolean;
} {
  const lines = body.split("\n");
  const bulletPattern = /^\s*[-*•]\s|^\s*\d+[.)]\s/;
  const bulletLines = lines.filter((l) => bulletPattern.test(l)).length;
  const totalLines = lines.filter((l) => l.trim().length > 0).length || 1;
  const bulletFrequency = bulletLines / totalLines;

  // Paragraph detection: groups of non-blank lines separated by blank lines
  const paragraphs: number[] = [];
  let currentLength = 0;
  for (const line of lines) {
    if (line.trim().length === 0) {
      if (currentLength > 0) {
        paragraphs.push(currentLength);
        currentLength = 0;
      }
    } else {
      currentLength++;
    }
  }
  if (currentLength > 0) paragraphs.push(currentLength);

  const avgParagraphLines = paragraphs.length > 0
    ? paragraphs.reduce((a, b) => a + b, 0) / paragraphs.length
    : 1;

  return {
    bulletFrequency,
    avgParagraphLines,
    prefersBullets: bulletFrequency > 0.2,
  };
}

/** Dim 4: Hedging frequency — hedges per sentence (0-1). */
function extractHedgingFrequency(body: string): number {
  const lowerBody = body.toLowerCase();
  const sentences = body.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  if (sentences.length === 0) return 0;

  let hedgeCount = 0;
  for (const phrase of HEDGING_PHRASES) {
    const regex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    hedgeCount += (lowerBody.match(regex) || []).length;
  }

  return Math.min(1, hedgeCount / sentences.length);
}

/** Dim 5: Punctuation style — counts per email. */
function extractPunctuationStyle(body: string): {
  exclamation_marks: number;
  em_dashes: number;
  semicolons: number;
  ellipsis: number;
  parenthetical: number;
} {
  return {
    exclamation_marks: (body.match(/!/g) || []).length,
    em_dashes: (body.match(/—|--/g) || []).length,
    semicolons: (body.match(/;/g) || []).length,
    ellipsis: (body.match(/\.{3}|…/g) || []).length,
    parenthetical: (body.match(/\(/g) || []).length,
  };
}

/** Dim 6: Vocabulary complexity — word length, type-token ratio, trade jargon. */
function extractVocabularyComplexity(body: string): {
  avgWordLength: number;
  uniqueWordRatio: number;
  usesTradeJargon: boolean;
} {
  const words = body.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return { avgWordLength: 0, uniqueWordRatio: 0, usesTradeJargon: false };

  const avgWordLength = words.reduce((sum, w) => sum + w.replace(/[^a-z]/g, "").length, 0) / words.length;

  // Type-token ratio on a sample (first 200 words to avoid length bias)
  const sample = words.slice(0, 200);
  const uniqueWords = new Set(sample);
  const uniqueWordRatio = uniqueWords.size / sample.length;

  // Trade jargon detection
  const lowerBody = body.toLowerCase();
  let jargonHits = 0;
  for (const term of TRADE_JARGON) {
    if (lowerBody.includes(term)) jargonHits++;
  }
  const usesTradeJargon = jargonHits >= 2;

  return { avgWordLength, uniqueWordRatio, usesTradeJargon };
}

/** Dim 7: Engagement style — questions, direct address, first person. */
function extractEngagementStyle(body: string): {
  questionsPerEmail: number;
  directAddressFreq: number;
  firstPersonFreq: number;
} {
  const sentences = body.split(/[.!?]+/).filter((s) => s.trim().length > 5);
  const totalSentences = sentences.length || 1;
  const words = body.split(/\s+/);
  const wordCount = words.length || 1;

  const questionsPerEmail = (body.match(/\?/g) || []).length;

  // Direct address: "you", "your", "you're"
  const directAddress = (body.match(/\b(you|your|you're|you'll|you've|yourself)\b/gi) || []).length;
  const directAddressFreq = directAddress / wordCount;

  // First person: "I", "we", "our", "my"
  const firstPerson = (body.match(/\b(i|we|our|my|me|us|i'm|i'll|i've|we're|we'll|we've)\b/gi) || []).length;
  const firstPersonFreq = firstPerson / wordCount;

  return { questionsPerEmail, directAddressFreq, firstPersonFreq };
}

/** Dim 8: Greeting extraction. */
function extractGreeting(body: string): string | null {
  const firstLine = body.split("\n")[0]?.trim();
  if (!firstLine) return null;
  const greetingPatterns =
    /^(hi|hey|hello|good morning|good afternoon|dear)\s+\w+/i;
  const match = firstLine.match(greetingPatterns);
  return match ? match[0].replace(/\w+$/, "{name}") + "," : null;
}

/** Dim 9: Closing extraction. */
function extractClosing(body: string): string | null {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const lastLines = lines.slice(-5);
  const closingPatterns = [
    "cheers",
    "regards",
    "best",
    "thanks",
    "all the best",
    "thank you",
  ];
  for (const line of lastLines) {
    const lower = line.toLowerCase().replace(/[,.]$/, "");
    if (closingPatterns.some((p) => lower.startsWith(p))) {
      return line.replace(/[,.]$/, "");
    }
  }
  return null;
}

/** Dim 12: Email word count for length tracking. */
function extractEmailLength(body: string): {
  wordCount: number;
  category: "short" | "medium" | "long";
} {
  const wordCount = body.split(/\s+/).filter((w) => w.length > 0).length;
  const category = wordCount < 50 ? "short" : wordCount <= 200 ? "medium" : "long";
  return { wordCount, category };
}

// ─── Rolling Average Helpers ───────────────────────────────────────────────

/** Compute a weighted rolling average: existing * (n-1)/n + new * 1/n */
function rollingAvg(existing: number | undefined | null, newVal: number, count: number): number {
  if (!existing || count <= 1) return newVal;
  return (existing * (count - 1) + newVal) / count;
}

/** Merge punctuation counts as rolling averages. */
function mergePunctuation(
  existing: Record<string, number> | undefined,
  newCounts: Record<string, number>,
  count: number
): Record<string, number> {
  if (!existing || count <= 1) return newCounts;
  const merged: Record<string, number> = {};
  for (const key of Object.keys(newCounts)) {
    merged[key] = rollingAvg(existing[key], newCounts[key], count);
  }
  return merged;
}

// ─── Tone Traits Normalization ─────────────────────────────────────────────

/**
 * Normalize tone_traits to object format { trait: true/false, response_structure?: {...} }.
 * Handles legacy array format ["direct", "professional"].
 * Return type is Record<string, unknown> because response_structure nests string values.
 */
function normalizeToneTraits(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const obj: Record<string, unknown> = {};
    for (const trait of raw) {
      if (typeof trait === "string") obj[trait] = true;
    }
    return obj;
  }
  if (typeof raw === "object") {
    return raw as Record<string, unknown>;
  }
  return {};
}

// ─── Deep Analysis (GPT, every 25 emails) ──────────────────────────────────

async function deepToneAnalysis(
  companyId: string,
  userId: string,
  profileType: string
): Promise<void> {
  const supabase = requireSupabase();

  // Look up user's email to filter activities by the correct sender
  const { data: userData } = await supabase
    .from("users")
    .select("email")
    .eq("id", userId)
    .single();

  // Build query — filter by user_id (via from_email) for multi-user companies
  let query = supabase
    .from("activities")
    .select("content")
    .eq("company_id", companyId)
    .eq("direction", "outbound")
    .eq("type", "email")
    .order("created_at", { ascending: false })
    .limit(10);

  if (userData?.email) {
    query = query.eq("from_email", userData.email as string);
  }

  const { data: recentEmails } = await query;

  if (!recentEmails || recentEmails.length < 5) return;

  const emailTexts = recentEmails
    .map((e) => (e.content as string) || "")
    .filter((t) => t.length > 20)
    .slice(0, 5);

  if (emailTexts.length < 3) return;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Analyze the writing style of these outbound business emails. Return JSON:
{
  "formality": 0.0-1.0 (0=very casual, 1=very formal),
  "traits": {"friendly":true,"direct":true,"technical":false,"casual":true},
  "response_structure": {
    "openingStyle": "jumps to business" | "small talk first" | "references previous",
    "transitionStyle": "abrupt" | "smooth connectors" | "numbered points",
    "preClosingStyle": "call to action" | "open question" | "summary" | "pleasantry"
  },
  "notes": "one sentence summary of style"
}`,
        },
        {
          role: "user",
          content: emailTexts.join("\n---\n"),
        },
      ],
      temperature: 0.1,
      max_tokens: 250,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return;

    const analysis = JSON.parse(content);

    // Fetch existing profile to blend rather than overwrite
    const { data: existingProfile } = await supabase
      .from("agent_writing_profiles")
      .select("tone_traits, formality_score, emails_analyzed")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("profile_type", profileType)
      .single();

    const existingTraits = normalizeToneTraits(existingProfile?.tone_traits);
    const newTraits = analysis.traits || {};
    const mergedTraits: Record<string, unknown> = { ...existingTraits, ...newTraits };

    // Store response_structure (dimension 10) inside tone_traits
    if (analysis.response_structure) {
      mergedTraits.response_structure = analysis.response_structure;
    }

    // Blend GPT formality with existing rolling average (70% existing, 30% GPT)
    // rather than overwriting the accumulated local analysis
    const gptFormality = analysis.formality || 0.5;
    const existingFormality = (existingProfile?.formality_score as number) || 0.5;
    const emailsAnalyzed = (existingProfile?.emails_analyzed as number) || 0;
    const blendedFormality = emailsAnalyzed > 10
      ? existingFormality * 0.7 + gptFormality * 0.3
      : gptFormality; // Trust GPT more when few emails analyzed locally

    await supabase
      .from("agent_writing_profiles")
      .update({
        formality_score: blendedFormality,
        tone_traits: mergedTraits,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("profile_type", profileType);
  } catch (err) {
    console.error("[writing-profile] Deep tone analysis failed:", err);
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

export const WritingProfileService = {
  /**
   * Update writing profile from an outbound email.
   * Extracts all 12 dimensions: 7 via regex/NLP (every email, no API cost),
   * dimensions 10+11 via GPT (every 25 emails).
   * Called alongside MemoryService.processOutboundEmail.
   */
  async updateFromEmail(
    companyId: string,
    userId: string,
    email: { bodyText: string },
    profileType: string = "general"
  ): Promise<void> {
    const supabase = requireSupabase();

    // ── Extract all local dimensions ────────────────────────────────────
    const body = email.bodyText;
    const formality = extractFormality(body);
    const sentenceLen = extractSentenceLength(body);
    const paragraphStructure = extractParagraphStructure(body);
    const hedgingFreq = extractHedgingFrequency(body);
    const punctuation = extractPunctuationStyle(body);
    const vocabComplexity = extractVocabularyComplexity(body);
    const engagement = extractEngagementStyle(body);
    const greeting = extractGreeting(body);
    const closing = extractClosing(body);
    const emailLength = extractEmailLength(body);

    // ── Fetch or create profile ─────────────────────────────────────────
    const { data: profile } = await supabase
      .from("agent_writing_profiles")
      .select("*")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("profile_type", profileType)
      .single();

    if (!profile) {
      // First email — initialize profile with all dimensions
      const vocabPrefs = {
        words: [],
        common_phrases: [],
        hedging_tendency: hedgingFreq,
        punctuation_habits: punctuation,
        paragraph_structure: paragraphStructure,
        vocabulary_complexity: vocabComplexity,
        engagement_style: engagement,
        email_length: {
          avgWordCount: emailLength.wordCount,
          lengthDistribution: {
            short: emailLength.category === "short" ? 1 : 0,
            medium: emailLength.category === "medium" ? 1 : 0,
            long: emailLength.category === "long" ? 1 : 0,
          },
        },
        substitutions: {},
      };

      await supabase.from("agent_writing_profiles").insert({
        company_id: companyId,
        user_id: userId,
        profile_type: profileType,
        greeting_patterns: greeting ? [greeting] : [],
        closing_patterns: closing ? [closing] : [],
        avg_sentence_length: sentenceLen,
        formality_score: formality.formalityScore,
        emails_analyzed: 1,
        tone_traits: {},
        vocabulary_preferences: vocabPrefs,
      });
      return;
    }

    // ── Update existing profile with rolling averages ───────────────────
    const analyzed = ((profile.emails_analyzed as number) || 0) + 1;
    const existingVocab = (profile.vocabulary_preferences as Record<string, unknown>) || {};

    // Rolling average for formality (blend local + any GPT-derived score)
    const existingFormality = (profile.formality_score as number) || 0.5;
    const newFormality = rollingAvg(existingFormality, formality.formalityScore, analyzed);

    // Rolling average for sentence length
    const newSentLen = rollingAvg(profile.avg_sentence_length as number, sentenceLen, analyzed);

    // Merge greeting/closing patterns
    const greetings = [
      ...new Set([
        ...((profile.greeting_patterns as string[]) || []),
        ...(greeting ? [greeting] : []),
      ]),
    ].slice(0, 10);
    const closings = [
      ...new Set([
        ...((profile.closing_patterns as string[]) || []),
        ...(closing ? [closing] : []),
      ]),
    ].slice(0, 10);

    // ── Merge vocabulary_preferences with rolling averages ──────────────
    const existingParagraph = (existingVocab.paragraph_structure as Record<string, number>) || {};
    const existingVocabComplexity = (existingVocab.vocabulary_complexity as Record<string, number>) || {};
    const existingEngagement = (existingVocab.engagement_style as Record<string, number>) || {};
    const existingEmailLength = (existingVocab.email_length as Record<string, unknown>) || {};
    const existingPunctuation = (existingVocab.punctuation_habits as Record<string, number>) || {};
    const existingDist = (existingEmailLength.lengthDistribution as Record<string, number>) || { short: 0, medium: 0, long: 0 };

    const updatedVocab = {
      words: existingVocab.words || [],
      common_phrases: existingVocab.common_phrases || [],
      substitutions: existingVocab.substitutions || {},
      hedging_tendency: rollingAvg(
        typeof existingVocab.hedging_tendency === "number" ? existingVocab.hedging_tendency as number : null,
        hedgingFreq,
        analyzed
      ),
      punctuation_habits: mergePunctuation(existingPunctuation, punctuation, analyzed),
      paragraph_structure: {
        bulletFrequency: rollingAvg(existingParagraph.bulletFrequency, paragraphStructure.bulletFrequency, analyzed),
        avgParagraphLines: rollingAvg(existingParagraph.avgParagraphLines, paragraphStructure.avgParagraphLines, analyzed),
        prefersBullets: rollingAvg(existingParagraph.bulletFrequency, paragraphStructure.bulletFrequency, analyzed) > 0.2,
      },
      vocabulary_complexity: {
        avgWordLength: rollingAvg(existingVocabComplexity.avgWordLength, vocabComplexity.avgWordLength, analyzed),
        uniqueWordRatio: rollingAvg(existingVocabComplexity.uniqueWordRatio, vocabComplexity.uniqueWordRatio, analyzed),
        usesTradeJargon: vocabComplexity.usesTradeJargon || (existingVocabComplexity as unknown as { usesTradeJargon?: boolean }).usesTradeJargon === true,
      },
      engagement_style: {
        questionsPerEmail: rollingAvg(existingEngagement.questionsPerEmail, engagement.questionsPerEmail, analyzed),
        directAddressFreq: rollingAvg(existingEngagement.directAddressFreq, engagement.directAddressFreq, analyzed),
        firstPersonFreq: rollingAvg(existingEngagement.firstPersonFreq, engagement.firstPersonFreq, analyzed),
      },
      email_length: {
        avgWordCount: rollingAvg(existingEmailLength.avgWordCount as number | undefined, emailLength.wordCount, analyzed),
        lengthDistribution: {
          short: (existingDist.short || 0) + (emailLength.category === "short" ? 1 : 0),
          medium: (existingDist.medium || 0) + (emailLength.category === "medium" ? 1 : 0),
          long: (existingDist.long || 0) + (emailLength.category === "long" ? 1 : 0),
        },
      },
    };

    await supabase
      .from("agent_writing_profiles")
      .update({
        formality_score: newFormality,
        avg_sentence_length: newSentLen,
        greeting_patterns: greetings,
        closing_patterns: closings,
        vocabulary_preferences: updatedVocab,
        emails_analyzed: analyzed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id);

    // Every 25 emails, do deeper tone + response structure analysis via GPT
    if (analyzed % 25 === 0) {
      await deepToneAnalysis(companyId, userId, profileType);
    }
  },

  /**
   * Get the writing profile for draft generation.
   * Supports per-relationship-type profiles with fallback to "general".
   * If a type-specific profile has <10 emails, blends with the general profile.
   */
  async getProfile(
    companyId: string,
    userId: string,
    profileType?: string
  ): Promise<Record<string, unknown> | null> {
    const supabase = requireSupabase();

    if (profileType && profileType !== "general") {
      // Try type-specific first
      const { data: specificProfile } = await supabase
        .from("agent_writing_profiles")
        .select("*")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .eq("profile_type", profileType)
        .single();

      if (specificProfile) {
        const emailsAnalyzed = (specificProfile.emails_analyzed as number) || 0;
        if (emailsAnalyzed >= 10) {
          return specificProfile;
        }

        // Blend with general if type-specific has too few emails
        const { data: generalProfile } = await supabase
          .from("agent_writing_profiles")
          .select("*")
          .eq("company_id", companyId)
          .eq("user_id", userId)
          .eq("profile_type", "general")
          .single();

        if (generalProfile) {
          return this.blendProfiles(specificProfile, generalProfile, emailsAnalyzed);
        }
        return specificProfile;
      }
    }

    // Fall back to general profile, then any profile
    const { data: generalProfile } = await supabase
      .from("agent_writing_profiles")
      .select("*")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("profile_type", "general")
      .single();

    if (generalProfile) return generalProfile;

    // Last resort: any profile for this user
    const { data: anyProfile } = await supabase
      .from("agent_writing_profiles")
      .select("*")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .order("emails_analyzed", { ascending: false })
      .limit(1)
      .single();

    return anyProfile;
  },

  /**
   * Blend a type-specific profile (low email count) with the general profile.
   * Weight: specific gets emailsAnalyzed/10 weight, general gets the rest.
   */
  blendProfiles(
    specific: Record<string, unknown>,
    general: Record<string, unknown>,
    specificCount: number
  ): Record<string, unknown> {
    const weight = specificCount / 10; // 0-1
    const blend = (s: number | undefined, g: number | undefined) => {
      const sv = s || 0;
      const gv = g || 0;
      return sv * weight + gv * (1 - weight);
    };

    return {
      ...specific,
      formality_score: blend(
        specific.formality_score as number,
        general.formality_score as number
      ),
      avg_sentence_length: blend(
        specific.avg_sentence_length as number,
        general.avg_sentence_length as number
      ),
      // Use specific greetings/closings if they exist, otherwise general
      greeting_patterns:
        ((specific.greeting_patterns as string[]) || []).length > 0
          ? specific.greeting_patterns
          : general.greeting_patterns,
      closing_patterns:
        ((specific.closing_patterns as string[]) || []).length > 0
          ? specific.closing_patterns
          : general.closing_patterns,
      // Tone traits: merge both, specific takes precedence
      tone_traits: {
        ...normalizeToneTraits(general.tone_traits),
        ...normalizeToneTraits(specific.tone_traits),
      },
      // Vocab prefs: use specific if it has data, otherwise general
      vocabulary_preferences:
        Object.keys((specific.vocabulary_preferences as Record<string, unknown>) || {}).length > 2
          ? specific.vocabulary_preferences
          : general.vocabulary_preferences,
    };
  },

  /**
   * Get confidence level based on emails analyzed.
   */
  getConfidence(emailsAnalyzed: number): number {
    if (emailsAnalyzed < 25) return emailsAnalyzed / 125; // 0-0.2
    if (emailsAnalyzed < 100) return 0.2 + (emailsAnalyzed - 25) * 0.004; // 0.2-0.5
    if (emailsAnalyzed < 250)
      return 0.5 + (emailsAnalyzed - 100) * 0.00167; // 0.5-0.75
    return Math.min(1.0, 0.75 + (emailsAnalyzed - 250) * 0.001); // 0.75-1.0
  },

  /** Exported for use in memory-service tone_traits normalization */
  normalizeToneTraits,
};
