/**
 * POST /api/integrations/ai-setup/extract-facts
 *
 * Sprint E3.1: Extracts structured business facts from a user's natural language
 * response during the intake interview. Stores facts in agent_memories and
 * entities/relationships in agent_knowledge_graph.
 *
 * For question 8 (example emails), also seeds the writing profile via
 * WritingProfileService.updateFromEmail().
 *
 * Gated behind phase_c feature flag.
 * Requires Firebase-authenticated user session.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { AdminFeatureOverrideService } from "@/lib/api/services/admin-feature-override-service";
import { generateEmbedding } from "@/lib/api/services/memory-service";
import { WritingProfileService } from "@/lib/api/services/writing-profile-service";
import { getSyncOpenAI } from "@/lib/api/services/openai-clients";

export const maxDuration = 60;

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ExtractedFact {
  category: string;
  content: string;
  confidence: number;
}

interface ExtractedEntity {
  name: string;
  entityType: "person" | "service" | "material" | "location" | "organization";
  properties?: Record<string, unknown>;
}

interface ExtractionResult {
  facts: ExtractedFact[];
  entities: ExtractedEntity[];
  profileSeeded: boolean;
}

// ─── Question metadata for extraction context ─────────────────────────────────

const QUESTION_CATEGORIES: Record<string, { category: string; entityTypes: string[] }> = {
  q1: { category: "services", entityTypes: ["service"] },
  q2: { category: "service_area", entityTypes: ["location"] },
  q3: { category: "materials", entityTypes: ["material"] },
  q4: { category: "pricing", entityTypes: ["service"] },
  q5: { category: "pricing", entityTypes: [] },
  q6: { category: "payment_terms", entityTypes: [] },
  q7: { category: "communication_style", entityTypes: [] },
  q8: { category: "writing_sample", entityTypes: [] },
  q9: { category: "vocabulary", entityTypes: [] },
  q10: { category: "response_time", entityTypes: [] },
  q11: { category: "services_not_offered", entityTypes: ["service"] },
  q12: { category: "seasonal_pattern", entityTypes: [] },
  q13: { category: "team", entityTypes: ["person"] },
  q14: { category: "team_responsibilities", entityTypes: ["person"] },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof getServiceRoleClient>;

async function storeFact(
  supabase: SupabaseClient,
  companyId: string,
  userId: string,
  category: string,
  content: string,
  entityId?: string | null
): Promise<boolean> {
  try {
    const embedding = await generateEmbedding(`${category}: ${content}`);

    await supabase.from("agent_memories").insert({
      company_id: companyId,
      user_id: userId,
      memory_type: "fact",
      category,
      content,
      confidence: 0.9,
      decay_score: 1.0,
      source: "intake_interview",
      source_id: `interview-${new Date().toISOString()}`,
      entity_id: entityId ?? null,
      ...(embedding ? { embedding: JSON.stringify(embedding) } : {}),
    });

    return true;
  } catch (err) {
    console.error(`[extract-facts] storeFact failed:`, err);
    return false;
  }
}

async function upsertEntity(
  supabase: SupabaseClient,
  companyId: string,
  entity: ExtractedEntity
): Promise<string | null> {
  try {
    const normalizedName = entity.name.toLowerCase().trim();
    const embedding = await generateEmbedding(
      `${entity.entityType}: ${entity.name}`
    );

    const { data } = await supabase
      .from("graph_entities")
      .upsert(
        {
          company_id: companyId,
          entity_type: entity.entityType,
          name: entity.name,
          normalized_name: normalizedName,
          properties: entity.properties ?? {},
          confidence: 0.9,
          source: "intake_interview",
          ...(embedding ? { embedding: JSON.stringify(embedding) } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,entity_type,normalized_name" }
      )
      .select("id")
      .single();

    return (data?.id as string) ?? null;
  } catch (err) {
    console.error(`[extract-facts] upsertEntity failed for "${entity.name}":`, err);
    return null;
  }
}

// ─── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = getServiceRoleClient();
  setSupabaseOverride(supabase);

  try {
    // Auth
    const authUser = await verifyAdminAuth(request);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await findUserByAuth(authUser.uid, authUser.email, "id, company_id");
    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const userId = user.id as string;
    const companyId = user.company_id as string;

    if (!companyId) {
      return NextResponse.json({ error: "No company associated" }, { status: 400 });
    }

    // Feature gate
    const enabled = await AdminFeatureOverrideService.isAIFeatureEnabled(companyId, "phase_c");
    if (!enabled) {
      return NextResponse.json({ error: "Phase C not enabled" }, { status: 403 });
    }

    // Parse request
    const body = await request.json();
    const { questionId, userResponse, questionText } = body as {
      questionId: string;
      userResponse: string;
      questionText: string;
    };

    if (!questionId || !userResponse) {
      return NextResponse.json(
        { error: "questionId and userResponse required" },
        { status: 400 }
      );
    }

    const questionMeta = QUESTION_CATEGORIES[questionId];
    if (!questionMeta) {
      return NextResponse.json({ error: "Unknown questionId" }, { status: 400 });
    }

    const result: ExtractionResult = {
      facts: [],
      entities: [],
      profileSeeded: false,
    };

    // ─── Special case: Q8 (example emails) — seed writing profile ───────
    if (questionId === "q8") {
      // Split response into individual emails (look for separators)
      const emailTexts = userResponse
        .split(/(?:^|\n)(?:---+|===+|Email\s*\d+:?|Example\s*\d+:?)\s*\n?/i)
        .map((t) => t.trim())
        .filter((t) => t.length > 30);

      // If no separators found, treat the whole response as one email
      const emails = emailTexts.length > 0 ? emailTexts : [userResponse];

      for (const emailText of emails) {
        try {
          await WritingProfileService.updateFromEmail(companyId, userId, {
            bodyText: emailText,
          });
          result.profileSeeded = true;
        } catch (err) {
          console.error("[extract-facts] Writing profile seed failed:", err);
        }
      }

      // Store a fact about writing samples provided
      result.facts.push({
        category: "writing_sample",
        content: `User provided ${emails.length} example email(s) for writing profile training`,
        confidence: 0.9,
      });

      await storeFact(
        supabase,
        companyId,
        userId,
        "writing_sample",
        `User provided ${emails.length} example email(s) for writing profile training`
      );

      return NextResponse.json({ ok: true, ...result });
    }

    // ─── Standard extraction via AI ─────────────────────────────────────
    const entityTypeHint = questionMeta.entityTypes.length > 0
      ? `\nAlso extract named entities of types: ${questionMeta.entityTypes.join(", ")}. Return them in the "entities" array.`
      : "";

    const aiResponse = await getSyncOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are extracting structured business facts from a user's response during an intake interview.

The question was about: ${questionMeta.category}
The question asked: "${questionText}"

Extract discrete facts from their response. Each fact should be a standalone statement that could be useful for an AI email assistant drafting emails on behalf of this business.

Return JSON:
{
  "facts": [
    { "category": "${questionMeta.category}", "content": "clear standalone fact statement", "confidence": 0.9 }
  ],
  "entities": [
    { "name": "Entity Name", "entityType": "person|service|material|location|organization", "properties": {} }
  ]
}
${entityTypeHint}
Rules:
- Each fact should be a complete, self-contained statement
- Use the user's specific numbers, names, and details — don't generalize
- Don't invent information not present in the response
- For pricing, include units (per sqft, per linear ft, etc.) if mentioned
- For team members, include their name and what they handle
- Confidence should be 0.9 for clear statements, 0.7 for inferred ones
- Return an empty facts array if the response contains no extractable information`,
        },
        {
          role: "user",
          content: userResponse,
        },
      ],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: "json_object" },
    });

    const content = aiResponse.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ ok: true, ...result });
    }

    let parsed: { facts?: ExtractedFact[]; entities?: ExtractedEntity[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("[extract-facts] Failed to parse AI response:", content);
      return NextResponse.json({ ok: true, ...result });
    }

    // Store entities first (we need their IDs for facts)
    const entityIdMap = new Map<string, string>();
    for (const entity of parsed.entities ?? []) {
      const entityId = await upsertEntity(supabase, companyId, entity);
      if (entityId) {
        entityIdMap.set(entity.name.toLowerCase(), entityId);
        result.entities.push(entity);
      }
    }

    // Store facts
    for (const fact of parsed.facts ?? []) {
      // Try to link fact to a relevant entity
      let linkedEntityId: string | null = null;
      for (const [name, id] of entityIdMap) {
        if (fact.content.toLowerCase().includes(name)) {
          linkedEntityId = id;
          break;
        }
      }

      const stored = await storeFact(
        supabase,
        companyId,
        userId,
        fact.category || questionMeta.category,
        fact.content,
        linkedEntityId
      );

      if (stored) {
        result.facts.push(fact);
      }
    }

    // Create edges between entities if we have multiple
    const entityIds = [...entityIdMap.values()];
    if (entityIds.length > 1) {
      // Create "related_to" edges between entities found in the same response
      for (let i = 0; i < entityIds.length - 1; i++) {
        for (let j = i + 1; j < entityIds.length; j++) {
          try {
            await supabase.from("agent_knowledge_graph").upsert(
              {
                company_id: companyId,
                source_entity_id: entityIds[i],
                predicate: "related_to",
                target_entity_id: entityIds[j],
                link_type: "intake_interview",
                confidence: 0.7,
                valid_from: new Date().toISOString(),
              },
              { onConflict: "company_id,source_entity_id,predicate,target_entity_id" }
            );
          } catch {
            // Non-fatal — skip edge creation failures
          }
        }
      }
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[extract-facts]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  } finally {
    setSupabaseOverride(null);
  }
}
