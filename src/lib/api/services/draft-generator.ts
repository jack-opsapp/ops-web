// src/lib/api/services/draft-generator.ts
// Generates draft replies in the user's voice using memory + writing profile.
// Requires confidence >= 0.5 to be available.

import { MemoryService } from "./memory-service";
import { WritingProfileService } from "./writing-profile-service";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import OpenAI from "openai";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
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

    // Build the draft prompt
    const systemPrompt = `You are drafting an email reply for a trades business owner. Write in their exact voice and style.

WRITING STYLE:
- Greeting: ${(profile?.greeting_patterns as string[])?.[0] || "Hi {name},"}
- Sign-off: ${(profile?.closing_patterns as string[])?.[0] || "Cheers,"}
- Tone: ${JSON.stringify(profile?.tone_traits || {})}
- Average sentence length: ${((profile?.avg_sentence_length as number) || 15).toFixed(0)} words
- Formality: ${((profile?.formality_score as number) || 0.6).toFixed(1)}/1.0

BUSINESS CONTEXT:
${memoryContext.currentPromotions.length > 0 ? `Current promotions: ${memoryContext.currentPromotions.join("; ")}` : "No current promotions."}
${memoryContext.pricingReferences.length > 0 ? `Pricing references: ${memoryContext.pricingReferences.slice(0, 5).join("; ")}` : ""}
${memoryContext.relevantFacts
  .filter((f) => f.category === "limitation")
  .map((f) => `Limitation: ${f.content}`)
  .join("\n")}

CLIENT HISTORY:
${memoryContext.clientHistory.length > 0 ? JSON.stringify(memoryContext.clientHistory.slice(0, 5)) : "No prior history with this client."}

Write a natural reply. Do NOT mention that you are AI. Match the owner's voice exactly. Include relevant business details (pricing, promotions, next steps) if appropriate.`;

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
