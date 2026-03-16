// src/lib/api/services/writing-profile-service.ts
// Extracts and maintains per-user communication style from outbound emails.

import { requireSupabase } from "@/lib/supabase/helpers";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Module-level helpers ───────────────────────────────────────────────────

function extractGreeting(body: string): string | null {
  const firstLine = body.split("\n")[0]?.trim();
  if (!firstLine) return null;
  const greetingPatterns =
    /^(hi|hey|hello|good morning|good afternoon|dear)\s+\w+/i;
  const match = firstLine.match(greetingPatterns);
  return match ? match[0].replace(/\w+$/, "{name}") + "," : null;
}

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

async function deepToneAnalysis(
  companyId: string,
  userId: string
): Promise<void> {
  const supabase = requireSupabase();

  // Fetch recent outbound activities for tone analysis
  const { data: recentEmails } = await supabase
    .from("activities")
    .select("content")
    .eq("company_id", companyId)
    .eq("direction", "outbound")
    .eq("type", "email")
    .order("created_at", { ascending: false })
    .limit(10);

  if (!recentEmails || recentEmails.length < 5) return;

  const emailTexts = recentEmails
    .map((e) => (e.content as string) || "")
    .filter((t) => t.length > 20)
    .slice(0, 5);

  if (emailTexts.length < 3) return;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Analyze the writing style of these outbound business emails. Return JSON:
{
  "formality": 0.0-1.0 (0=very casual, 1=very formal),
  "traits": {"friendly":true,"direct":true,"technical":false,"casual":true},
  "notes": "one sentence summary of style"
}`,
        },
        {
          role: "user",
          content: emailTexts.join("\n---\n"),
        },
      ],
      temperature: 0.1,
      max_tokens: 150,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return;

    const analysis = JSON.parse(content);

    await supabase
      .from("agent_writing_profiles")
      .update({
        formality_score: analysis.formality || 0.5,
        tone_traits: analysis.traits || {},
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("user_id", userId);
  } catch (err) {
    console.error("[writing-profile] Deep tone analysis failed:", err);
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

export const WritingProfileService = {
  /**
   * Update writing profile from an outbound email.
   * Called alongside MemoryService.processOutboundEmail.
   */
  async updateFromEmail(
    companyId: string,
    userId: string,
    email: { bodyText: string }
  ): Promise<void> {
    const supabase = requireSupabase();

    const { data: profile } = await supabase
      .from("agent_writing_profiles")
      .select("*")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .single();

    // Extract style traits from this email
    const greeting = extractGreeting(email.bodyText);
    const closing = extractClosing(email.bodyText);
    const sentences = email.bodyText
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 10);
    const avgLen =
      sentences.length > 0
        ? sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) /
          sentences.length
        : 0;

    if (!profile) {
      await supabase.from("agent_writing_profiles").insert({
        company_id: companyId,
        user_id: userId,
        greeting_patterns: greeting ? [greeting] : [],
        closing_patterns: closing ? [closing] : [],
        avg_sentence_length: avgLen,
        emails_analyzed: 1,
        tone_traits: {},
        vocabulary_preferences: {},
      });
    } else {
      const analyzed = ((profile.emails_analyzed as number) || 0) + 1;
      const newAvgLen = (profile.avg_sentence_length as number)
        ? ((profile.avg_sentence_length as number) * (analyzed - 1) + avgLen) /
          analyzed
        : avgLen;

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

      await supabase
        .from("agent_writing_profiles")
        .update({
          avg_sentence_length: newAvgLen,
          greeting_patterns: greetings,
          closing_patterns: closings,
          emails_analyzed: analyzed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", profile.id);
    }

    // Every 25 emails, do a deeper tone analysis via AI
    const emailsAnalyzed =
      ((profile?.emails_analyzed as number) || 0) + 1;
    if (emailsAnalyzed % 25 === 0) {
      await deepToneAnalysis(companyId, userId);
    }
  },

  /**
   * Get the writing profile for draft generation.
   */
  async getProfile(
    companyId: string,
    userId: string
  ): Promise<Record<string, unknown> | null> {
    const supabase = requireSupabase();
    const { data } = await supabase
      .from("agent_writing_profiles")
      .select("*")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .single();

    return data;
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
};
