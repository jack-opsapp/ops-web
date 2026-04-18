// src/lib/api/services/memory-service.ts
// Memory service — extracts facts, updates knowledge graph, queries memory.
// Uses OpenAI for extraction + Supabase pgvector for storage.

import { requireSupabase } from "@/lib/supabase/helpers";
import { AdminFeatureOverrideService } from "./admin-feature-override-service";
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";
import { PLATFORM_DOMAINS } from "@/lib/api/services/known-platforms";
import { getSyncOpenAI } from "./openai-clients";
import { WritingProfileService } from "./writing-profile-service";

// Uses OPENAI_API_KEY_SYNC — memory extraction runs during ongoing sync.
function getOpenAI() {
  return getSyncOpenAI();
}

// normalizeToneTraits imported from writing-profile-service to avoid duplication

/**
 * Generate a 1536-dimension embedding vector using OpenAI text-embedding-3-small.
 * Returns null on failure (non-fatal — memory still stored without embedding).
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    // Truncate to ~8000 tokens (~32,000 chars) — model limit is 8191 tokens
    const truncated = text.slice(0, 32000);
    const response = await getOpenAI().embeddings.create({
      model: "text-embedding-3-small",
      input: truncated,
      dimensions: 1536,
    });
    return response.data[0]?.embedding ?? null;
  } catch (err) {
    console.error("[memory-service] Embedding generation failed:", err);
    return null;
  }
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
          content: `Extract business facts and entities from this email thread for a trades/construction business. Be generous — most threads contain at least 1-3 extractable facts. Only skip truly empty threads (one-line "thanks" / "got it" with no context).

Fact categories: ${FACT_CATEGORIES.join(', ')}

Extract facts from BOTH inbound client messages AND outbound owner replies:
- Inbound (client) facts: their requirements, budget signals, service area, preferences, timeline, objections, decisions
- Outbound (owner) facts: prices quoted, services offered, commitments made, policies stated

Return JSON:
{
  "facts": [
    {"category": "pricing", "content": "Quoted $3,200 for 40ft cedar fence", "confidence": 0.9, "entity_email": "john@acme.com"},
    {"category": "client_preference", "content": "Client prefers cedar over pressure-treated", "confidence": 0.85, "entity_email": "john@acme.com"},
    {"category": "service_area", "content": "Project at 45 Maple St, Oakville", "confidence": 0.95, "entity_email": "john@acme.com"},
    {"category": "budget_signal", "content": "Budget range $15-20k", "confidence": 0.8, "entity_email": "john@acme.com"}
  ],
  "entities": [{"name": "John Henderson", "email": "john@acme.com", "type": "person"}, {"name": "Acme Properties", "domain": "acme.com", "type": "company"}],
  "edges": [{"from_email": "john@acme.com", "predicate": "quoted_for", "to_name": "cedar fence", "to_type": "service", "properties": {"amount": 3200}}]
}

Be concise — 1-2 sentences per fact. Aim for 2-5 facts per substantive thread. Facts should be useful for future email drafting, pricing reference, or relationship tracking.`,
        },
        { role: 'user', content: `Thread classification: ${thread.classification}\n\n${messageSummary}` },
      ],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '{"facts":[],"entities":[],"edges":[]}';
    const parsed = JSON.parse(content);
    const result = {
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
    // One-line diagnostic so Phase C runs can be audited via Vercel logs:
    // facts/entities/edges counts per thread + first 100 chars of response.
    // Remove once the extraction loop is reliably producing facts.
    if (result.facts.length === 0 && result.entities.length === 0 && result.edges.length === 0) {
      console.warn(`[memory-service] extractEntitiesAndFacts returned empty — raw: ${content.slice(0, 200)}`);
    } else {
      console.log(`[memory-service] extract: ${result.facts.length} facts, ${result.entities.length} entities, ${result.edges.length} edges`);
    }
    return result;
  } catch (err) {
    console.error('[memory-service] Entity+fact extraction failed:', err);
    return { facts: [], entities: [], edges: [] };
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

export const MemoryService = {
  /**
   * Process an outbound email and extract memory facts.
   * Called by the sync engine for every outbound email when phase_c is enabled.
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
      "phase_c"
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
        // Generate embedding for vector search retrieval
        const embedding = await generateEmbedding(
          `${fact.category}: ${fact.content}`
        );

        await supabase.from("agent_memories").insert({
          company_id: companyId,
          user_id: userId,
          memory_type: fact.type,
          category: fact.category,
          content: fact.content,
          confidence: fact.confidence,
          source: "email",
          source_id: email.date,
          ...(embedding ? { embedding: JSON.stringify(embedding) } : {}),
        });
      }
    }

    // Update knowledge graph edges. Surface upsert errors — previously the
    // .then(null, errorHandler) pattern swallowed schema/constraint failures
    // and made Phase C tables silently stay empty (see agent_knowledge_graph
    // legacy-schema incident 2026-04-18).
    for (const edge of extraction.edges) {
      const { error: edgeErr } = await supabase
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
        );
      if (edgeErr) {
        console.error("[memory-service] Knowledge graph upsert failed:", edgeErr);
      }
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

      // Create works_for edge: person → company. Only increment edgesCreated
      // if the upsert actually landed — previously the stat always incremented
      // even when the write failed silently, which masked the 2026-04-18
      // agent_knowledge_graph legacy-NOT-NULL schema bug.
      const companyEntityId = domainCompanyIds.get(domain);
      if (personEntity && companyEntityId) {
        const { error: edgeErr } = await supabase
          .from("agent_knowledge_graph")
          .upsert({
            company_id: companyId,
            source_entity_id: personEntity.id,
            predicate: 'works_for',
            target_entity_id: companyEntityId,
            link_type: 'extracted',
            valid_from: new Date().toISOString(),
          }, { onConflict: 'company_id,source_entity_id,predicate,target_entity_id' });
        if (edgeErr) {
          console.error("[memory-service] works_for edge upsert failed:", edgeErr);
        } else {
          edgesCreated++;
        }
      }

      // Create relationship edge: external company → self company
      if (companyEntityId && selfCompanyId && companyEntityId !== selfCompanyId) {
        let predicate = 'communicates_with';
        if (info.classification === 'client') predicate = 'client_of';
        else if (info.classification === 'vendor') predicate = 'vendor_of';
        else if (info.classification === 'subtrade') predicate = 'subtrade_of';

        if (predicate !== 'communicates_with') {
          const { error: relErr } = await supabase
            .from("agent_knowledge_graph")
            .upsert({
              company_id: companyId,
              source_entity_id: companyEntityId,
              predicate,
              target_entity_id: selfCompanyId,
              link_type: 'extracted',
              valid_from: new Date().toISOString(),
            }, { onConflict: 'company_id,source_entity_id,predicate,target_entity_id' });
          if (relErr) {
            console.error(`[memory-service] ${predicate} edge upsert failed:`, relErr);
          } else {
            edgesCreated++;
          }
        }
      }
    }

    return { entitiesCreated, edgesCreated };
  },

  /**
   * Phase C: Main orchestrator — runs entity resolution, fact extraction,
   * knowledge graph building, and writing profile analysis for an import batch.
   */
  async processImportBatch(
    companyId: string,
    userId: string,
    ownerEmail: string,
    employeeEmails: Set<string>,
    threads: ClassifiedThread[],
  ): Promise<{ factsExtracted: number; entitiesCreated: number; edgesCreated: number; profilesBuilt: number }> {
    // Validate companyId is a valid UUID
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) {
      throw new Error('Invalid companyId UUID');
    }

    const supabase = requireSupabase();
    let factsExtracted = 0;
    let entitiesCreated = 0;
    let edgesCreated = 0;

    // Step 1: Deterministic entity resolution
    console.log(`[memory-service] Step 1: Resolving entities from ${threads.length} threads`);
    const entityResult = await this.resolveEntities(companyId, threads, ownerEmail, employeeEmails);
    entitiesCreated += entityResult.entitiesCreated;
    edgesCreated += entityResult.edgesCreated;

    // Step 2: Extract facts + entities + edges from each thread
    console.log(`[memory-service] Step 2: Extracting facts from ${threads.length} threads`);
    const emailsByProfileType = new Map<string, Array<{ subject: string; bodyText: string; date: string }>>();

    for (const thread of threads) {
      const extraction = await extractEntitiesAndFacts(thread);

      // Store facts with ADD/UPDATE/NOOP conflict resolution
      for (const fact of extraction.facts) {
        // Check for similar existing fact (cheap proxy: first 50 chars ilike match)
        const { data: existing } = await supabase
          .from("agent_memories")
          .select("id, confidence, access_count")
          .eq("company_id", companyId)
          .eq("category", fact.category)
          .ilike("content", `%${fact.content.slice(0, 50)}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          // NOOP — reinforce existing fact
          const current = existing[0];
          await supabase
            .from("agent_memories")
            .update({
              confidence: Math.min(1.0, ((current.confidence as number) || 0.5) + 0.05),
              last_accessed_at: new Date().toISOString(),
              access_count: ((current.access_count as number) || 0) + 1,
            })
            .eq("id", current.id);
        } else {
          // ADD — new fact, try to link to entity via email
          let entityId: string | null = null;
          if (fact.entity_email) {
            const { data: entityMatch } = await supabase
              .from("graph_entities")
              .select("id")
              .eq("company_id", companyId)
              .eq("entity_type", "person")
              .eq("normalized_name", fact.entity_email.toLowerCase())
              .single();
            entityId = entityMatch?.id || null;
          }

          // Generate embedding for vector search retrieval
          const embedding = await generateEmbedding(
            `${fact.category}: ${fact.content}`
          );

          await supabase.from("agent_memories").insert({
            company_id: companyId,
            user_id: userId,
            memory_type: 'fact',
            category: fact.category,
            content: fact.content,
            confidence: fact.confidence || 0.8,
            source: 'email_import',
            source_id: thread.threadId,
            entity_id: entityId,
            ...(embedding ? { embedding: JSON.stringify(embedding) } : {}),
          });
          factsExtracted++;
        }
      }

      // Upsert AI-extracted entities into graph_entities
      for (const entity of extraction.entities) {
        const normalizedName = entity.email
          ? entity.email.toLowerCase()
          : (entity.domain || entity.name.toLowerCase().trim());

        const { error: entityErr } = await supabase
          .from("graph_entities")
          .upsert({
            company_id: companyId,
            entity_type: entity.type,
            name: entity.name,
            normalized_name: normalizedName,
            email: entity.email || null,
            properties: entity.domain ? { domain: entity.domain } : {},
            confidence: 0.8,
            source: 'email_import',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'company_id,entity_type,normalized_name' });
        if (entityErr) {
          console.error("[memory-service] AI entity upsert failed:", entityErr);
        }
      }

      // Upsert AI-extracted edges into agent_knowledge_graph
      for (const edge of extraction.edges) {
        // Look up source entity by email or name
        let sourceEntityId: string | null = null;
        if (edge.from_email) {
          const { data: src } = await supabase
            .from("graph_entities")
            .select("id")
            .eq("company_id", companyId)
            .eq("normalized_name", edge.from_email.toLowerCase())
            .single();
          sourceEntityId = src?.id || null;
        }

        // Look up or create target entity by name + type
        let targetEntityId: string | null = null;
        if (edge.to_name && edge.to_type) {
          const targetNormalized = edge.to_name.toLowerCase().trim();
          const { data: tgt } = await supabase
            .from("graph_entities")
            .upsert({
              company_id: companyId,
              entity_type: edge.to_type,
              name: edge.to_name,
              normalized_name: targetNormalized,
              properties: edge.properties || {},
              confidence: 0.7,
              source: 'email_import',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'company_id,entity_type,normalized_name' })
            .select("id")
            .single();
          targetEntityId = tgt?.id || null;
        }

        if (sourceEntityId && targetEntityId) {
          const { error: aiEdgeErr } = await supabase
            .from("agent_knowledge_graph")
            .upsert({
              company_id: companyId,
              source_entity_id: sourceEntityId,
              predicate: edge.predicate,
              target_entity_id: targetEntityId,
              link_type: 'extracted',
              properties: edge.properties || {},
              valid_from: new Date().toISOString(),
            }, { onConflict: 'company_id,source_entity_id,predicate,target_entity_id' });
          if (aiEdgeErr) {
            console.error("[memory-service] AI edge upsert failed:", aiEdgeErr);
          } else {
            edgesCreated++;
          }
        }
      }

      // Collect outbound emails by profile type for writing profile analysis
      if (thread.profileType) {
        const outbound = thread.messages.filter(m => m.direction === 'outbound');
        if (outbound.length > 0) {
          const existing = emailsByProfileType.get(thread.profileType) || [];
          existing.push(...outbound.map(m => ({
            subject: m.subject,
            bodyText: m.bodyText,
            date: m.date,
          })));
          emailsByProfileType.set(thread.profileType, existing);
        }
      }
    }

    // Step 3: Build writing profiles
    console.log(`[memory-service] Step 3: Building writing profiles from ${emailsByProfileType.size} types`);
    const profilesBuilt = await this.buildWritingProfiles(companyId, userId, emailsByProfileType);

    console.log(`[memory-service] processImportBatch complete: ${factsExtracted} facts, ${entitiesCreated} entities, ${edgesCreated} edges, ${profilesBuilt} profiles`);
    return { factsExtracted, entitiesCreated, edgesCreated, profilesBuilt };
  },

  /**
   * Phase C: Build per-relationship-type writing profiles from outbound emails.
   * Groups emails by profile type, analyzes style for each type with 3+ samples.
   */
  async buildWritingProfiles(
    companyId: string,
    userId: string,
    emailsByProfileType: Map<string, Array<{ subject: string; bodyText: string; date: string }>>
  ): Promise<number> {
    const supabase = requireSupabase();
    let profilesBuilt = 0;

    for (const [profileType, emails] of emailsByProfileType) {
      // Need at least 3 emails to build a meaningful profile
      if (emails.length < 3) continue;

      // Validate profile type
      if (!VALID_PROFILE_TYPES.includes(profileType as ProfileType)) continue;

      // Select up to 10 most recent with diverse subjects
      const sorted = [...emails].sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const seen = new Set<string>();
      const selected: typeof emails = [];
      for (const e of sorted) {
        const subjectKey = e.subject.toLowerCase().replace(/^re:\s*/i, '').trim();
        if (!seen.has(subjectKey)) {
          seen.add(subjectKey);
          selected.push(e);
        }
        if (selected.length >= 10) break;
      }

      try {
        const description = PROFILE_TYPE_DESCRIPTIONS[profileType as ProfileType] || profileType;
        const response = await getOpenAI().chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Analyze these outbound emails from a business owner to characterize their writing style for this relationship type. These are all emails to ${description}.

Return JSON:
{
  "greeting_patterns": ["Hey {name},", "Hi {name},"],
  "closing_patterns": ["Thanks,", "Best,"],
  "avg_sentence_length": 12,
  "formality_score": 0.6,
  "tone_traits": {"direct": true, "professional": true, "warm": true},
  "vocabulary_preferences": ["appreciate", "looking forward to", "let me know"],
  "common_phrases": ["happy to help", "sounds good"],
  "hedging_tendency": 0.15,
  "punctuation_habits": {"exclamation_marks": 1.5, "em_dashes": 0.3, "semicolons": 0.1, "ellipsis": 0.0, "parenthetical": 0.5}
}

IMPORTANT:
- formality_score must be 0.0-1.0 (0=very casual, 1=very formal). NOT 1-10.
- hedging_tendency must be a number 0.0-1.0 (fraction of sentences containing hedging phrases).
- punctuation_habits values must be numbers (average count per email), NOT strings.`,
            },
            {
              role: 'user',
              content: selected.map(e => `Subject: ${e.subject}\n${e.bodyText.slice(0, 600)}`).join('\n---\n'),
            },
          ],
          temperature: 0.1,
          max_tokens: 400,
          response_format: { type: 'json_object' },
        });

        const content = response.choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(content);

        // Normalize hedging_tendency to number (GPT may return string like "low")
        let hedgingNum = 0.2;
        if (typeof parsed.hedging_tendency === 'number') {
          hedgingNum = parsed.hedging_tendency;
        } else if (typeof parsed.hedging_tendency === 'string') {
          const hedgeMap: Record<string, number> = { none: 0, low: 0.15, moderate: 0.35, medium: 0.5, high: 0.7, very_high: 0.85 };
          hedgingNum = hedgeMap[parsed.hedging_tendency.toLowerCase()] ?? 0.2;
        }

        // Normalize punctuation_habits to numbers (GPT may return strings like "occasional")
        const rawPunctuation = parsed.punctuation_habits || {};
        const punctMap: Record<string, number> = { never: 0, rare: 0.2, occasional: 0.8, sometimes: 1.0, moderate: 1.5, frequent: 3.0, heavy: 5.0 };
        const normalizePunctValue = (v: unknown): number => {
          if (typeof v === 'number') return v;
          if (typeof v === 'string') return punctMap[v.toLowerCase()] ?? 0.5;
          if (typeof v === 'boolean') return v ? 1.0 : 0;
          return 0;
        };
        const normalizedPunctuation = {
          exclamation_marks: normalizePunctValue(rawPunctuation.exclamation_marks ?? rawPunctuation.exclamations),
          em_dashes: normalizePunctValue(rawPunctuation.em_dashes),
          semicolons: normalizePunctValue(rawPunctuation.semicolons),
          ellipsis: normalizePunctValue(rawPunctuation.ellipsis),
          parenthetical: normalizePunctValue(rawPunctuation.parenthetical ?? rawPunctuation.parentheticals),
        };

        // Store in vocabulary_preferences JSONB
        const vocabPrefs = {
          words: Array.isArray(parsed.vocabulary_preferences) ? parsed.vocabulary_preferences : [],
          common_phrases: Array.isArray(parsed.common_phrases) ? parsed.common_phrases : [],
          hedging_tendency: hedgingNum,
          punctuation_habits: normalizedPunctuation,
        };

        // Normalize formality_score to 0-1 (GPT may return 1-10 scale)
        let formalityScore = typeof parsed.formality_score === 'number' ? parsed.formality_score : 0.5;
        if (formalityScore > 1) formalityScore = formalityScore / 10; // Convert 1-10 → 0-1

        await supabase
          .from("agent_writing_profiles")
          .upsert({
            company_id: companyId,
            user_id: userId,
            profile_type: profileType,
            greeting_patterns: Array.isArray(parsed.greeting_patterns) ? parsed.greeting_patterns : [],
            closing_patterns: Array.isArray(parsed.closing_patterns) ? parsed.closing_patterns : [],
            avg_sentence_length: parsed.avg_sentence_length || 0,
            formality_score: formalityScore,
            tone_traits: WritingProfileService.normalizeToneTraits(parsed.tone_traits),
            vocabulary_preferences: vocabPrefs,
            emails_analyzed: selected.length,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'company_id,user_id,profile_type' });

        profilesBuilt++;
      } catch (err) {
        console.error(`[memory-service] Writing profile analysis failed for ${profileType}:`, err);
      }
    }

    return profilesBuilt;
  },

  /**
   * Query memory for context relevant to drafting a reply.
   * Uses hybrid retrieval: vector similarity search + category-based filtering.
   * Vector results surface semantically relevant facts; category results ensure
   * pricing, promotions, and limitations are always included.
   */
  async getContextForDraft(
    companyId: string,
    clientEmail: string,
    projectDescription: string
  ): Promise<{
    relevantFacts: MemoryFact[];
    clientHistory: Record<string, unknown>[];
    currentPromotions: string[];
    pricingReferences: string[];
  }> {
    const supabase = requireSupabase();

    // ── Vector similarity search (semantic relevance) ────────────────────────
    // Build a context string from client + project info for embedding query
    const queryText = [
      clientEmail ? `client: ${clientEmail}` : '',
      projectDescription || '',
    ].filter(Boolean).join(' | ');

    let vectorFacts: MemoryFact[] = [];

    if (queryText.length > 10) {
      const queryEmbedding = await generateEmbedding(queryText);

      if (queryEmbedding) {
        // Use the match_memories function from migration 053
        const { data: vectorResults } = await supabase
          .rpc("match_memories", {
            query_embedding: JSON.stringify(queryEmbedding),
            match_company_id: companyId,
            match_threshold: 0.3,
            match_count: 15,
          });

        if (vectorResults) {
          vectorFacts = (vectorResults as Record<string, unknown>[]).map((f) => ({
            id: f.id as string,
            type: f.memory_type as string,
            category: f.category as string,
            content: f.content as string,
            confidence: f.confidence as number,
            source: f.source as string,
          }));

          // Touch access timestamps + increment count for retrieved memories (fire-and-forget)
          const ids = vectorFacts.map((f) => f.id);
          if (ids.length > 0) {
            supabase
              .rpc("increment_access_count", { memory_ids: ids })
              .then(null, (err) =>
                console.error("[memory-service] Access count update failed:", err)
              );
          }
        }
      }
    }

    // ── Category-based retrieval (structured essentials) ─────────────────────
    // Always fetch pricing, promotions, and limitations regardless of vector match
    const [pricingResult, promotionsResult, limitationsResult, clientEdgesResult, entityEdgesResult] =
      await Promise.all([
        supabase
          .from("agent_memories")
          .select("*")
          .eq("company_id", companyId)
          .eq("category", "pricing")
          .gt("decay_score", 0.1)
          .order("confidence", { ascending: false })
          .limit(10),
        supabase
          .from("agent_memories")
          .select("*")
          .eq("company_id", companyId)
          .eq("category", "promotion")
          .gt("confidence", 0.5)
          .gt("decay_score", 0.1)
          .limit(5),
        supabase
          .from("agent_memories")
          .select("*")
          .eq("company_id", companyId)
          .eq("category", "limitation")
          .gt("decay_score", 0.1)
          .limit(10),
        // Legacy text-based client edges
        supabase
          .from("agent_knowledge_graph")
          .select("*")
          .eq("company_id", companyId)
          .eq("subject_id", clientEmail)
          .is("valid_to", null),
        // Entity-linked client edges (Phase C graph)
        clientEmail
          ? supabase
              .from("graph_entities")
              .select("id")
              .eq("company_id", companyId)
              .eq("entity_type", "person")
              .eq("normalized_name", clientEmail.toLowerCase())
              .limit(1)
          : Promise.resolve({ data: null }),
      ]);

    const pricingFacts = pricingResult.data as Record<string, unknown>[] | null;
    const promotions = promotionsResult.data as Record<string, unknown>[] | null;
    const limitations = limitationsResult.data as Record<string, unknown>[] | null;
    const clientEdges = clientEdgesResult.data as Record<string, unknown>[] | null;

    // If we found a person entity, also fetch their entity-linked edges
    let entityClientEdges: Record<string, unknown>[] = [];
    const personEntity = entityEdgesResult.data;
    if (personEntity && personEntity.length > 0) {
      const personId = (personEntity[0] as Record<string, unknown>).id as string;
      const { data: entityEdges } = await supabase
        .from("agent_knowledge_graph")
        .select("*")
        .eq("company_id", companyId)
        .eq("source_entity_id", personId)
        .is("valid_to", null);
      entityClientEdges = (entityEdges as Record<string, unknown>[]) || [];
    }

    // ── Merge & deduplicate vector + category results ────────────────────────
    const categoryFacts: MemoryFact[] = [
      ...((pricingFacts as Record<string, unknown>[]) || []),
      ...((limitations as Record<string, unknown>[]) || []),
    ].map((f) => ({
      id: f.id as string,
      type: f.memory_type as string,
      category: f.category as string,
      content: f.content as string,
      confidence: f.confidence as number,
      source: f.source as string,
    }));

    // Deduplicate: vector results take priority (higher relevance), then category fill-ins
    const seenIds = new Set(vectorFacts.map((f) => f.id));
    const mergedFacts = [...vectorFacts];
    for (const fact of categoryFacts) {
      if (!seenIds.has(fact.id)) {
        seenIds.add(fact.id);
        mergedFacts.push(fact);
      }
    }

    return {
      relevantFacts: mergedFacts,
      clientHistory: [...(clientEdges || []), ...entityClientEdges],
      currentPromotions: ((promotions as Record<string, unknown>[]) || []).map(
        (p) => p.content as string
      ),
      pricingReferences: (
        (pricingFacts as Record<string, unknown>[]) || []
      ).map((p) => p.content as string),
    };
  },

  /**
   * Get memory stats for admin panel (enriched with Phase C data).
   */
  async getStats(companyId: string): Promise<{
    factsCount: number;
    graphEdgesCount: number;
    profilesCount: number;
    entitiesByType: Record<string, number>;
    factsByCategory: Record<string, number>;
    profilesByType: Array<{ profileType: string; emailsAnalyzed: number; updatedAt: string }>;
  }> {
    const supabase = requireSupabase();

    const [facts, edges, profiles, entities, factCategories, profileDetails] = await Promise.all([
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
      supabase
        .from("graph_entities")
        .select("entity_type")
        .eq("company_id", companyId),
      supabase
        .from("agent_memories")
        .select("category")
        .eq("company_id", companyId),
      supabase
        .from("agent_writing_profiles")
        .select("profile_type, emails_analyzed, updated_at")
        .eq("company_id", companyId),
    ]);

    // Count entities by type
    const entitiesByType: Record<string, number> = {};
    for (const e of (entities.data || [])) {
      const t = e.entity_type as string;
      entitiesByType[t] = (entitiesByType[t] || 0) + 1;
    }

    // Count facts by category
    const factsByCategory: Record<string, number> = {};
    for (const f of (factCategories.data || [])) {
      const c = f.category as string;
      factsByCategory[c] = (factsByCategory[c] || 0) + 1;
    }

    return {
      factsCount: facts.count || 0,
      graphEdgesCount: edges.count || 0,
      profilesCount: profiles.count || 0,
      entitiesByType,
      factsByCategory,
      profilesByType: (profileDetails.data || []).map(p => ({
        profileType: p.profile_type as string,
        emailsAnalyzed: p.emails_analyzed as number,
        updatedAt: p.updated_at as string,
      })),
    };
  },

  /**
   * Reset all memory for a company (admin action).
   * Order matters: delete referencing tables first, then graph_entities.
   */
  async resetMemory(companyId: string): Promise<void> {
    const supabase = requireSupabase();

    // Delete tables that reference graph_entities first
    await Promise.all([
      supabase.from("agent_memories").delete().eq("company_id", companyId),
      supabase.from("agent_knowledge_graph").delete().eq("company_id", companyId),
      supabase.from("agent_writing_profiles").delete().eq("company_id", companyId),
    ]);
    // Now safe to delete entities (no more FK references)
    await supabase.from("graph_entities").delete().eq("company_id", companyId);
  },
};
