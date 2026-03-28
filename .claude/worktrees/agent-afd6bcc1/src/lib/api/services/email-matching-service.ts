// src/lib/api/services/email-matching-service.ts
/**
 * OPS Web - Email Matching Service
 *
 * 3-tier matching: exact email → domain → phone signature.
 * Thread inheritance: messages in existing threads auto-link.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import { ClientService } from "./client-service";
import type { MatchConfidence } from "@/lib/types/pipeline";
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";

export interface MatchResult {
  clientId: string | null;
  confidence: MatchConfidence;
  needsReview: boolean;
  suggestedClientId: string | null;
}

// ─── Phone regex: matches common US/intl formats ────────────────────────────
const PHONE_REGEX = /(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
}

function extractEmailAddress(raw: string): string {
  const match = raw.match(/<(.+?)>/);
  return (match ? match[1] : raw).toLowerCase().trim();
}

export const EmailMatchingService = {
  /**
   * Match an email to a client using the 3-tier strategy.
   * Also checks thread inheritance before tier matching.
   */
  async matchEmail(
    companyId: string,
    fromRaw: string,
    toRaw: string,
    snippet: string,
    threadId: string | null
  ): Promise<MatchResult> {
    const supabase = requireSupabase();
    const fromEmail = extractEmailAddress(fromRaw);
    const toEmail = extractEmailAddress(toRaw);

    // ── Thread inheritance ──────────────────────────────────────
    if (threadId) {
      const { data: threadActivity } = await supabase
        .from("activities")
        .select("client_id")
        .eq("email_thread_id", threadId)
        .not("client_id", "is", null)
        .limit(1)
        .single();

      if (threadActivity?.client_id) {
        return {
          clientId: threadActivity.client_id as string,
          confidence: "exact",
          needsReview: false,
          suggestedClientId: null,
        };
      }
    }

    // ── Load clients + sub-clients ──────────────────────────────
    const { clients } = await ClientService.fetchClients(companyId, { limit: 100 });
    // Fetch sub-clients for all clients
    const subClientsPromises = clients.map((c) =>
      ClientService.fetchSubClients(c.id).catch(() => [])
    );
    const subClientArrays = await Promise.all(subClientsPromises);

    // Build lookup maps
    const emailToClientId = new Map<string, string>();
    const domainToClientIds = new Map<string, string[]>();
    const phoneToClientId = new Map<string, string>();

    for (const client of clients) {
      if (client.email) {
        const email = client.email.toLowerCase();
        emailToClientId.set(email, client.id);
        const domain = email.split("@")[1];
        if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
          const existing = domainToClientIds.get(domain) ?? [];
          existing.push(client.id);
          domainToClientIds.set(domain, existing);
        }
      }
      if (client.phoneNumber) {
        phoneToClientId.set(normalizePhone(client.phoneNumber), client.id);
      }
    }

    for (let i = 0; i < clients.length; i++) {
      for (const sub of subClientArrays[i] ?? []) {
        if (sub.email) {
          emailToClientId.set(sub.email.toLowerCase(), clients[i].id);
        }
        if (sub.phoneNumber) {
          phoneToClientId.set(normalizePhone(sub.phoneNumber), clients[i].id);
        }
      }
    }

    // ── Tier 1: Exact email match ───────────────────────────────
    const exactMatch =
      emailToClientId.get(fromEmail) ?? emailToClientId.get(toEmail) ?? null;

    if (exactMatch) {
      return {
        clientId: exactMatch,
        confidence: "exact",
        needsReview: false,
        suggestedClientId: null,
      };
    }

    // ── Tier 2: Domain match ────────────────────────────────────
    const fromDomain = fromEmail.split("@")[1];
    const toDomain = toEmail.split("@")[1];
    const domainToCheck = fromDomain && !PUBLIC_EMAIL_DOMAINS.has(fromDomain)
      ? fromDomain
      : toDomain && !PUBLIC_EMAIL_DOMAINS.has(toDomain)
        ? toDomain
        : null;

    if (domainToCheck) {
      const matchedIds = domainToClientIds.get(domainToCheck);
      if (matchedIds && matchedIds.length === 1) {
        return {
          clientId: matchedIds[0],
          confidence: "domain",
          needsReview: false,
          suggestedClientId: null,
        };
      }
      if (matchedIds && matchedIds.length > 1) {
        // Ambiguous: multiple clients share domain
        return {
          clientId: matchedIds[0],
          confidence: "domain",
          needsReview: true,
          suggestedClientId: matchedIds[1],
        };
      }
    }

    // ── Tier 3: Phone in signature ──────────────────────────────
    const phones = snippet.match(PHONE_REGEX) ?? [];
    for (const phone of phones) {
      const normalized = normalizePhone(phone);
      if (normalized.length >= 10) {
        const phoneMatch = phoneToClientId.get(normalized);
        if (phoneMatch) {
          return {
            clientId: null, // Don't auto-link
            confidence: "phone",
            needsReview: true,
            suggestedClientId: phoneMatch,
          };
        }
      }
    }

    // ── Unmatched ───────────────────────────────────────────────
    return {
      clientId: null,
      confidence: "unmatched",
      needsReview: false,
      suggestedClientId: null,
    };
  },
};
