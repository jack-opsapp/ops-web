/**
 * OPS Web - AI Draft Service
 *
 * Generates email drafts in the user's voice using writing profile + thread context.
 * NOT gated by phase_c — any user with an email connection can use this.
 * Memory context from phase_c is used when available but not required.
 *
 * Uses OPENAI_API_KEY_DRAFTING via getDraftingOpenAI().
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { WritingProfileService } from "./writing-profile-service";
import { MemoryService } from "./memory-service";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { getDraftingOpenAI } from "./openai-clients";

function getOpenAI() {
  return getDraftingOpenAI();
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AIDraftRequest {
  companyId: string;
  userId: string;
  connectionId: string;
  opportunityId?: string;
  threadId?: string;
  /** For new emails — who we're writing to */
  recipientEmail?: string;
  recipientName?: string;
  /** Optional instruction from user e.g. "follow up on the quote" */
  userInstruction?: string;
}

export interface AIDraftResult {
  draft: string;
  draftHistoryId: string;
  confidence: number;
  sources: string[];
  available: boolean;
  reason?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute Levenshtein edit distance between two strings.
 * Used to measure how much the user edited the AI draft.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // Optimize: compare word-level for long texts (> 500 chars)
  const wordsA = a.split(/\s+/);
  const wordsB = b.split(/\s+/);

