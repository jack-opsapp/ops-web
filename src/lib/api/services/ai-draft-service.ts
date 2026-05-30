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
import { BusinessContextService } from "./business-context-service";
import { FinancialIntelligenceService } from "./financial-intelligence-service";
import { AutonomyMilestoneService } from "./autonomy-milestone-service";
import { getDraftingOpenAI } from "./openai-clients";

function getOpenAI() {
  return getDraftingOpenAI();
}

/**
 * Lifecycle-draft learning switch.
 *
 * Gates the lifecycle-draft learning hook (`recordLifecycleDraftOutcome`),
 * whose only correct trigger is the operator-send transition of an
 * opportunity_follow_up_draft to status='sent' + final_sent_body. We NEVER
 * auto-send email, so the hook must not fire on any autonomous path — it is
 * invoked exclusively from the operator-send transition behind this flag:
 *
 *   if (LIFECYCLE_LEARNING_ENABLED) {
 *     await AIDraftService.recordLifecycleDraftOutcome(draftId, companyId, userId, finalBody, finalSubject);
 *   }
 *
 * Enabled at go-live: the operator-send transition now exists and ships in
 * this deploy, so the edit-learning pipeline activates on operator sends.
 * analyzeEditWithGPT only fires on >threshold-edited sends — negligible cost.
 */
export const LIFECYCLE_LEARNING_ENABLED = true;

// ─── Output Sanitization ────────────────────────────────────────────────────

/**
 * Strip stray markdown code fences from LLM-generated draft output.
 *
 * Even with explicit prompt rules forbidding fences, models occasionally
 * wrap the entire body in ```markdown ... ``` (the prompt used to ask for
 * "markdown format" which the model interpreted as "wrap as code"). We
 * strip defensively at the boundary so a model regression cannot leak
 * fences into the database, the composer, or outbound email.
 *
 * Idempotent: text without fences passes through unchanged. Fence-only
 * detection is anchored — fences inside the body (e.g. an inline code
 * block the user actually wants) survive.
 */
export function stripMarkdownFences(text: string): string {
  if (!text) return text;
  let s = text.trim();
  // Leading fence: ``` optionally followed by a language tag (markdown,
  // text, plain, etc.) and a newline.
  s = s.replace(/^```[a-zA-Z0-9_-]*\n?/, "");
  // Trailing fence.
  s = s.replace(/\n?```\s*$/, "");
  return s.trim();
}

// ─── Profile Type Detection ─────────────────────────────────────────────────

/**
 * Determine the writing profile type from thread/opportunity context.
 * Maps opportunity stage + thread signals to one of 10 profile types.
 */
function determineProfileType(
  opportunityStage?: string,
  recipientDomain?: string,
  threadSubject?: string,
): string {
  // Internal emails
  if (recipientDomain && recipientDomain.includes("opsapp")) return "internal";

  // Stage-based classification from opportunity
  if (opportunityStage) {
    const stage = opportunityStage.toLowerCase();
    if (stage === "new" || stage === "inquiry" || stage === "lead") return "client_new_inquiry";
    if (stage === "quoting" || stage === "estimate" || stage === "proposal") return "client_quoting";
    if (stage === "active" || stage === "in_progress" || stage === "won") return "client_active_project";
    if (stage === "follow_up" || stage === "followup" || stage === "closed") return "client_followup";
  }

  // Subject-based heuristics
  if (threadSubject) {
    const lower = threadSubject.toLowerCase();
    if (lower.includes("warranty") || lower.includes("defect") || lower.includes("repair")) return "warranty_claim";
    if (lower.includes("quote") || lower.includes("estimate") || lower.includes("pricing")) return "client_quoting";
    if (lower.includes("invoice") || lower.includes("payment") || lower.includes("billing")) return "client_active_project";
    if (lower.includes("order") || lower.includes("supply") || lower.includes("material")) return "vendor_ordering";
    if (lower.includes("sub") || lower.includes("coordinate") || lower.includes("schedule")) return "subtrade_coordination";
  }

  return "general";
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
  /** Explicit profile type override — bypasses heuristic detection */
  profileTypeOverride?: string;
  /**
   * P4-B: draft origin, mirrors opportunity_follow_up_drafts.origin vocab
   * ('operator' | 'template_follow_up' | 'phase_c' | 'system_handoff').
   * Persisted to ai_draft_history.origin. Callers: the Phase C router passes
   * 'phase_c'; the compose path passes 'operator'. Omitted → NULL (legacy).
   */
  origin?: "operator" | "template_follow_up" | "phase_c" | "system_handoff";
}

export interface AIDraftResult {
  draft: string;
  draftHistoryId: string;
  confidence: number;
  sources: string[];
  available: boolean;
  reason?: string;
  profileType?: string;
  /**
   * P4-B/P4-C: the subject line derived for this draft (Re: <thread subject>
   * for replies). Surfaced so the Phase C router can populate the paired
   * opportunity_follow_up_drafts row's subject.
   */
  subject?: string;
  /**
   * P4-B: the provider message id of the inbound message this draft replies
   * to (from the latest inbound activity). Persisted to
   * ai_draft_history.source_message_id.
   */
  sourceMessageId?: string | null;
  /**
   * True when the empty-response fallback path successfully escalated to
   * the operator (formulated a question + wrote it to
   * `email_threads.agent_blocking_question`). When set, callers should
   * surface the escalation rather than treat the unavailable draft as an
   * error.
   */
  escalated?: boolean;
}

/**
 * Context the escalation flow needs to formulate a useful operator
 * question. All fields are optional so the function degrades gracefully
 * when the calling site has incomplete state — but with too little
 * context Claude tends to ask vague questions, so prefer to pass at
 * minimum `lastInboundBody` and either `threadSubject` or
 * `opportunityContext`.
 */
export interface EscalationContext {
  companyId: string;
  /** Internal `email_threads.id` (uuid). Required to write back. */
  threadInternalId: string;
  clientName?: string;
  clientEmail?: string;
  threadSubject?: string;
  lastInboundBody?: string;
  /** Formatted "oldest first" thread history string, optional. */
  threadHistory?: string;
  opportunityContext?: string;
}

