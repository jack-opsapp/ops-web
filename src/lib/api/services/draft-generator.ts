// src/lib/api/services/draft-generator.ts
// Generates draft replies in the user's voice using memory + writing profile.
// Requires confidence >= 0.5 to be available.

import { MemoryService } from "./memory-service";
import { WritingProfileService } from "./writing-profile-service";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { getDraftingOpenAI } from "./openai-clients";

// Uses OPENAI_API_KEY_DRAFTING — draft generation has its own key for cost isolation.
function getOpenAI() {
  return getDraftingOpenAI();
}

export interface DraftResult {
  draft: string;
  confidence: number;
  sources: string[];
  available: boolean;
  reason?: string;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const DraftGenerator = {
  /**
   * Generate a draft reply for a lead.
   */
  async generateDraft(
    companyId: string,
    userId: string,
    context: {
      clientName: string;
      clientEmail: string;
      projectDescription: string;
      lastInboundSubject: string;
      lastInboundBody: string;
      threadHistory?: string;
    }
  ): Promise<DraftResult> {
    // Check feature gate
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "phase_c"
    );
    if (!enabled) {
      return {
        draft: "",
        confidence: 0,
        sources: [],
        available: false,
        reason: "AI memory not enabled",
      };
    }

    // Check confidence threshold
    const profile = await WritingProfileService.getProfile(companyId, userId);
    const confidence = WritingProfileService.getConfidence(
      (profile?.emails_analyzed as number) || 0
    );

    if (confidence < 0.5) {
      return {
        draft: "",
        confidence,
        sources: [],
        available: false,
        reason: `Need more email data (${(profile?.emails_analyzed as number) || 0}/100 emails analyzed, confidence: ${(confidence * 100).toFixed(0)}%)`,
      };
    }

    // Gather memory context
    const memoryContext = await MemoryService.getContextForDraft(
      companyId,
      context.clientEmail,
      context.projectDescription
    );

    // Build the draft prompt with 12-dimension writing voice
    const vocabPrefs = (profile?.vocabulary_preferences as Record<string, unknown>) || {};
    const toneTraits = profile?.tone_traits || {};
    const normalizedTraits = Array.isArray(toneTraits)
      ? Object.fromEntries((toneTraits as string[]).map((t: string) => [t, true]))
      : (toneTraits as Record<string, unknown>);
    const traitLabels = Object.entries(normalizedTraits)
      .filter(([k, v]) => k !== "response_structure" && v === true)
      .map(([k]) => k);
    const substitutions = vocabPrefs.substitutions as Record<string, string> | undefined;
    const hedgingTendency = typeof vocabPrefs.hedging_tendency === "number" ? vocabPrefs.hedging_tendency as number : null;
    const punctuationHabits = vocabPrefs.punctuation_habits as Record<string, number> | undefined;
    const paragraphStructure = vocabPrefs.paragraph_structure as Record<string, unknown> | undefined;
    const engagementStyle = vocabPrefs.engagement_style as Record<string, number> | undefined;
    const responseStructure = normalizedTraits.response_structure as Record<string, string> | undefined;
    const emailLengthData = vocabPrefs.email_length as Record<string, unknown> | undefined;

    const systemPrompt = `You are drafting an email reply for a trades business owner. Write in their exact voice and style.

WRITING VOICE:
- Greeting: ${(profile?.greeting_patterns as string[])?.[0] || "Hi {name},"}
- Sign-off: ${(profile?.closing_patterns as string[])?.[0] || "Cheers,"}
- Tone: ${traitLabels.length > 0 ? traitLabels.join(", ") : "neutral"}
- Average sentence length: ${((profile?.avg_sentence_length as number) || 15).toFixed(0)} words
- Formality: ${((profile?.formality_score as number) || 0.6).toFixed(2)}/1.0
${hedgingTendency !== null ? `- Hedging: ${(hedgingTendency * 100).toFixed(0)}% of sentences${hedgingTendency < 0.1 ? " — be DIRECT, avoid hedging" : ""}` : ""}
${punctuationHabits ? `- Punctuation: ${(punctuationHabits.exclamation_marks || 0).toFixed(1)} exclamations/email, ${(punctuationHabits.em_dashes || 0).toFixed(1)} em-dashes/email` : ""}
${paragraphStructure ? `- Structure: ${(paragraphStructure.prefersBullets as boolean) ? "prefers bullets" : "prefers prose"}` : ""}
${engagementStyle ? `- Engagement: ${(engagementStyle.questionsPerEmail || 0).toFixed(1)} questions/email` : ""}
${responseStructure ? `- Response structure: Opens with ${responseStructure.openingStyle || "business"}, transitions via ${responseStructure.transitionStyle || "natural flow"}, closes with ${responseStructure.preClosingStyle || "call to action"}` : ""}
${emailLengthData ? `- Target length: ~${((emailLengthData.avgWordCount as number) || 100).toFixed(0)} words` : ""}
${substitutions && Object.keys(substitutions).length > 0 ? `- Word preferences: ${Object.entries(substitutions).map(([from, to]) => `"${from}"→"${to}"`).join(", ")}` : ""}

BUSINESS CONTEXT:
${memoryContext.currentPromotions.length > 0 ? `Current promotions: ${memoryContext.currentPromotions.join("; ")}` : "No current promotions."}
${memoryContext.pricingReferences.length > 0 ? `Pricing references: ${memoryContext.pricingReferences.slice(0, 5).join("; ")}` : ""}
${memoryContext.relevantFacts
  .filter((f) => f.category === "limitation")
  .map((f) => `Limitation: ${f.content}`)
  .join("\n")}

CLIENT HISTORY:
${memoryContext.clientHistory.length > 0 ? JSON.stringify(memoryContext.clientHistory.slice(0, 5)) : "No prior history with this client."}

Write a natural reply. Do NOT mention that you are AI. Match the owner's voice exactly across all dimensions. Include relevant business details (pricing, promotions, next steps) if appropriate.`;

    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Draft a reply to this email:

From: ${context.clientName} <${context.clientEmail}>
Subject: ${context.lastInboundSubject}

${context.lastInboundBody.slice(0, 1500)}

${context.threadHistory ? `\nThread history:\n${context.threadHistory.slice(0, 1000)}` : ""}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const draft = response.choices[0]?.message?.content || "";
    const sources = [
      ...(memoryContext.currentPromotions.length > 0 ? ["promotions"] : []),
      ...(memoryContext.pricingReferences.length > 0 ? ["pricing"] : []),
      ...(memoryContext.clientHistory.length > 0 ? ["client_history"] : []),
      "writing_profile",
    ];

    return { draft, confidence, sources, available: true };
  },
};
