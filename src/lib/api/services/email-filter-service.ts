// src/lib/api/services/email-filter-service.ts
/**
 * OPS Web - Email Filter Service
 *
 * Manages pre-seeded and user-configured email noise filters.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type { EmailFilterPreset, GmailSyncFilters } from "@/lib/types/pipeline";

export const EmailFilterService = {
  /** Fetch all pre-seeded filter presets */
  async getPresets(): Promise<EmailFilterPreset[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_filter_presets")
      .select("*")
      .order("category");

    if (error) throw new Error(`Failed to fetch filter presets: ${error.message}`);
    return (data ?? []).map((row) => ({
      id: row.id as string,
      type: row.type as "domain" | "keyword",
      value: row.value as string,
      category: row.category as string,
    }));
  },

  /** Build a combined blocklist from presets + user filters */
  async buildBlocklist(
    syncFilters: GmailSyncFilters
  ): Promise<{ domains: Set<string>; keywords: string[] }> {
    const domains = new Set<string>(syncFilters.excludeDomains);
    const keywords = [...syncFilters.excludeSubjectKeywords];

    if (syncFilters.usePresetBlocklist) {
      const presets = await this.getPresets();
      for (const preset of presets) {
        if (preset.type === "domain") domains.add(preset.value);
        if (preset.type === "keyword") keywords.push(preset.value);
      }
    }

    return { domains, keywords };
  },

  /** Check if an email should be filtered out */
  shouldFilter(
    fromEmail: string,
    subject: string,
    blocklist: { domains: Set<string>; keywords: string[] },
    syncFilters: GmailSyncFilters
  ): boolean {
    const domain = fromEmail.split("@")[1]?.toLowerCase() ?? "";

    // Check domain blocklist
    if (blocklist.domains.has(domain)) return true;

    // Check noreply-style patterns
    const localPart = fromEmail.split("@")[0]?.toLowerCase() ?? "";
    if (
      localPart.startsWith("noreply") ||
      localPart.startsWith("no-reply") ||
      localPart.startsWith("donotreply") ||
      localPart.startsWith("do-not-reply") ||
      localPart.startsWith("mailer-daemon") ||
      localPart.startsWith("postmaster")
    ) {
      return true;
    }

    // Check address blocklist
    if (syncFilters.excludeAddresses.includes(fromEmail.toLowerCase())) return true;

    // Check subject keyword exclusions (case-insensitive)
    const subjectLower = subject.toLowerCase();
    for (const keyword of blocklist.keywords) {
      if (subjectLower.includes(keyword.toLowerCase())) return true;
    }

    return false;
  },
};