export interface EscalationResult {
  written: boolean;
  question?: string;
  options?: Array<{ id: string; label: string }>;
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
 * Full-spectrum: greeting, closing, tone, formality, structure, length.
 */
export function detectChanges(
  original: string,
  edited: string,
  subjects?: { original: string; edited: string }
): Array<{ type: string; from: string; to: string }> {
  const changes: Array<{ type: string; from: string; to: string }> = [];

  // P4-B: subject delta. RECORDED for visibility/analytics only — the
  // product decision is that operator subject edits do NOT auto-promote the
  // voice profile (learnFromEdits has no 'subject' branch, so this type is
  // intentionally inert in promotion). Subject lines are short and
  // high-variance; promoting them would be noisy.
  if (subjects) {
    const o = subjects.original.trim();
    const e = subjects.edited.trim();
    if (o !== e) {
      changes.push({ type: "subject", from: o, to: e });
    }
  }

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

  // Detect tone shift: exclamation marks
  const origExcl = (original.match(/!/g) || []).length;
  const editExcl = (edited.match(/!/g) || []).length;
  if (Math.abs(origExcl - editExcl) >= 2) {
    changes.push({
      type: "tone_exclamation",
      from: `${origExcl} exclamations`,
      to: `${editExcl} exclamations`,
    });
  }

  // Detect formality shift: contractions added/removed
  const contractionPattern = /\b(don't|won't|can't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|wouldn't|couldn't|shouldn't|didn't|it's|i'm|i'll|i've|we're|we'll|we've|they're|they'll|you're|you'll)\b/gi;
  const origContractions = (original.match(contractionPattern) || []).length;
  const editContractions = (edited.match(contractionPattern) || []).length;
  if (editContractions > origContractions + 1) {
    changes.push({ type: "formality_shift", from: "formal", to: "less_formal" });
  } else if (origContractions > editContractions + 1) {
    changes.push({ type: "formality_shift", from: "casual", to: "more_formal" });
  }

  // Detect structure change: bullets added/removed
  const origBullets = (original.match(/^\s*[-*•]\s/gm) || []).length;
  const editBullets = (edited.match(/^\s*[-*•]\s/gm) || []).length;
  if (editBullets > origBullets + 1) {
    changes.push({ type: "structure", from: "prose", to: "bullets" });
  } else if (origBullets > editBullets + 1) {
    changes.push({ type: "structure", from: "bullets", to: "prose" });
  }

  // Detect length change
  const origWords = original.split(/\s+/).length;
  const editWords = edited.split(/\s+/).length;
  const lengthRatio = editWords / (origWords || 1);
  if (lengthRatio < 0.6) {
    changes.push({ type: "length", from: `${origWords} words`, to: `${editWords} words (shortened)` });
  } else if (lengthRatio > 1.5) {
    changes.push({ type: "length", from: `${origWords} words`, to: `${editWords} words (lengthened)` });
  }

  return changes;
}

/**
 * GPT-based edit diff analysis for significant edits.
 * Detects tone shifts, phrasing substitutions, content corrections, and structure changes.
 * Only called when edit distance is >10% of word count (significant changes).
 */
async function analyzeEditWithGPT(
  original: string,
  edited: string
): Promise<{
  toneShift: string | null;
  substitutions: Array<{ from: string; to: string }>;
  structureChanges: string[];
  contentCorrections: string[];
} | null> {
  try {
    const openai = getOpenAI();
    const response = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        {
          role: "system",
          content: `Compare an AI-generated email draft with the human-edited final version. Identify systematic changes the human made. Return JSON:
{
  "toneShift": "more_formal" | "less_formal" | "more_direct" | "softer" | null,
  "substitutions": [{"from": "word/phrase in original", "to": "replacement in edited"}],
  "structureChanges": ["added bullets", "shortened paragraphs", etc.],
  "contentCorrections": ["added pricing info: $X per sqft", "removed incorrect claim about Y", etc.]
}
Only include systematic patterns, not one-off edits. substitutions should be word-for-word replacements that suggest a preference. contentCorrections are factual additions/removals.`,
        },
        {
          role: "user",
          content: `ORIGINAL DRAFT:\n${original.slice(0, 1500)}\n\nFINAL (HUMAN-EDITED) VERSION:\n${edited.slice(0, 1500)}`,
        },
      ],
      temperature: 0.1,
      max_completion_tokens: 200,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content);
  } catch (err) {
    console.error("[ai-draft] GPT edit analysis failed:", err);
    return null;
  }
}

// ─── Operator escalation ────────────────────────────────────────────────────
//
// Called from the empty-response fallback path when the LLM returned no
// usable draft. Asks the model to formulate a single thread-specific
// question (with optional 2-3 quick-pick options) and writes it to
// `email_threads.agent_blocking_question`. The lavender NEEDS_INPUT band
// in the inbox renders off that column.
//
// Defensive throughout: any failure returns `{ written: false }` with a
// reason and the caller falls back to its existing "draft unavailable"
// behavior. The escalation must never throw — `generateDraft` is hot in
// the autonomy router path and we don't want a second-call failure to
// surface as a visible error to the operator.

