// src/lib/api/services/email-matching-service-v2.ts
// 5-tier client matching cascade — prevents duplicate client creation
// Replaces the 3-tier email-matching-service.ts

import { requireSupabase } from '@/lib/supabase/helpers';
import { PUBLIC_EMAIL_DOMAINS } from '@/lib/types/pipeline';

export type MatchConfidence = 'exact' | 'domain' | 'name' | 'thread_cc' | 'ai_duplicate' | 'unmatched';

export interface MatchResultV2 {
  clientId: string | null;
  subClientId: string | null;
  confidence: MatchConfidence;
  needsReview: boolean;
  suggestedClientId: string | null;
  reason: string;
  action: 'link' | 'create_subclient' | 'review' | 'create_new';
}

export const EmailMatchingServiceV2 = {
  /**
   * Run the 5-tier matching cascade for an email address
   */
  async match(
    companyId: string,
    email: string,
    options?: {
      threadId?: string;
      name?: string;
      connectionId?: string;
    }
  ): Promise<MatchResultV2> {
    const supabase = requireSupabase();

    // --- Tier 1: Exact email match ---
    const { data: exactClient } = await supabase
      .from('clients')
      .select('id')
      .eq('company_id', companyId)
      .ilike('email', email)
      .single();

    if (exactClient) {
      return {
        clientId: exactClient.id,
        subClientId: null,
        confidence: 'exact',
        needsReview: false,
        suggestedClientId: null,
        reason: 'Exact email match on client',
        action: 'link',
      };
    }

    // Check sub-clients
    const { data: exactSub } = await supabase
      .from('sub_clients')
      .select('id, client_id')
      .eq('company_id', companyId)
      .ilike('email', email)
      .single();

    if (exactSub) {
      return {
        clientId: exactSub.client_id,
        subClientId: exactSub.id,
        confidence: 'exact',
        needsReview: false,
        suggestedClientId: null,
        reason: 'Exact email match on sub-client',
        action: 'link',
      };
    }

    // --- Tier 2: Domain match (non-public domains only) ---
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
      const { data: domainClients } = await supabase
        .from('clients')
        .select('id, name, email')
        .eq('company_id', companyId)
        .ilike('email', `%@${domain}`);

      const { data: domainSubs } = await supabase
        .from('sub_clients')
        .select('id, client_id, email')
        .eq('company_id', companyId)
        .ilike('email', `%@${domain}`);

      const allDomainMatches = [
        ...(domainClients || []).map((c: { id: string }) => ({ clientId: c.id, type: 'client' })),
        ...(domainSubs || []).map((s: { client_id: string }) => ({ clientId: s.client_id, type: 'sub_client' })),
      ];

      // Deduplicate by clientId
      const uniqueClientIds = [...new Set(allDomainMatches.map((m) => m.clientId))];

      if (uniqueClientIds.length === 1) {
        return {
          clientId: uniqueClientIds[0],
          subClientId: null,
          confidence: 'domain',
          needsReview: false,
          suggestedClientId: null,
          reason: `Domain match: same domain as existing client (@${domain})`,
          action: 'create_subclient',
        };
      }

      if (uniqueClientIds.length > 1) {
        return {
          clientId: null,
          subClientId: null,
          confidence: 'domain',
          needsReview: true,
          suggestedClientId: uniqueClientIds[0],
          reason: `Multiple clients share domain @${domain} — needs review`,
          action: 'review',
        };
      }
    }

    // --- Tier 3: Name match ---
    if (options?.name) {
      const lastName = options.name.split(' ').pop()?.toLowerCase();
      if (lastName && lastName.length >= 3) {
        const { data: nameMatches } = await supabase
          .from('clients')
          .select('id, name')
          .eq('company_id', companyId)
          .ilike('name', `%${lastName}%`);

        if (nameMatches && nameMatches.length > 0) {
          return {
            clientId: null,
            subClientId: null,
            confidence: 'name',
            needsReview: true,
            suggestedClientId: nameMatches[0].id,
            reason: `Name match: "${options.name}" may be related to "${nameMatches[0].name}"`,
            action: 'review',
          };
        }
      }
    }

    // --- Tier 4: Thread CC association ---
    if (options?.threadId && options?.connectionId) {
      const { data: threadLinks } = await supabase
        .from('opportunity_email_threads')
        .select('opportunity_id, opportunities!inner(client_id)')
        .eq('thread_id', options.threadId)
        .eq('connection_id', options.connectionId)
        .limit(1);

      if (threadLinks && threadLinks.length > 0) {
        const row = threadLinks[0] as unknown as { opportunities?: { client_id: string } };
        const clientId = row.opportunities?.client_id;
        if (clientId) {
          return {
            clientId,
            subClientId: null,
            confidence: 'thread_cc',
            needsReview: false,
            suggestedClientId: null,
            reason: 'CC on an existing lead thread — adding as sub-contact',
            action: 'create_subclient',
          };
        }
      }
    }

    // --- Tier 5: AI duplicate detection is handled externally by EmailAIClassifier ---
    // (The classifier returns `duplicateOf` field which the import route handles)

    // No match at any tier
    return {
      clientId: null,
      subClientId: null,
      confidence: 'unmatched',
      needsReview: false,
      suggestedClientId: null,
      reason: 'No match found — new client',
      action: 'create_new',
    };
  },
};
