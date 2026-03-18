// src/lib/api/services/memory-service.ts
// Memory service — extracts facts, updates knowledge graph, queries memory.
// Uses OpenAI for extraction + Supabase pgvector for storage.

import { requireSupabase } from "@/lib/supabase/helpers";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";
import { PLATFORM_DOMAINS } from "@/lib/api/services/known-platforms";
import OpenAI from "openai";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ─── Phase C Helpers (copied from analyze-continue to avoid route imports) ──

const PLATFORM_EMAIL_PATTERNS = [
  'reply-to+', 'noreply', 'no-reply', 'notifications@',
  'mailer-daemon', 'postmaster@',
  'inbound.opsapp.co', '@opsapp.co',
  ...Object.keys(PLATFORM_DOMAINS),
];

function isPlatformEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return PLATFORM_EMAIL_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Split a concatenated domain name into proper words using a business word dictionary.
 * "ardentproperties" → "Ardent Properties", "storyconstruction" → "Story Construction"
 */
function splitDomainName(domainLocal: string): string {
  const lower = domainLocal.toLowerCase();
  const SUFFIXES = [
    'construction', 'renovations', 'renovation', 'properties', 'property',
    'developments', 'development', 'contracting', 'contractors', 'contractor',
    'installations', 'installation', 'engineering', 'landscaping', 'restoration',
    'restorations', 'improvements', 'improvement', 'fabrication', 'consulting',
    'maintenance', 'enterprises', 'mechanical', 'management', 'industries',
    'associates', 'woodworks', 'woodwork', 'solutions', 'interiors', 'exteriors',
    'millwork', 'builders', 'building', 'services', 'plumbing', 'painting',
    'electric', 'electrical', 'flooring', 'roofing', 'fencing', 'decking',
    'masonry', 'welding', 'designs', 'design', 'studios', 'studio',
    'realty', 'supply', 'homes', 'home', 'group', 'works', 'hvac',
    'media', 'labs', 'corp', 'coop', 'pros', 'pro',
  ];
  for (const suffix of SUFFIXES) {
    if (lower.endsWith(suffix) && lower.length > suffix.length) {
      const prefix = lower.slice(0, -suffix.length);
      if (prefix.length >= 2) {
        const capPrefix = prefix.charAt(0).toUpperCase() + prefix.slice(1);
        let capSuffix = suffix.charAt(0).toUpperCase() + suffix.slice(1);
        if (suffix === 'coop') capSuffix = 'Co-op';
        return `${capPrefix} ${capSuffix}`;
      }
    }
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export interface MemoryFact {
  id: string;
  type: string;
  category: string;
  content: string;
  confidence: number;
  source: string;
}

// ─── Phase C Constants ──────────────────────────────────────────────────────

export const PROFILE_CLUSTER_MAP: Record<string, string> = {
  client_new_inquiry: 'client',
  client_quoting: 'client',
  client_active_project: 'client',
  client_followup: 'client',
  vendor_ordering: 'vendor',
  vendor_inquiry: 'vendor',
  subtrade_coordination: 'subtrade',
  warranty_claim: 'client',
  internal: 'internal',
  general: 'general',
};

export const ENTITY_CLUSTER_MAP: Record<string, string> = {
  person: 'people',
  company: 'organizations',
  project: 'projects',
  service: 'services',
  material: 'materials',
  document: 'documents',
};

export const SKIP_CLASSIFICATION_KEYWORDS: Record<string, string[]> = {
  spam: ['automated', 'newsletter', 'marketing email', 'unsubscribe', 'noreply',
         'no-reply', 'bulk', 'spam', 'mailing list', 'promotional'],
  vendor: ['vendor', 'supplier', 'sales rep', 'sales representative', 'wholesale',
           'distributor', 'supply company', 'invoice from', 'purchase order',
           'product catalog', 'price list', 'account representative'],
  subtrade: ['subtrade', 'subcontractor', 'sub-contractor', 'general contractor',
             'trade partner', 'site coordination', 'job site', 'gc ', 'foreman'],
  internal: ['internal', 'employee', 'team member', 'coworker', 'staff',
             'company email', 'same company'],
};

export const VALID_PROFILE_TYPES = [
  'client_new_inquiry', 'client_quoting', 'client_active_project', 'client_followup',
  'vendor_ordering', 'vendor_inquiry', 'subtrade_coordination',
  'warranty_claim', 'internal', 'general',
] as const;

export type ProfileType = typeof VALID_PROFILE_TYPES[number];

export const PROFILE_TYPE_DESCRIPTIONS: Record<ProfileType, string> = {
  client_new_inquiry: 'new potential clients making their first inquiry',
  client_quoting: 'clients you are sending estimates or discussing pricing with',
  client_active_project: 'clients with active ongoing projects',
  client_followup: 'clients you are following up with after sending a quote',
  vendor_ordering: 'suppliers you are placing material orders with',
  vendor_inquiry: 'vendors you are asking about products or pricing',
  subtrade_coordination: 'subtrades and general contractors you coordinate with on job sites',
  warranty_claim: 'clients contacting you about warranty or callback issues',
  internal: 'your own employees and team members',
  general: 'general business contacts',
};

export const FACT_CATEGORIES = [
  'pricing', 'commitment', 'client_preference', 'client_behavior', 'budget_signal',
  'material_usage', 'supplier_pricing', 'supplier_relationship', 'employee_pattern',
  'project_event', 'seasonal_pattern', 'service_capability', 'service_area',
  'process', 'relationship_health', 'promotion',
] as const;

export interface ClassifiedThread {
  threadId: string;
  classification: 'client' | 'vendor' | 'subtrade' | 'internal' | 'unknown';
  profileType: ProfileType | null;
  confidence: number;
  messages: Array<{
    from: string;
    fromName: string;
    to: string[];
    subject: string;
    bodyText: string;
    date: string;
    direction: 'inbound' | 'outbound';
  }>;
}

interface ExtractionResult {
  facts: Array<{
    category: string;
    content: string;
    confidence: number;
    entity_email?: string;
  }>;
  entities: Array<{
    name: string;
    email?: string;
    domain?: string;
    type: 'person' | 'company' | 'service' | 'material';
  }>;
  edges: Array<{
    from_email?: string;
    from_name?: string;
    predicate: string;
    to_name: string;
    to_type: string;
    properties?: Record<string, unknown>;
  }>;
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
    const response = await getOpenAI().chat.completions.create({
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

// ─── Phase C extraction (expanded prompt with entities + edges) ─────────────

async function extractEntitiesAndFacts(
  thread: {
    messages: Array<{ from: string; to: string[]; subject: string; bodyText: string; date: string; direction: string }>;
    classification: string;
  }
): Promise<ExtractionResult> {
  try {
    // Build message context — last 8 messages, truncated to 800 chars each
    const messageSummary = thread.messages
      .slice(-8)
      .map(m => `[${m.direction}] From: ${m.from} | Subject: ${m.subject}\n${m.bodyText.slice(0, 800)}`)
      .join('\n---\n');

    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Extract business facts and entities from this email thread. Return ONLY notable facts — skip generic pleasantries.

Fact categories: ${FACT_CATEGORIES.join(', ')}

Return JSON:
{
  "facts": [{"category": "pricing", "content": "Quoted $3,200 for 40ft cedar fence", "confidence": 0.9, "entity_email": "john@acme.com"}],
  "entities": [{"name": "John Henderson", "email": "john@acme.com", "type": "person"}, {"name": "Acme Properties", "domain": "acme.com", "type": "company"}],
  "edges": [{"from_email": "john@acme.com", "predicate": "quoted_for", "to_name": "cedar fence", "to_type": "service", "properties": {"amount": 3200}}]
}

Be concise. 1-2 sentences per fact max. Only extract facts useful for future email drafting, pricing, analytics, or relationship tracking.`,
        },
        { role: 'user', content: `Thread classification: ${thread.classification}\n\n${messageSummary}` },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '{"facts":[],"entities":[],"edges":[]}';
    const parsed = JSON.parse(content);
    return {
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch (err) {
    console.error('[memory-service] Entity+fact extraction failed:', err);
    return { facts: [], entities: [], edges: [] };
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
        .select("id, confidence, access_count")
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
            access_count: ((current.access_count as number) || 0) + 1,
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
   * Phase C: Deterministic entity resolution from classified email threads.
   * Creates/updates person and company entities in graph_entities,
   * and relationship edges in agent_knowledge_graph.
   */
  async resolveEntities(
    companyId: string,
    threads: ClassifiedThread[],
    ownerEmail: string,
    employeeEmails: Set<string>,
  ): Promise<{ entitiesCreated: number; edgesCreated: number }> {
    const supabase = requireSupabase();
    let entitiesCreated = 0;
    let edgesCreated = 0;

    // Collect all unique email addresses across all thread messages
    const emailsToProcess = new Map<string, { name: string; classification: string; confidence: number }>();

    for (const thread of threads) {
      for (const msg of thread.messages) {
        const allEmails = [msg.from, ...msg.to];
        for (const raw of allEmails) {
          const email = raw.toLowerCase().trim();
          if (
            !email ||
            email === ownerEmail.toLowerCase() ||
            employeeEmails.has(email) ||
            isPlatformEmail(email)
          ) continue;

          const domain = email.split('@')[1];
          if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) continue;

          const existing = emailsToProcess.get(email);
          if (!existing || msg.fromName.length > existing.name.length) {
            emailsToProcess.set(email, {
              name: msg.fromName || email.split('@')[0],
              classification: thread.classification,
              confidence: thread.confidence,
            });
          }
        }
      }
    }

    // Ensure a "self" company entity exists for the user's own company
    const ownerDomain = ownerEmail.toLowerCase().split('@')[1];
    let selfCompanyId: string | null = null;
    if (ownerDomain && !PUBLIC_EMAIL_DOMAINS.has(ownerDomain)) {
      const selfCompanyName = splitDomainName(ownerDomain.split('.')[0]);
      const { data: selfEntity } = await supabase
        .from("graph_entities")
        .upsert({
          company_id: companyId,
          entity_type: 'company',
          name: selfCompanyName,
          normalized_name: ownerDomain.toLowerCase(),
          properties: { domain: ownerDomain, is_self: true },
          confidence: 1.0,
          source: 'email_import',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'company_id,entity_type,normalized_name' })
        .select("id")
        .single();
      selfCompanyId = selfEntity?.id || null;
    }

    // Process each unique email → person entity + company entity
    const domainCompanyIds = new Map<string, string>(); // domain → entity UUID

    for (const [email, info] of emailsToProcess) {
      if (info.confidence < 0.7) continue;

      const domain = email.split('@')[1];
      const personName = info.name.length > 2
        ? info.name.replace(/\b\w/g, c => c.toUpperCase()).trim()
        : email.split('@')[0];

      // Upsert person entity
      const { data: personEntity } = await supabase
        .from("graph_entities")
        .upsert({
          company_id: companyId,
          entity_type: 'person',
          name: personName,
          normalized_name: email,
          email,
          properties: { domain },
          confidence: Math.min(1.0, info.confidence),
          source: 'email_import',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'company_id,entity_type,normalized_name' })
        .select("id, name")
        .single();

      if (personEntity) {
        entitiesCreated++;

        // Update name if new name is longer (better data)
        // The upsert above handles insert-or-update, but for name we want longest wins
        const { data: existing } = await supabase
          .from("graph_entities")
          .select("name")
          .eq("id", personEntity.id)
          .single();
        if (existing && personName.length > (existing.name as string).length) {
          await supabase
            .from("graph_entities")
            .update({ name: personName, updated_at: new Date().toISOString() })
            .eq("id", personEntity.id);
        }
      }

      // Upsert company entity from domain
      if (!domainCompanyIds.has(domain)) {
        const companyName = splitDomainName(domain.split('.')[0]);
        const { data: companyEntity } = await supabase
          .from("graph_entities")
          .upsert({
            company_id: companyId,
            entity_type: 'company',
            name: companyName,
            normalized_name: domain.toLowerCase(),
            properties: { domain },
            confidence: Math.min(1.0, info.confidence),
            source: 'email_import',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'company_id,entity_type,normalized_name' })
          .select("id")
          .single();

        if (companyEntity) {
          domainCompanyIds.set(domain, companyEntity.id);
          entitiesCreated++;
        }
      }

      // Create works_for edge: person → company
      const companyEntityId = domainCompanyIds.get(domain);
      if (personEntity && companyEntityId) {
        await supabase
          .from("agent_knowledge_graph")
          .upsert({
            company_id: companyId,
            source_entity_id: personEntity.id,
            predicate: 'works_for',
            target_entity_id: companyEntityId,
            link_type: 'extracted',
            valid_from: new Date().toISOString(),
          }, { onConflict: 'company_id,source_entity_id,predicate,target_entity_id' })
          .then(null, (err) => {
            console.error("[memory-service] works_for edge upsert failed:", err);
          });
        edgesCreated++;
      }

      // Create relationship edge: external company → self company
      if (companyEntityId && selfCompanyId && companyEntityId !== selfCompanyId) {
        let predicate = 'communicates_with';
        if (info.classification === 'client') predicate = 'client_of';
        else if (info.classification === 'vendor') predicate = 'vendor_of';
        else if (info.classification === 'subtrade') predicate = 'subtrade_of';

        if (predicate !== 'communicates_with') {
          await supabase
            .from("agent_knowledge_graph")
            .upsert({
              company_id: companyId,
              source_entity_id: companyEntityId,
              predicate,
              target_entity_id: selfCompanyId,
              link_type: 'extracted',
              valid_from: new Date().toISOString(),
            }, { onConflict: 'company_id,source_entity_id,predicate,target_entity_id' })
            .then(null, (err) => {
              console.error(`[memory-service] ${predicate} edge upsert failed:`, err);
            });
          edgesCreated++;
        }
      }
    }

    return { entitiesCreated, edgesCreated };
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