  const m = wordsA.length;
  const n = wordsB.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        wordsA[i - 1] === wordsB[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

/**
 * Detect specific changes between original and edited drafts.
 * Returns a list of change descriptions for learning.
 */
export function detectChanges(
  original: string,
  edited: string
): Array<{ type: string; from: string; to: string }> {
  const changes: Array<{ type: string; from: string; to: string }> = [];

  // Detect greeting changes
  const origGreeting = original.split("\n")[0]?.trim() ?? "";
  const editGreeting = edited.split("\n")[0]?.trim() ?? "";
  if (origGreeting !== editGreeting && origGreeting.length < 50 && editGreeting.length < 50) {
    changes.push({ type: "greeting", from: origGreeting, to: editGreeting });
  }

  // Detect closing changes
  const origLines = original.split("\n").filter((l) => l.trim());
  const editLines = edited.split("\n").filter((l) => l.trim());
  const origClosing = origLines[origLines.length - 1]?.trim() ?? "";
  const editClosing = editLines[editLines.length - 1]?.trim() ?? "";
  if (origClosing !== editClosing && origClosing.length < 50 && editClosing.length < 50) {
    changes.push({ type: "closing", from: origClosing, to: editClosing });
  }

  // Detect tone shift (rough heuristic: exclamation marks, capitalization)
  const origExcl = (original.match(/!/g) || []).length;
  const editExcl = (edited.match(/!/g) || []).length;
  if (Math.abs(origExcl - editExcl) >= 2) {
    changes.push({
      type: "tone",
      from: `${origExcl} exclamations`,
      to: `${editExcl} exclamations`,
    });
  }

  return changes;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const AIDraftService = {
  /**
   * Generate an AI draft reply based on thread context and writing profile.
   * Returns the draft text and a draftHistoryId for edit tracking.
   */
  async generateDraft(req: AIDraftRequest): Promise<AIDraftResult> {
    const supabase = requireSupabase();
    const {
      companyId,
      userId,
      connectionId,
      opportunityId,
      threadId,
      recipientEmail,
      recipientName,
      userInstruction,
    } = req;

    // ── Get writing profile ────────────────────────────────────────────
    const profile = await WritingProfileService.getProfile(companyId, userId);
    const emailsAnalyzed = (profile?.emails_analyzed as number) || 0;
    const confidence = WritingProfileService.getConfidence(emailsAnalyzed);

    // Need at least some email data to match voice (relaxed: 10 emails = ~0.08 confidence)
    if (emailsAnalyzed < 5) {
      return {
        draft: "",
        draftHistoryId: "",
        confidence: 0,
        sources: [],
        available: false,
        reason: `Need more email data to match your voice (${emailsAnalyzed}/5 emails analyzed)`,
      };
    }

    // ── Fetch thread messages for context ───────────────────────────────
    let threadMessages: Array<{
      direction: string;
      from_email: string;
      subject: string;
      body_text: string;
      created_at: string;
    }> = [];

    if (threadId) {
      const { data: messages } = await supabase
        .from("activities")
        .select("direction, from_email, subject, body_text, created_at")
        .eq("company_id", companyId)
        .eq("email_thread_id", threadId)
        .eq("type", "email")
        .order("created_at", { ascending: true })
        .limit(20);

      threadMessages = (messages ?? []) as typeof threadMessages;
    }

    // ── Fetch opportunity context ──────────────────────────────────────
    let opportunityContext = "";
    let clientEmail = recipientEmail || "";
    let clientName = recipientName || "";

    if (opportunityId) {
      const { data: opp } = await supabase
        .from("opportunities")
        .select("title, ai_summary, stage, clients!inner(name, email)")
        .eq("id", opportunityId)
        .single();

      if (opp) {
        const client = opp.clients as unknown as Record<string, unknown>;
        clientEmail = clientEmail || (client.email as string) || "";
        clientName = clientName || (client.name as string) || "";
        opportunityContext = [
          opp.title ? `Project: ${opp.title}` : "",
          opp.ai_summary ? `Summary: ${opp.ai_summary}` : "",
          opp.stage ? `Stage: ${opp.stage}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      }
    }

    // ── Memory context (optional — only if phase_c enabled) ────────────
    let memoryContext = "";
    const sources: string[] = ["writing_profile"];

    try {
      const phaseCEnabled =
        await AdminFeatureOverrideService.isAIFeatureEnabled(
          companyId,
          "phase_c"
        );
      if (phaseCEnabled && clientEmail) {
        const mem = await MemoryService.getContextForDraft(
          companyId,
          clientEmail,
          opportunityContext
        );
        if (mem.pricingReferences.length > 0) {
          memoryContext += `\nPricing references: ${mem.pricingReferences.slice(0, 5).join("; ")}`;
          sources.push("pricing");
        }
        if (mem.currentPromotions.length > 0) {
          memoryContext += `\nCurrent promotions: ${mem.currentPromotions.join("; ")}`;
          sources.push("promotions");
        }
        if (mem.clientHistory.length > 0) {
          memoryContext += `\nClient history: ${JSON.stringify(mem.clientHistory.slice(0, 3))}`;
          sources.push("client_history");
        }
        if (
          mem.relevantFacts.some((f) => f.category === "limitation")
        ) {
          const limitations = mem.relevantFacts
            .filter((f) => f.category === "limitation")
            .map((f) => f.content);
          memoryContext += `\nLimitations: ${limitations.join("; ")}`;
          sources.push("limitations");
        }
      }
    } catch {
      // Memory is optional — don't fail the draft
    }

    // ── Build thread context string ────────────────────────────────────
    const threadContext = threadMessages
      .map((m) => {
        const dir = m.direction === "outbound" ? "YOU" : "THEM";
        const body = (m.body_text || "").slice(0, 600);
        return `[${dir}] ${m.subject}\n${body}`;
      })
      .join("\n---\n");

    if (threadMessages.length > 0) {
      sources.push("thread_history");
    }

    // ── Build system prompt ────────────────────────────────────────────
    const greetings = (profile?.greeting_patterns as string[]) || [];
    const closings = (profile?.closing_patterns as string[]) || [];
    const toneTraits = profile?.tone_traits || {};
    const avgSentLen = (profile?.avg_sentence_length as number) || 15;
    const formality = (profile?.formality_score as number) || 0.6;
    const vocabPrefs = profile?.vocabulary_preferences as Record<string, unknown> | undefined;

    const systemPrompt = `You are drafting an email reply for a trades business owner. Write in THEIR exact voice and style. The draft must be indistinguishable from an email they would write themselves.

WRITING STYLE:
- Greeting: ${greetings[0] || "Hi {name},"}${greetings.length > 1 ? ` (alternatives: ${greetings.slice(1, 3).join(", ")})` : ""}
- Sign-off: ${closings[0] || "Cheers,"}${closings.length > 1 ? ` (alternatives: ${closings.slice(1, 3).join(", ")})` : ""}
- Tone traits: ${Array.isArray(toneTraits) ? toneTraits.join(", ") : JSON.stringify(toneTraits)}
- Average sentence length: ${avgSentLen.toFixed(0)} words
- Formality: ${formality.toFixed(1)}/1.0 (0=very casual, 1=very formal)
${vocabPrefs ? `- Vocabulary: ${JSON.stringify(vocabPrefs)}` : ""}

${opportunityContext ? `PROJECT CONTEXT:\n${opportunityContext}\n` : ""}
${memoryContext ? `BUSINESS MEMORY:\n${memoryContext}\n` : ""}

RULES:
- Do NOT mention AI or that this is auto-generated
- Match the owner's voice EXACTLY — same greeting, same tone, same sentence structure
- Be concise — trades owners write short, direct emails
- Include relevant business details if available from context
- Write in markdown format
- Replace {name} in greeting with the client's first name`;

    // ── Build user prompt ──────────────────────────────────────────────
    const lastInbound = threadMessages
      .filter((m) => m.direction === "inbound")
      .pop();

    let userPrompt: string;

    if (lastInbound) {
      userPrompt = `Draft a reply to this email thread.

${clientName ? `Client: ${clientName}` : ""}${clientEmail ? ` <${clientEmail}>` : ""}

Latest inbound message:
Subject: ${lastInbound.subject}
${lastInbound.body_text?.slice(0, 1500) || "(no body)"}

${threadContext ? `\nFull thread (oldest first):\n${threadContext}` : ""}
${userInstruction ? `\nUser instruction: ${userInstruction}` : ""}`;
    } else {
      userPrompt = `Draft a new email.

${clientName ? `To: ${clientName}` : ""}${clientEmail ? ` <${clientEmail}>` : ""}
${userInstruction ? `Purpose: ${userInstruction}` : "Write a professional business email."}
${opportunityContext ? `\nContext:\n${opportunityContext}` : ""}`;
    }

    // ── Generate draft ─────────────────────────────────────────────────
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 800,
    });

    const draft = response.choices[0]?.message?.content || "";

    if (!draft) {
      return {
        draft: "",
        draftHistoryId: "",
        confidence,
        sources,
        available: false,
        reason: "AI returned empty response",
      };
    }

    // ── Store in ai_draft_history ──────────────────────────────────────
    const { data: historyRow } = await supabase
      .from("ai_draft_history")
      .insert({
        company_id: companyId,
        user_id: userId,
        opportunity_id: opportunityId || null,
        connection_id: connectionId,
        thread_id: threadId || null,
        original_draft: draft,
        status: "drafted",
      })
      .select("id")
      .single();

    return {
      draft,
      draftHistoryId: historyRow?.id || "",
      confidence,
      sources,
      available: true,
    };
  },

  /**
   * Record the final version after user sends (or discards) an AI draft.
   * Computes edit distance and detected changes, feeds back into writing profile.
   */
  async recordDraftOutcome(
    draftHistoryId: string,
    companyId: string,
    userId: string,
    outcome: "sent" | "discarded",
    finalVersion?: string
  ): Promise<void> {
    const supabase = requireSupabase();

    // Fetch original draft
    const { data: history } = await supabase
      .from("ai_draft_history")
      .select("original_draft")
      .eq("id", draftHistoryId)
      .eq("company_id", companyId)
      .single();

    if (!history) return;

    const original = history.original_draft as string;

    if (outcome === "discarded") {
      await supabase
        .from("ai_draft_history")
        .update({ status: "discarded" })
        .eq("id", draftHistoryId);
      return;
    }

    // outcome === "sent"
    const final = finalVersion || original;
    const distance = editDistance(original, final);
    const noChanges = original.trim() === final.trim();
    const changes = noChanges ? [] : detectChanges(original, final);

    await supabase
      .from("ai_draft_history")
      .update({
        final_version: final,
        edit_distance: distance,
        changes_made: changes,
        sent_without_changes: noChanges,
        status: "sent",
        sent_at: new Date().toISOString(),
      })
      .eq("id", draftHistoryId);

    // Feed significant changes back into writing profile learning
    if (changes.length > 0) {
      await this.learnFromEdits(companyId, userId, changes);
    }
  },

  /**
   * Learn from user edits to improve future drafts.
   * If user consistently changes greetings/closings, update the profile.
   */
  async learnFromEdits(
    companyId: string,
    userId: string,
    changes: Array<{ type: string; from: string; to: string }>
  ): Promise<void> {
    const supabase = requireSupabase();

    // Fetch recent edit patterns (last 20 drafts)
    const { data: recentDrafts } = await supabase
      .from("ai_draft_history")
      .select("changes_made")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("status", "sent")
      .not("changes_made", "eq", "[]")
      .order("created_at", { ascending: false })
      .limit(20);

    if (!recentDrafts || recentDrafts.length < 3) return;

    // Count greeting and closing change patterns
    const greetingChanges = new Map<string, number>();
    const closingChanges = new Map<string, number>();

    for (const row of recentDrafts) {
      const rowChanges = (row.changes_made as Array<{ type: string; to: string }>) || [];
      for (const c of rowChanges) {
        if (c.type === "greeting" && c.to) {
          greetingChanges.set(c.to, (greetingChanges.get(c.to) || 0) + 1);
        }
        if (c.type === "closing" && c.to) {
          closingChanges.set(c.to, (closingChanges.get(c.to) || 0) + 1);
        }
      }
    }

    // If user changed greeting to the same thing 3+ times, update profile
    const { data: profile } = await supabase
      .from("agent_writing_profiles")
      .select("id, greeting_patterns, closing_patterns")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .single();

    if (!profile) return;

    const updates: Record<string, unknown> = {};

    for (const [greeting, count] of greetingChanges) {
      if (count >= 3) {
        const patterns = (profile.greeting_patterns as string[]) || [];
        // Move preferred greeting to first position
        const filtered = patterns.filter((p) => p !== greeting);
        updates.greeting_patterns = [greeting, ...filtered].slice(0, 10);
        break;
      }
    }

    for (const [closing, count] of closingChanges) {
      if (count >= 3) {
        const patterns = (profile.closing_patterns as string[]) || [];
        const filtered = patterns.filter((p) => p !== closing);
        updates.closing_patterns = [closing, ...filtered].slice(0, 10);
        break;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await supabase
        .from("agent_writing_profiles")
        .update(updates)
        .eq("id", profile.id);
    }
  },

  /**
   * Get approval rate stats for a user's AI drafts.
   */
  async getApprovalStats(
    companyId: string,
    userId: string
  ): Promise<{
    totalSent: number;
    sentWithoutChanges: number;
    approvalRate: number;
    recentDrafts: number;
    commonChanges: Array<{ type: string; from: string; to: string; count: number }>;
    suggestAutoSend: boolean;
  }> {
    const supabase = requireSupabase();

    // Get last 20 sent drafts for rolling approval rate
    const { data: recentSent } = await supabase
      .from("ai_draft_history")
      .select("sent_without_changes, changes_made, edit_distance")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(20);

    const drafts = recentSent || [];
    const totalSent = drafts.length;
    const sentWithoutChanges = drafts.filter(
      (d) => d.sent_without_changes === true
    ).length;
    const approvalRate = totalSent > 0 ? sentWithoutChanges / totalSent : 0;

    // Aggregate common changes
    const changeCounts = new Map<string, { from: string; to: string; count: number }>();
    for (const draft of drafts) {
      const changes = (draft.changes_made as Array<{ type: string; from: string; to: string }>) || [];
      for (const c of changes) {
        const key = `${c.type}:${c.to}`;
        const existing = changeCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          changeCounts.set(key, { from: c.from, to: c.to, count: 1 });
        }
      }
    }

    const commonChanges = Array.from(changeCounts.entries())
      .map(([key, val]) => ({
        type: key.split(":")[0],
        from: val.from,
        to: val.to,
        count: val.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Suggest auto-send if 95%+ approval over 20+ drafts
    const suggestAutoSend = totalSent >= 20 && approvalRate >= 0.95;

    return {
      totalSent,
      sentWithoutChanges,
      approvalRate,
      recentDrafts: totalSent,
      commonChanges,
      suggestAutoSend,
    };
  },
};