export async function escalateToOperatorQuestion(
  ctx: EscalationContext,
): Promise<EscalationResult> {
  const {
    companyId,
    threadInternalId,
    clientName,
    clientEmail,
    threadSubject,
    lastInboundBody,
    threadHistory,
    opportunityContext,
  } = ctx;

  if (!companyId || !threadInternalId) {
    return { written: false, reason: "missing companyId or threadInternalId" };
  }

  // Build context block. Cap each field so we don't blow the prompt budget
  // on threads with massive bodies. The empty-response path means the
  // primary draft already failed — keep this call cheap.
  const contextBlock = [
    clientName || clientEmail
      ? `Client: ${clientName ?? ""}${clientEmail ? ` <${clientEmail}>` : ""}`
      : "",
    threadSubject ? `Subject: ${threadSubject}` : "",
    opportunityContext ? `Opportunity:\n${opportunityContext.slice(0, 500)}` : "",
    lastInboundBody ? `Latest inbound message:\n${lastInboundBody.slice(0, 1500)}` : "",
    threadHistory ? `Thread history (oldest first):\n${threadHistory.slice(0, 2000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!contextBlock.trim()) {
    return { written: false, reason: "no context available to escalate" };
  }

  const systemPrompt = `You looked at an email thread but could not draft a reply. The operator needs to provide one piece of information so you can finish the draft.

Your job: formulate the SINGLE most important question to ask the operator. If the question has a clear set of likely answers (e.g., a deposit amount, a date, a yes/no), include 2-3 quick-pick options the operator can tap.

Rules:
- Question must be specific to this thread, not generic.
- Question must be answerable in one short reply (a number, a date, a name, a yes/no, etc.).
- Do not ask for general guidance — pick the SINGLE blocker.
- Quick-pick options are optional. Include them only when the answer space is naturally bounded.
- Return JSON: { "question": string, "options": [{ "id": string, "label": string }] | null }
- "id" should be a short slug like "opt-50-percent" or "opt-may-18".
- Maximum 3 options. Omit the field entirely or set it to null when free-form is the right ask.`;

  let parsed: { question?: unknown; options?: unknown } | null = null;
  try {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: contextBlock },
      ],
      temperature: 0.2,
      max_completion_tokens: 300,
      response_format: { type: "json_object" },
    });
    const content = response.choices[0]?.message?.content ?? "";
    if (!content) {
      return { written: false, reason: "escalation LLM returned empty content" };
    }
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("[ai-draft] escalation LLM call failed:", err);
    return {
      written: false,
      reason: err instanceof Error ? err.message : "escalation LLM call failed",
    };
  }

  if (!parsed) {
    return { written: false, reason: "escalation LLM returned unparseable JSON" };
  }

  const question = typeof parsed.question === "string" ? parsed.question.trim() : "";
  if (!question) {
    return { written: false, reason: "escalation LLM omitted question field" };
  }

  // Sanitize options. Anything non-conforming is silently dropped — better
  // to fall through to free-form than to render a malformed chip strip.
  let options: Array<{ id: string; label: string }> | undefined;
  if (Array.isArray(parsed.options)) {
    options = parsed.options
      .map((o) => {
        if (!o || typeof o !== "object") return null;
        const opt = o as Record<string, unknown>;
        const id = typeof opt.id === "string" ? opt.id.trim() : "";
        const label = typeof opt.label === "string" ? opt.label.trim() : "";
        if (!id || !label) return null;
        return { id, label };
      })
      .filter((o): o is { id: string; label: string } => o !== null)
      .slice(0, 3);
    if (options.length === 0) options = undefined;
  }

  // Persist. We don't gate on prior agent_blocking_question — overwriting
  // is the right call: if the LLM has new context (newer thread reply),
  // its newer question is what should drive the band. The
  // /agent-question/answer endpoint clears the column when the operator
  // answers, so we won't write into an already-answered window.
  const supabase = requireSupabase();
  const askedAt = new Date().toISOString();
  const payload = options
    ? { question, options, asked_at: askedAt }
    : { question, asked_at: askedAt };

  const { error } = await supabase
    .from("email_threads")
    .update({ agent_blocking_question: payload })
    .eq("id", threadInternalId)
    .eq("company_id", companyId);

  if (error) {
    console.error("[ai-draft] escalation write failed:", error);
    return {
      written: false,
      question,
      options,
      reason: `db write failed: ${error.message}`,
    };
  }

  return { written: true, question, options };
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

    // ── Fetch thread messages for context ───────────────────────────────
    let threadMessages: Array<{
      direction: string;
      from_email: string;
      subject: string;
      body_text: string;
      created_at: string;
      email_message_id: string | null;
    }> = [];

    if (threadId) {
      const { data: messages } = await supabase
        .from("activities")
        .select("direction, from_email, subject, body_text, created_at, email_message_id")
        .eq("company_id", companyId)
        .eq("email_thread_id", threadId)
        .eq("type", "email")
        .order("created_at", { ascending: true })
        .limit(20);

      threadMessages = (messages ?? []) as typeof threadMessages;
    }

    // ── Fetch opportunity context ──────────────────────────────────────
    let opportunityContext = "";
    let opportunityStage = "";
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
        opportunityStage = (opp.stage as string) || "";
        opportunityContext = [
          opp.title ? `Project: ${opp.title}` : "",
          opp.ai_summary ? `Summary: ${opp.ai_summary}` : "",
          opp.stage ? `Stage: ${opp.stage}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      }
    }

    // ── Determine profile type and get writing profile ─────────────────
    const threadSubject = threadMessages[0]?.subject || "";
    const recipientDomain = (clientEmail || recipientEmail || "").split("@")[1] || "";
    // Use userInstruction as fallback signal when no thread subject exists
    const subjectSignal = threadSubject || userInstruction || "";
    const profileType = req.profileTypeOverride ?? determineProfileType(opportunityStage, recipientDomain, subjectSignal);

    const profile = await WritingProfileService.getProfile(companyId, userId, profileType);
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

    // ── Memory + business context (optional — only if phase_c enabled) ─
    let memoryContext = "";
    let companyContextBlock = "";
    let clientContextBlock = "";
    let pricingContextBlock = "";
    let projectContextBlock = "";
    let financialContextBlock = "";
    const sources: string[] = ["writing_profile"];

    try {
      const phaseCEnabled =
        await AdminFeatureOverrideService.isAIFeatureEnabled(
          companyId,
          "phase_c"
        );
      if (phaseCEnabled) {
        // ── Semantic memory context ──────────────────────────────────────
        if (clientEmail) {
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

        // ── Live business data context (Layer 3) ────────────────────────
        // Company context — always included (lightweight)
        try {
          const companyCx = await BusinessContextService.getCompanyContext(companyId);
          if (companyCx.companyName !== "Unknown") {
            companyContextBlock = companyCx.summary;
            sources.push("company_data");
          }
        } catch {
          // Non-fatal — company context is supplementary
        }

        // Client context — if we have a client email
        if (clientEmail) {
          try {
            const clientCx = await BusinessContextService.getClientContext(companyId, clientEmail);
            if (clientCx.found) {
              clientContextBlock = clientCx.summary;
              sources.push("client_data");
            }
          } catch {
            // Non-fatal
          }
        }

        // Pricing context — if thread mentions pricing/quoting
        const threadText = threadMessages.map((m) => `${m.subject} ${m.body_text}`).join(" ").toLowerCase();
        const pricingSignals = ["quote", "estimate", "price", "pricing", "cost", "how much", "rate", "budget", "proposal"];
        const mentionsPricing = pricingSignals.some((signal) => threadText.includes(signal));
        if (mentionsPricing || (userInstruction && pricingSignals.some((s) => userInstruction.toLowerCase().includes(s)))) {
          try {
            const pricingCx = await BusinessContextService.getPricingContext(companyId);
            if (pricingCx.services.length > 0) {
              pricingContextBlock = pricingCx.summary;
              sources.push("pricing_data");
            }
          } catch {
            // Non-fatal
          }
        }

        // Financial intelligence context — for quoting/pricing and payment-related emails
        const paymentSignals = ["payment", "overdue", "invoice", "balance", "past due", "reminder", "collect"];
        const mentionsPayment = paymentSignals.some((s) => threadText.includes(s));
        if (mentionsPricing || mentionsPayment) {
          try {
            const financialParts: string[] = [];

            if (mentionsPricing) {
              // Include win rate data for quoting context
              const pricingOpt = await FinancialIntelligenceService.getPricingOptimization(companyId);
              for (const svc of pricingOpt.serviceAnalysis.slice(0, 3)) {
                financialParts.push(
                  `${svc.service}: ${svc.winRate}% win rate, avg winning estimate $${svc.avgWinPrice.toLocaleString()}`
                );
              }

              // Include seasonal context
              const seasonal = await FinancialIntelligenceService.getSeasonalPatterns(companyId);
              if (seasonal.peakMonths.length > 0) {
                const now = new Date();
                const currentMonth = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][now.getMonth()];
                const isPeak = seasonal.peakMonths.includes(currentMonth);
                const isSlow = seasonal.slowMonths.includes(currentMonth);
                if (isPeak) financialParts.push(`Current month (${currentMonth}) is a peak business period`);
                else if (isSlow) financialParts.push(`Current month (${currentMonth}) is typically a slower period`);
              }
            }

            if (mentionsPayment) {
              // Include cash flow context for payment-related emails
              const cashflow = await FinancialIntelligenceService.getCashFlowProjection(companyId, 30);
              if (cashflow.outstanding > 0) {
                financialParts.push(
                  `Total outstanding: $${cashflow.outstanding.toLocaleString()}, overdue: $${cashflow.overdue.toLocaleString()}`
                );
              }

              // Include client-specific payment history if we have their email
              if (clientEmail) {
                const clientCx = await BusinessContextService.getClientContext(companyId, clientEmail);
                if (clientCx.found && clientCx.invoices.overdue > 0) {
                  financialParts.push(
                    `This client has ${clientCx.invoices.overdue} overdue invoice(s) totaling $${clientCx.invoices.overdueAmount.toLocaleString()}`
                  );
                }
              }
            }

            if (financialParts.length > 0) {
              financialContextBlock = financialParts.join("\n");
              sources.push("financial_intelligence");
            }
          } catch {
            // Non-fatal — financial context is supplementary
          }
        }

        // Project context — if thread references a specific project via opportunity
        if (opportunityId) {
          try {
            // Look up project linked to this opportunity
            const { data: oppProject } = await supabase
              .from("projects")
              .select("id")
              .eq("company_id", companyId)
              .eq("opportunity_id", opportunityId)
              .is("deleted_at", null)
              .limit(1)
              .single();

            if (oppProject) {
              const projectCx = await BusinessContextService.getProjectContext(
                companyId,
                oppProject.id as string
              );
              if (projectCx.found) {
                projectContextBlock = projectCx.summary;
                sources.push("project_data");
              }
            }
          } catch {
            // Non-fatal
          }
        }
      }
    } catch {
      // Memory + business context is optional — don't fail the draft
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

    // ── Build system prompt with all 12 writing dimensions ─────────────
    const greetings = (profile?.greeting_patterns as string[]) || [];
    const closings = (profile?.closing_patterns as string[]) || [];
    const toneTraits = profile?.tone_traits || {};
    const avgSentLen = (profile?.avg_sentence_length as number) || 15;
    const formality = (profile?.formality_score as number) || 0.6;
    const vocabPrefs = (profile?.vocabulary_preferences as Record<string, unknown>) || {};

    // Extract 12-dimension sub-objects from vocabulary_preferences
    const paragraphStructure = vocabPrefs.paragraph_structure as Record<string, unknown> | undefined;
    const hedgingTendency = typeof vocabPrefs.hedging_tendency === "number" ? vocabPrefs.hedging_tendency as number : null;
    const punctuationHabits = vocabPrefs.punctuation_habits as Record<string, number> | undefined;
    const vocabComplexity = vocabPrefs.vocabulary_complexity as Record<string, unknown> | undefined;
    const engagementStyle = vocabPrefs.engagement_style as Record<string, number> | undefined;
    const emailLengthData = vocabPrefs.email_length as Record<string, unknown> | undefined;
    const substitutions = vocabPrefs.substitutions as Record<string, string> | undefined;

    // Extract response_structure from tone_traits (dimension 10)
    const normalizedTraits = Array.isArray(toneTraits)
      ? Object.fromEntries((toneTraits as string[]).map((t) => [t, true]))
      : (toneTraits as Record<string, unknown>);
    const responseStructure = normalizedTraits.response_structure as Record<string, string> | undefined;
    const traitLabels = Object.entries(normalizedTraits)
      .filter(([k, v]) => k !== "response_structure" && v === true)
      .map(([k]) => k);

    // Format tone traits as readable string
    const toneString = traitLabels.length > 0 ? traitLabels.join(", ") : "neutral";

    const systemPrompt = `You are drafting an email reply for a trades business owner. Write in THEIR exact voice and style. The draft must be indistinguishable from an email they would write themselves.

WRITING VOICE (12 dimensions — match ALL of these):

1. FORMALITY: ${formality.toFixed(2)}/1.0 (0=very casual, 1=very formal)
2. SENTENCE LENGTH: Average ${avgSentLen.toFixed(0)} words per sentence
3. PARAGRAPH STRUCTURE: ${paragraphStructure ? `${(paragraphStructure.prefersBullets as boolean) ? "Prefers bullet points" : "Prefers prose paragraphs"}, avg ${((paragraphStructure.avgParagraphLines as number) || 3).toFixed(1)} lines per paragraph` : "Standard paragraphs"}
4. HEDGING: ${hedgingTendency !== null ? `${(hedgingTendency * 100).toFixed(0)}% of sentences use hedging ("maybe", "I think", "perhaps")` : "Unknown"}${hedgingTendency !== null && hedgingTendency < 0.1 ? " — this person is DIRECT, avoid hedging language" : ""}
5. PUNCTUATION: ${punctuationHabits ? `Exclamations: ${(punctuationHabits.exclamation_marks || 0).toFixed(1)}/email, Em-dashes: ${(punctuationHabits.em_dashes || 0).toFixed(1)}/email, Semicolons: ${(punctuationHabits.semicolons || 0).toFixed(1)}/email, Ellipsis: ${(punctuationHabits.ellipsis || 0).toFixed(1)}/email` : "Standard"}
6. VOCABULARY: ${vocabComplexity ? `Avg word length ${(vocabComplexity.avgWordLength as number || 4.5).toFixed(1)} chars, ${(vocabComplexity.usesTradeJargon as boolean) ? "uses trade jargon freely" : "avoids jargon"}` : "Standard vocabulary"}
7. ENGAGEMENT: ${engagementStyle ? `${(engagementStyle.questionsPerEmail || 0).toFixed(1)} questions/email, ${((engagementStyle.directAddressFreq || 0) * 100).toFixed(0)}% "you/your", ${((engagementStyle.firstPersonFreq || 0) * 100).toFixed(0)}% "I/we"` : "Standard engagement"}
8. GREETING: ${greetings[0] || "Hi {name},"}${greetings.length > 1 ? ` (alternatives: ${greetings.slice(1, 3).join(", ")})` : ""}
9. SIGN-OFF: ${closings[0] || "Cheers,"}${closings.length > 1 ? ` (alternatives: ${closings.slice(1, 3).join(", ")})` : ""}
10. RESPONSE STRUCTURE: ${responseStructure ? `Opens with: ${responseStructure.openingStyle || "business"}, Transitions: ${responseStructure.transitionStyle || "natural"}, Pre-closing: ${responseStructure.preClosingStyle || "call to action"}` : "Standard structure"}
11. TONE: ${toneString}
12. EMAIL LENGTH: ${emailLengthData ? `Average ${((emailLengthData.avgWordCount as number) || 100).toFixed(0)} words` : "Medium length"}

${substitutions && Object.keys(substitutions).length > 0 ? `WORD PREFERENCES (always use the right-side word):\n${Object.entries(substitutions).map(([from, to]) => `- "${from}" → "${to}"`).join("\n")}\n` : ""}
${companyContextBlock ? `YOUR COMPANY:\n${companyContextBlock}\n` : ""}
${clientContextBlock ? `CLIENT HISTORY:\n${clientContextBlock}\n` : ""}
${pricingContextBlock ? `PRICING DATA:\n${pricingContextBlock}\n` : ""}
${financialContextBlock ? `FINANCIAL INTELLIGENCE:\n${financialContextBlock}\n` : ""}
${projectContextBlock ? `PROJECT DETAILS:\n${projectContextBlock}\n` : ""}
${opportunityContext ? `OPPORTUNITY:\n${opportunityContext}\n` : ""}
${memoryContext ? `LEARNED KNOWLEDGE:\n${memoryContext}\n` : ""}

RULES:
- Do NOT mention AI or that this is auto-generated
- Match the owner's voice EXACTLY across ALL 12 dimensions above
- Match their punctuation habits precisely — if they rarely use exclamation marks, DO NOT add them
- Match their hedging level — if they're direct, be direct; if they hedge, hedge similarly
- Use their preferred word substitutions if listed above
- Include relevant business details if available from context
- Output ONLY the email body itself. Do NOT wrap the response in markdown code fences (\`\`\`), do NOT prefix with "Here's the draft:" or similar intros, do NOT include a subject line
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
      max_completion_tokens: 800,
    });

    const draft = stripMarkdownFences(response.choices[0]?.message?.content || "");

    if (!draft) {
      // Empty draft — try to escalate to the operator with a thread-specific
      // question instead of silently failing. Only attempts when we have a
      // resolvable internal thread.id (we get the provider thread id from
      // the request and have to look up the row). Skipping the lookup when
      // we don't know companyId/threadId leaves the existing
      // "AI returned empty response" behavior in place.
      let escalated = false;
      if (threadId) {
        const { data: threadRow } = await supabase
          .from("email_threads")
          .select("id")
          .eq("company_id", companyId)
          .eq("provider_thread_id", threadId)
          .maybeSingle();
        const threadInternalId = (threadRow?.id as string | undefined) ?? null;
        if (threadInternalId) {
          // Reuse the same context we built for the draft prompt — no need
          // to refetch. The escalation function caps each field internally
          // so passing the full bodies is safe.
          const lastInbound = threadMessages
            .filter((m) => m.direction === "inbound")
            .pop();
          const formattedHistory = threadMessages
            .map((m) => `[${m.direction}] ${m.subject}\n${m.body_text?.slice(0, 400) || ""}`)
            .join("\n\n");
          const result = await escalateToOperatorQuestion({
            companyId,
            threadInternalId,
            clientName,
            clientEmail,
            threadSubject: lastInbound?.subject || threadMessages[0]?.subject,
            lastInboundBody: lastInbound?.body_text,
            threadHistory: formattedHistory,
            opportunityContext,
          });
          escalated = result.written;
        }
      }
      return {
        draft: "",
        draftHistoryId: "",
        confidence,
        sources,
        available: false,
        reason: escalated ? "escalated_to_operator" : "AI returned empty response",
        escalated,
      };
    }

    // ── Derive subject + source message provenance (P4-B) ──────────────
    // Subject: reply to the latest inbound's subject (Re: …), else fall back
    // to the thread's first subject. Source message id: the provider message
    // id of the latest inbound activity — the message this draft replies to.
    const replySource = threadMessages
      .filter((m) => m.direction === "inbound")
      .pop();
    const baseSubject =
      replySource?.subject || threadMessages[0]?.subject || "";
    const derivedSubject = baseSubject
      ? baseSubject.toLowerCase().startsWith("re:")
        ? baseSubject
        : `Re: ${baseSubject}`
      : "";
    const sourceMessageId = replySource?.email_message_id ?? null;

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
        profile_type: profileType,
        status: "drafted",
        // P4-B provenance columns (additive, nullable).
        subject: derivedSubject || null,
        subject_source: derivedSubject ? "generated" : null,
        source_message_id: sourceMessageId,
        origin: req.origin ?? null,
      })
      .select("id")
      .single();

    return {
      draft,
      draftHistoryId: historyRow?.id || "",
      confidence,
      sources,
      available: true,
      profileType,
      subject: derivedSubject || undefined,
      sourceMessageId,
    };
  },

  /**
   * Record the final version after user sends (or discards) an AI draft.
   * Computes edit distance, detected changes, and GPT diff analysis for significant edits.
   * Feeds back into writing profile learning across all dimensions.
   */
  async recordDraftOutcome(
    draftHistoryId: string,
    companyId: string,
    userId: string,
    outcome: "sent" | "discarded" | "superseded",
    finalVersion?: string,
    profileType: string = "general",
    /**
     * P4-B/P4-D: the operator-edited subject at send time. When provided and
     * different from the stored subject, a `subject` change is RECORDED in
     * changes_made and subject_source flips to 'operator'. Per the product
     * decision, subject edits never auto-promote the voice profile.
     */
    finalSubject?: string
  ): Promise<void> {
    const supabase = requireSupabase();
    const now = new Date().toISOString();

    // Fetch original draft, its profile type, and stored subject
    const { data: history } = await supabase
      .from("ai_draft_history")
      .select("original_draft, profile_type, subject")
      .eq("id", draftHistoryId)
      .eq("company_id", companyId)
      .single();

    if (!history) return;

    const original = history.original_draft as string;
    const storedSubject = (history.subject as string | null) ?? "";
    // Use stored profile_type from when the draft was generated
    const effectiveProfileType = (history.profile_type as string) || profileType;

    if (outcome === "discarded" || outcome === "superseded") {
      // P4-B: stamp discarded_at on both discard and supersede (a draft
      // retired by a newer one is, for provenance purposes, discarded with a
      // distinct status).
      await supabase
        .from("ai_draft_history")
        .update({ status: outcome, discarded_at: now })
        .eq("id", draftHistoryId);
      return;
    }

    // outcome === "sent"
    const final = finalVersion || original;
    const distance = editDistance(original, final);
    const bodyUnchanged = original.trim() === final.trim();
    const subjectEdited =
      finalSubject !== undefined &&
      finalSubject.trim() !== storedSubject.trim();
    const noChanges = bodyUnchanged && !subjectEdited;
    const changes = noChanges
      ? []
      : detectChanges(
          original,
          final,
          finalSubject !== undefined
            ? { original: storedSubject, edited: finalSubject }
            : undefined
        );

    // GPT-based analysis for significant BODY edits (>10% words changed).
    // Gated on body change only — a subject-only edit must not trigger an LLM
    // call (it would diff two identical bodies and burn tokens for nothing).
    const origWordCount = original.split(/\s+/).length || 1;
    let gptAnalysis: Awaited<ReturnType<typeof analyzeEditWithGPT>> = null;
    if (!bodyUnchanged && distance / origWordCount > 0.1) {
      gptAnalysis = await analyzeEditWithGPT(original, final);
    }

    // Merge GPT analysis into changes
    const enrichedChanges = [...changes];
    if (gptAnalysis) {
      if (gptAnalysis.toneShift) {
        enrichedChanges.push({ type: "tone_shift", from: "original", to: gptAnalysis.toneShift });
      }
      for (const sub of gptAnalysis.substitutions || []) {
        enrichedChanges.push({ type: "substitution", from: sub.from, to: sub.to });
      }
      for (const sc of gptAnalysis.structureChanges || []) {
        enrichedChanges.push({ type: "structure_gpt", from: "", to: sc });
      }
      for (const cc of gptAnalysis.contentCorrections || []) {
        enrichedChanges.push({ type: "content_correction", from: "", to: cc });
      }
    }

    const sentUpdate: Record<string, unknown> = {
      final_version: final,
      edit_distance: distance,
      changes_made: enrichedChanges,
      sent_without_changes: noChanges,
      status: "sent",
      sent_at: now,
    };
    // P4-B: stamp edited_at when the operator changed anything (body or
    // subject) before sending.
    if (!noChanges) {
      sentUpdate.edited_at = now;
    }
    // P4-B/P4-D: record the operator's final subject. subject_source flips to
    // 'operator' on an edit (RECORDED only — never promotes the profile).
    if (subjectEdited) {
      sentUpdate.subject = finalSubject;
      sentUpdate.subject_source = "operator";
    }

    await supabase
      .from("ai_draft_history")
      .update(sentUpdate)
      .eq("id", draftHistoryId);

    // Feed changes back into writing profile learning (per profile type).
    // Skip when the ONLY edit is a subject change: per the product decision
    // subject edits never promote the voice profile (learnFromEdits has no
    // 'subject' branch), so calling it for a subject-only edit is a wasted DB
    // round-trip that can never mutate the profile. Subject deltas remain
    // recorded in changes_made above for analytics.
    if (enrichedChanges.some((c) => c.type !== "subject")) {
      await this.learnFromEdits(companyId, userId, enrichedChanges, effectiveProfileType);
    }

    // Store content corrections as high-priority agent_memories
    if (gptAnalysis?.contentCorrections?.length) {
      for (const correction of gptAnalysis.contentCorrections) {
        try {
          await supabase.from("agent_memories").insert({
            company_id: companyId,
            content: correction,
            category: "correction",
            memory_type: "correction",
            confidence: 0.9,
            source: "draft_edit",
            decay_score: 1.0,
          });
        } catch {
          // Non-fatal — correction memory is supplementary
        }
      }
    }

    // E5: Check autonomy milestones after draft feedback
    // Look up connectionId from the draft history to pass to milestone service
    try {
      const { data: draftRecord } = await supabase
        .from("ai_draft_history")
        .select("connection_id")
        .eq("id", draftHistoryId)
        .single();

      if (draftRecord?.connection_id && userId) {
        AutonomyMilestoneService.checkMilestonesAfterDraftFeedback(
          companyId,
          userId,
          draftRecord.connection_id as string,
        ).catch((err) => {
          console.error("[ai-draft] Milestone check failed (non-fatal):", err);
        });
      }
    } catch {
      // Non-fatal — milestone check is supplementary
    }
  },

  /**
   * P4-D — learn from an operator-SENT lifecycle (template_follow_up / phase_c)
   * draft.
   *
   * Trigger contract: this MUST be called ONLY on the operator-send path of a
   * lifecycle draft — the moment the draft transitions to status='sent' with
   * a final_sent_body. We NEVER auto-send email, so this never fires on an
   * autonomous path. Learning happens only from SENT drafts, never from
   * abandoned/discarded ones (bible §10 line 1809).
   *
   * The lifecycle-draft send-transition itself (flipping
   * opportunity_follow_up_drafts to status='sent' + final_sent_body) is owned
   * by P3 and does NOT yet exist in this worktree (no code writes
   * final_sent_body; grep confirms 0 call sites). Therefore this method is
   * built complete but its invocation is DEFERRED behind
   * LIFECYCLE_LEARNING_ENABLED until the P3 send-transition lands and calls it.
   * When P3 lands, the send-transition site calls this with the operator's
   * final body + subject; no further change to this method is needed.
   *
   * Bridging: template_follow_up drafts have ai_draft_history_id IS NULL
   * today (they were never AI-generated). To run the existing delta+learn
   * pipeline we create a bridging ai_draft_history row (origin='template_
   * follow_up') whose original_draft is the draft's original_body, link it
   * back via ai_draft_history_id, then delegate to recordDraftOutcome. phase_c
   * drafts already carry a bridge from creation, so we reuse it.
   *
   * Subject edits: RECORDED (recordDraftOutcome stamps subject_source=
   * 'operator' + a 'subject' change) but NEVER auto-promote the voice profile.
   */
  async recordLifecycleDraftOutcome(
    followUpDraftId: string,
    companyId: string,
    userId: string,
    finalBody: string,
    finalSubject?: string
  ): Promise<void> {
    const supabase = requireSupabase();

    // Resolve the lifecycle draft. Must be a real, company-scoped row.
    const { data: draftRow } = await supabase
      .from("opportunity_follow_up_drafts")
      .select(
        "id, company_id, opportunity_id, connection_id, provider_thread_id, origin, subject, original_body, ai_draft_history_id"
      )
      .eq("id", followUpDraftId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (!draftRow) return;

    let bridgeId = (draftRow.ai_draft_history_id as string | null) ?? null;

    // Create a bridging ai_draft_history row for never-AI-generated template
    // drafts so the delta+learn pipeline has a row to record against.
    if (!bridgeId) {
      const originalBody = (draftRow.original_body as string) ?? "";
      const { data: bridge } = await supabase
        .from("ai_draft_history")
        .insert({
          company_id: companyId,
          user_id: userId,
          opportunity_id: (draftRow.opportunity_id as string | null) ?? null,
          connection_id: (draftRow.connection_id as string | null) ?? null,
          thread_id: (draftRow.provider_thread_id as string | null) ?? null,
          original_draft: originalBody,
          profile_type: "client_followup",
          status: "drafted",
          subject: (draftRow.subject as string | null) ?? null,
          subject_source: draftRow.subject ? "generated" : null,
          origin: (draftRow.origin as string | null) ?? "template_follow_up",
        })
        .select("id")
        .single();

      bridgeId = (bridge?.id as string | undefined) ?? null;
      if (!bridgeId) return;

      // Link the bridge back onto the lifecycle draft so the relationship is
      // durable (and idempotent on a retry).
      await supabase
        .from("opportunity_follow_up_drafts")
        .update({ ai_draft_history_id: bridgeId })
        .eq("id", followUpDraftId)
        .eq("company_id", companyId);
    }

    // Delegate to the existing pipeline. recordDraftOutcome computes the
    // generated-vs-sent delta against the bridge's original_draft, runs the
    // GPT analysis gate, flips the bridge to 'sent', and calls
    // learnFromEdits(..., 'client_followup'). The bridge's stored profile_type
    // ('client_followup') is what learnFromEdits scopes to.
    await this.recordDraftOutcome(
      bridgeId,
      companyId,
      userId,
      "sent",
      finalBody,
      "client_followup",
      finalSubject
    );
  },

  /**
   * Full-spectrum edit learning.
   * Learns from ALL types of edits: greetings, closings, tone shifts,
   * phrasing substitutions, formality direction, and structure preferences.
   * Thresholds: 3 for hard prefs (greeting/closing/substitution), 5 for soft (tone/structure).
   */
  async learnFromEdits(
    companyId: string,
    userId: string,
    changes: Array<{ type: string; from: string; to: string }>,
    profileType: string = "general"
  ): Promise<void> {
    const supabase = requireSupabase();

    // Fetch recent edit patterns (last 20 drafts), scoped by profile type
    let draftsQuery = supabase
      .from("ai_draft_history")
      .select("changes_made")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("status", "sent")
      .not("changes_made", "eq", "[]")
      .order("created_at", { ascending: false })
      .limit(20);

    // Scope to profile type for per-relationship learning.
    // "general" intentionally learns from ALL profile types — it's the catch-all
    // learner that aggregates cross-relationship patterns. Type-specific profiles
    // only learn from their own drafts to capture per-relationship preferences.
    if (profileType !== "general") {
      draftsQuery = draftsQuery.eq("profile_type", profileType);
    }

    const { data: recentDrafts } = await draftsQuery;

    if (!recentDrafts || recentDrafts.length < 3) return;

    // Aggregate all change patterns from recent drafts
    const greetingChanges = new Map<string, number>();
    const closingChanges = new Map<string, number>();
    const toneShifts = new Map<string, number>();
    const substitutionCounts = new Map<string, { to: string; count: number }>();
    let structureToBullets = 0;
    let structureToProse = 0;
    let lengthShortened = 0;
    let lengthLengthened = 0;
    let formalityMoreFormal = 0;
    let formalityLessFormal = 0;

    for (const row of recentDrafts) {
      const rowChanges = (row.changes_made as Array<{ type: string; from: string; to: string }>) || [];
      for (const c of rowChanges) {
        switch (c.type) {
          case "greeting":
            if (c.to) greetingChanges.set(c.to, (greetingChanges.get(c.to) || 0) + 1);
            break;
          case "closing":
            if (c.to) closingChanges.set(c.to, (closingChanges.get(c.to) || 0) + 1);
            break;
          case "tone_shift":
            if (c.to) toneShifts.set(c.to, (toneShifts.get(c.to) || 0) + 1);
            break;
          case "tone_exclamation": {
            // Parse exclamation counts from "N exclamations" format
            const origCount = parseInt(c.from) || 0;
            const editCount = parseInt(c.to) || 0;
            if (editCount < origCount) {
              // User removed exclamations → prefers fewer
              toneShifts.set("fewer_exclamations", (toneShifts.get("fewer_exclamations") || 0) + 1);
            } else if (editCount > origCount) {
              toneShifts.set("more_exclamations", (toneShifts.get("more_exclamations") || 0) + 1);
            }
            break;
          }
          case "formality_shift":
            if (c.to === "more_formal") formalityMoreFormal++;
            else if (c.to === "less_formal") formalityLessFormal++;
            break;
          case "substitution":
            if (c.from && c.to) {
              const key = c.from.toLowerCase();
              const existing = substitutionCounts.get(key);
              if (existing && existing.to === c.to.toLowerCase()) {
                existing.count++;
              } else if (!existing) {
                substitutionCounts.set(key, { to: c.to.toLowerCase(), count: 1 });
              }
            }
            break;
          case "structure":
            if (c.to === "bullets") structureToBullets++;
            else if (c.to === "prose") structureToProse++;
            break;
          case "structure_gpt":
            if (c.to?.toLowerCase().includes("bullet")) structureToBullets++;
            if (c.to?.toLowerCase().includes("shorten")) lengthShortened++;
            break;
          case "length":
            if (c.to?.includes("shortened")) lengthShortened++;
            else if (c.to?.includes("lengthened")) lengthLengthened++;
            break;
        }
      }
    }

    // Fetch current profile
    const { data: profile } = await supabase
      .from("agent_writing_profiles")
      .select("id, greeting_patterns, closing_patterns, formality_score, vocabulary_preferences")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("profile_type", profileType)
      .single();

    if (!profile) return;

    const updates: Record<string, unknown> = {};
    const vocabPrefs = (profile.vocabulary_preferences as Record<string, unknown>) || {};

    // ── Hard preferences (threshold: 3) ─────────────────────────────────

    // Greeting promotion
    for (const [greeting, count] of greetingChanges) {
      if (count >= 3) {
        const patterns = (profile.greeting_patterns as string[]) || [];
        const filtered = patterns.filter((p) => p !== greeting);
        updates.greeting_patterns = [greeting, ...filtered].slice(0, 10);
        break;
      }
    }

    // Closing promotion
    for (const [closing, count] of closingChanges) {
      if (count >= 3) {
        const patterns = (profile.closing_patterns as string[]) || [];
        const filtered = patterns.filter((p) => p !== closing);
        updates.closing_patterns = [closing, ...filtered].slice(0, 10);
        break;
      }
    }

    // Phrasing substitutions (3+ consistent changes to same replacement)
    const existingSubs = (vocabPrefs.substitutions as Record<string, string>) || {};
    let subsUpdated = false;
    for (const [from, { to, count }] of substitutionCounts) {
      if (count >= 3) {
        existingSubs[from] = to;
        subsUpdated = true;
      }
    }
    if (subsUpdated) {
      vocabPrefs.substitutions = existingSubs;
      updates.vocabulary_preferences = vocabPrefs;
    }

    // ── Soft preferences (threshold: 5) ──────────────────────────────────

    // Formality direction
    if (formalityMoreFormal >= 5) {
      const currentFormality = (profile.formality_score as number) || 0.5;
      updates.formality_score = Math.min(1.0, currentFormality + 0.1);
    } else if (formalityLessFormal >= 5) {
      const currentFormality = (profile.formality_score as number) || 0.5;
      updates.formality_score = Math.max(0.0, currentFormality - 0.1);
    }

    // Tone shift direction (from GPT analysis)
    for (const [shift, count] of toneShifts) {
      if (count >= 5) {
        if (shift === "more_formal" || shift === "less_formal") {
          const currentFormality = (updates.formality_score as number) ?? (profile.formality_score as number) ?? 0.5;
          updates.formality_score = shift === "more_formal"
            ? Math.min(1.0, currentFormality + 0.1)
            : Math.max(0.0, currentFormality - 0.1);
        }
        // Other tone shifts stored for reference but don't auto-adjust numerical scores
      }
    }

    // Structure preference
    if (structureToBullets >= 5) {
      const paragraphStructure = (vocabPrefs.paragraph_structure as Record<string, unknown>) || {};
      paragraphStructure.prefersBullets = true;
      vocabPrefs.paragraph_structure = paragraphStructure;
      updates.vocabulary_preferences = vocabPrefs;
    } else if (structureToProse >= 5) {
      const paragraphStructure = (vocabPrefs.paragraph_structure as Record<string, unknown>) || {};
      paragraphStructure.prefersBullets = false;
      vocabPrefs.paragraph_structure = paragraphStructure;
      updates.vocabulary_preferences = vocabPrefs;
    }

    // Exclamation preference (from tone_exclamation tracking)
    const fewerExcl = toneShifts.get("fewer_exclamations") || 0;
    const moreExcl = toneShifts.get("more_exclamations") || 0;
    if (fewerExcl >= 5 || moreExcl >= 5) {
      const punctHabits = (vocabPrefs.punctuation_habits as Record<string, number>) || {};
      const current = punctHabits.exclamation_marks ?? 1.0;
      if (fewerExcl >= 5) {
        punctHabits.exclamation_marks = Math.max(0, current - 0.5);
      } else {
        punctHabits.exclamation_marks = current + 0.5;
      }
      vocabPrefs.punctuation_habits = punctHabits;
      updates.vocabulary_preferences = vocabPrefs;
    }

    // Apply updates
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
