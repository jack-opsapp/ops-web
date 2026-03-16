// src/lib/api/services/memory-service.ts
// Memory service — extracts facts, updates knowledge graph, queries memory.
// Uses OpenAI for extraction + Supabase pgvector for storage.

import { requireSupabase } from "@/lib/supabase/helpers";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface MemoryFact {
  id: string;
  type: string;
  category: string;
  content: string;
  confidence: number;
  source: string;
}

// ─── Module-level helpers ───────────────────────────────────────────────────

async function extractFacts(
  email: { from: string; to: string[]; subject: string; bodyText: string }
): Promise<{
  facts: Array<{
    type: string;
    category: string;
    content: string;
    confidence: number;
  }>;
  edges: Array<{
    subjectType: string;
    subjectId: string;
    predicate: string;
    objectType: string;
    objectId: string;
    properties: Record<string, unknown>;
  }>;
}> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Extract business facts from this outbound email. Return ONLY new/notable facts — skip generic pleasantries.

Categories: pricing, service_capability, limitation, promotion, service_area, material, process, timeline

Return JSON: { "facts": [{"type":"fact","category":"...","content":"...","confidence":0.9}], "edges": [{"subjectType":"person","subjectId":"email","predicate":"quoted_for","objectType":"service","objectId":"railing","properties":{"price":3225}}] }

Be concise. 1-2 sentences per fact max. Only extract facts that would be useful for future email drafting or pricing.`,
        },
        {
          role: "user",
          content: `From: ${email.from}\nTo: ${email.to.join(", ")}\nSubject: ${email.subject}\n\n${email.bodyText.slice(0, 1000)}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const content =
      response.choices[0]?.message?.content || '{"facts":[],"edges":[]}';
    return JSON.parse(content);
  } catch (err) {
    console.error("[memory-service] Fact extraction failed:", err);
    return { facts: [], edges: [] };
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

export const MemoryService = {
  /**
   * Process an outbound email and extract memory facts.
   * Called by the sync engine for every outbound email when ai_email_memory is enabled.
   */
  async processOutboundEmail(
    companyId: string,
    userId: string,
    email: {
      from: string;
      to: string[];
      subject: string;
      bodyText: string;
      date: string;
    }
  ): Promise<void> {
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(
      companyId,
      "ai_email_memory"
    );
    if (!enabled) return;

    const supabase = requireSupabase();
    const extraction = await extractFacts(email);

    // Store extracted facts
    for (const fact of extraction.facts) {
      // Check for duplicate/existing fact before inserting
      const { data: existing } = await supabase
        .from("agent_memories")
        .select("id, confidence")
        .eq("company_id", companyId)
        .eq("category", fact.category)
        .ilike("content", `%${fact.content.slice(0, 50)}%`)
        .limit(1);

      if (existing && existing.length > 0) {
        // Reinforce existing fact
        const current = existing[0];
        await supabase
          .from("agent_memories")
          .update({
            confidence: Math.min(
              1.0,
              ((current.confidence as number) || 0.5) + 0.05
            ),
            last_accessed_at: new Date().toISOString(),
            access_count: ((current as Record<string, unknown>).access_count as number || 0) + 1,
          })
          .eq("id", current.id);
      } else {
        await supabase.from("agent_memories").insert({
          company_id: companyId,
          user_id: userId,
          memory_type: fact.type,
          category: fact.category,
          content: fact.content,
          confidence: fact.confidence,
          source: "email",
          source_id: email.date,
        });
      }
    }

    // Update knowledge graph edges
    for (const edge of extraction.edges) {
      await supabase
        .from("agent_knowledge_graph")
        .upsert(
          {
            company_id: companyId,
            subject_type: edge.subjectType,
            subject_id: edge.subjectId,
            predicate: edge.predicate,
            object_type: edge.objectType,
            object_id: edge.objectId,
            properties: edge.properties,
            valid_from: new Date().toISOString(),
          },
          {
            onConflict:
              "company_id,subject_type,subject_id,predicate,object_type,object_id",
          }
        )
        .then(null, (err) => {
          console.error("[memory-service] Knowledge graph upsert failed:", err);
        });
    }
  },

  /**
   * Query memory for context relevant to drafting a reply.
   */
  async getContextForDraft(
    companyId: string,
    clientEmail: string,
    _projectDescription: string
  ): Promise<{
    relevantFacts: MemoryFact[];
    clientHistory: Record<string, unknown>[];
    currentPromotions: string[];
    pricingReferences: string[];
  }> {
    const supabase = requireSupabase();

    const { data: pricingFacts } = await supabase
      .from("agent_memories")
      .select("*")
      .eq("company_id", companyId)
      .eq("category", "pricing")
      .order("confidence", { ascending: false })
      .limit(10);

    const { data: promotions } = await supabase
      .from("agent_memories")
      .select("*")
      .eq("company_id", companyId)
      .eq("category", "promotion")
      .gt("confidence", 0.5)
      .limit(5);

    const { data: limitations } = await supabase
      .from("agent_memories")
      .select("*")
      .eq("company_id", companyId)
      .eq("category", "limitation")
      .limit(10);

    const { data: clientEdges } = await supabase
      .from("agent_knowledge_graph")
      .select("*")
      .eq("company_id", companyId)
      .eq("subject_id", clientEmail)
      .is("valid_to", null);

    return {
      relevantFacts: [
        ...((pricingFacts as Record<string, unknown>[]) || []),
        ...((limitations as Record<string, unknown>[]) || []),
      ].map((f) => ({
        id: f.id as string,
        type: f.memory_type as string,
        category: f.category as string,
        content: f.content as string,
        confidence: f.confidence as number,
        source: f.source as string,
      })),
      clientHistory: (clientEdges as Record<string, unknown>[]) || [],
      currentPromotions: ((promotions as Record<string, unknown>[]) || []).map(
        (p) => p.content as string
      ),
      pricingReferences: (
        (pricingFacts as Record<string, unknown>[]) || []
      ).map((p) => p.content as string),
    };
  },

  /**
   * Get memory stats for admin panel.
   */
  async getStats(companyId: string): Promise<{
    factsCount: number;
    graphEdgesCount: number;
    profilesCount: number;
  }> {
    const supabase = requireSupabase();

    const [facts, edges, profiles] = await Promise.all([
      supabase
        .from("agent_memories")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      supabase
        .from("agent_knowledge_graph")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      supabase
        .from("agent_writing_profiles")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
    ]);

    return {
      factsCount: facts.count || 0,
      graphEdgesCount: edges.count || 0,
      profilesCount: profiles.count || 0,
    };
  },

  /**
   * Reset all memory for a company (admin action).
   */
  async resetMemory(companyId: string): Promise<void> {
    const supabase = requireSupabase();

    await Promise.all([
      supabase.from("agent_memories").delete().eq("company_id", companyId),
      supabase
        .from("agent_knowledge_graph")
        .delete()
        .eq("company_id", companyId),
      supabase
        .from("agent_writing_profiles")
        .delete()
        .eq("company_id", companyId),
    ]);
  },
};
