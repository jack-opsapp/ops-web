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

    // Normalize inbound email for safer ilike matching. Bail out early
    // rather than running each tier with an empty string — those would
    // just scan every row in the company and return a garbage match.
    const normalizedEmail = (email ?? '').trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return {
        clientId: null,
        subClientId: null,
        confidence: 'unmatched',
        needsReview: false,
        suggestedClientId: null,
        reason: 'No valid email address to match',
        action: 'create_new',
      };
    }

    // --- Tier 1: Exact email match on clients ---
    //
    // Using .limit(1).maybeSingle() so duplicate rows (mis-imports, Bubble
    // sync artifacts) don't throw a "multiple rows returned" error into
    // the fall-through path. Filter on deleted_at so a soft-deleted client
    // doesn't get resurrected by a match.
    const { data: exactClient } = await supabase
      .from('clients')
      .select('id')
      .eq('company_id', companyId)
      .ilike('email', normalizedEmail)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

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
      .ilike('email', normalizedEmail)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

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
    const domain = normalizedEmail.split('@')[1];
    if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
      // Escape SQL ilike wildcards in the domain so a user with a weird
      // local part can't inject pattern characters into our search.
      const safeDomain = domain.replace(/[%_\\]/g, (c) => `\\${c}`);

      const { data: domainClients } = await supabase
        .from('clients')
        .select('id, name, email')
        .eq('company_id', companyId)
        .ilike('email', `%@${safeDomain}`)
        .is('deleted_at', null);

      const { data: domainSubs } = await supabase
        .from('sub_clients')
        .select('id, client_id, email')
        .eq('company_id', companyId)
        .ilike('email', `%@${safeDomain}`)
        .is('deleted_at', null);

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
        // Escape ilike wildcards in the name — same attack surface.
        const safeLastName = lastName.replace(/[%_\\]/g, (c) => `\\${c}`);
        const { data: nameMatches } = await supabase
          .from('clients')
          .select('id, name')
          .eq('company_id', companyId)
          .ilike('name', `%${safeLastName}%`)
          .is('deleted_at', null);

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
    //
    // If this sender is CC'd on a thread that's already linked to an
    // opportunity, treat them as a sub-contact of that opportunity's
    // client. We fetch the opportunity row separately rather than using
    // Supabase embedded FK syntax because the embedded-join shape
    // (object vs array) depends on client version and can drift.
    if (options?.threadId && options?.connectionId) {
      const { data: threadLinks } = await supabase
        .from('opportunity_email_threads')
        .select('opportunity_id')
        .eq('thread_id', options.threadId)
        .eq('connection_id', options.connectionId)
        .limit(1)
        .maybeSingle();

      if (threadLinks?.opportunity_id) {
        const { data: opportunity } = await supabase
          .from('opportunities')
          .select('client_id')
          .eq('id', threadLinks.opportunity_id as string)
          .is('deleted_at', null)
          .maybeSingle();

        if (opportunity?.client_id) {
          return {
            clientId: opportunity.client_id as string,
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
