// src/lib/api/services/email-filter-service.ts
/**
 * OPS Web - Email Filter Service
 *
 * Manages pre-seeded and user-configured email noise filters.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type { EmailFilterPreset, GmailSyncFilters, EmailFilterRule } from "@/lib/types/pipeline";

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
    syncFilters: GmailSyncFilters,
    labelIds?: string[],
    body?: string,
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

    // Evaluate structured filter rules (include-style: if rules exist and don't match, filter out)
    if (syncFilters.rules && syncFilters.rules.length > 0) {
      const matchesRules = this.evaluateRules(
        syncFilters.rules,
        syncFilters.ruleLogic ?? "all",
        { fromEmail, subject, domain, labelIds: labelIds ?? [], body: body ?? "" },
      );
      if (!matchesRules) return true;
    }

    return false;
  },

  /** Evaluate structured filter rules against an email */
  evaluateRules(
    rules: EmailFilterRule[],
    logic: "all" | "any",
    email: { fromEmail: string; subject: string; domain: string; labelIds: string[]; body: string },
  ): boolean {
    if (rules.length === 0) return true;

    const results = rules.map((rule) => this.evaluateRule(rule, email));
    return logic === "all" ? results.every(Boolean) : results.some(Boolean);
  },

  /** Evaluate a single filter rule */
  evaluateRule(
    rule: EmailFilterRule,
    email: { fromEmail: string; subject: string; domain: string; labelIds: string[]; body: string },
  ): boolean {
    let fieldValue: string;
    switch (rule.field) {
      case "subject":
        fieldValue = email.subject;
        break;
      case "from_email":
        fieldValue = email.fromEmail;
        break;
      case "from_domain":
        fieldValue = email.domain;
        break;
      case "label":
        // For labels, check membership
        return this.evaluateLabelRule(rule.operator, rule.value, email.labelIds);
      case "body":
        fieldValue = email.body;
        break;
      default:
        return true;
    }

    const val = fieldValue.toLowerCase();
    const ruleVal = rule.value.toLowerCase();

    switch (rule.operator) {
      case "contains":
        return val.includes(ruleVal);
      case "not_contains":
        return !val.includes(ruleVal);
      case "equals":
        return val === ruleVal;
      case "not_equals":
        return val !== ruleVal;
      case "starts_with":
        return val.startsWith(ruleVal);
      case "ends_with":
        return val.endsWith(ruleVal);
      default:
        return true;
    }
  },

  /** Evaluate label-specific rules */
  evaluateLabelRule(
    operator: string,
    value: string,
    labelIds: string[],
  ): boolean {
    const labelUpper = value.toUpperCase();
    const has = labelIds.some((l) => l.toUpperCase() === labelUpper);
    switch (operator) {
      case "equals":
      case "contains":
        return has;
      case "not_equals":
      case "not_contains":
        return !has;
      default:
        return true;
    }
  },
};
