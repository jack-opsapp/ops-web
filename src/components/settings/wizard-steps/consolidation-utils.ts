import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";
import type { AnalyzedLead, ConsolidationGroup } from "@/lib/types/email-import";

/**
 * Build consolidation groups from leads sharing a company domain or name.
 * Used by both ConsolidateContactsStep and the main wizard (for skip-detection).
 */
export function buildConsolidationGroups(
  leads: AnalyzedLead[]
): ConsolidationGroup[] {
  const domainMap = new Map<string, AnalyzedLead[]>();
  const nameMap = new Map<string, AnalyzedLead[]>();

  for (const lead of leads) {
    if (!lead.enabled) continue;

    // Group by non-public email domain
    const domain = lead.client.email.split("@")[1]?.toLowerCase();
    if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
      const existing = domainMap.get(domain) || [];
      existing.push(lead);
      domainMap.set(domain, existing);
    }

    // Group by exact name match (case-insensitive)
    const nameKey = lead.client.name.toLowerCase().trim();
    const existingName = nameMap.get(nameKey) || [];
    existingName.push(lead);
    nameMap.set(nameKey, existingName);
  }

  const groups: ConsolidationGroup[] = [];
  const processedLeadIds = new Set<string>();

  // Domain groups first (higher confidence)
  for (const [domain, domainLeads] of domainMap) {
    if (domainLeads.length < 2) continue;

    // Derive company name from domain — strip TLD and title-case
    const companyName = domain
      .split(".")[0]
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    groups.push({
      id: `domain-${domain}`,
      companyName,
      domain,
      contacts: domainLeads.map((l) => ({
        leadId: l.id,
        name: l.client.name,
        email: l.client.email,
        phone: l.client.phone,
      })),
      leads: domainLeads.map((l) => ({
        leadId: l.id,
        title: "",
        primaryContactEmail: l.client.email,
        correspondenceCount: l.correspondenceCount,
        lastMessageDate: l.lastMessageDate,
      })),
      decision: null,
    });
    domainLeads.forEach((l) => processedLeadIds.add(l.id));
  }

  // Name groups (lower confidence, skip already-grouped leads)
  for (const [, nameLeads] of nameMap) {
    const ungrouped = nameLeads.filter((l) => !processedLeadIds.has(l.id));
    if (ungrouped.length < 2) continue;

    groups.push({
      id: `name-${ungrouped[0].client.name.toLowerCase().replace(/\s+/g, "-")}`,
      companyName: ungrouped[0].client.name,
      domain: null,
      contacts: ungrouped.map((l) => ({
        leadId: l.id,
        name: l.client.name,
        email: l.client.email,
        phone: l.client.phone,
      })),
      leads: ungrouped.map((l) => ({
        leadId: l.id,
        title: "",
        primaryContactEmail: l.client.email,
        correspondenceCount: l.correspondenceCount,
        lastMessageDate: l.lastMessageDate,
      })),
      decision: null,
    });
  }

  return groups;
}
