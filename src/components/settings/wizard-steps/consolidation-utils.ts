import { PUBLIC_EMAIL_DOMAINS } from "@/lib/types/pipeline";
import { normalizeCompanyName } from "@/lib/utils/name-normalization";
import type { AnalyzedLead, ConsolidationGroup } from "@/lib/types/email-import";

/**
 * Build consolidation groups from leads that need user review.
 *
 * Groups are created when:
 * 1. Multiple leads share a non-public email domain (highest confidence)
 * 2. Multiple leads share a normalized company name (fuzzy match)
 * 3. A single lead has subContacts — user should confirm the contact list
 * 4. A lead was merged from multiple threads (duplicateGroupId set) — user
 *    should confirm the merge was correct
 *
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

    // Group by normalized name (fuzzy — strips suffixes like Inc/Ltd/LLC)
    const nameKey = normalizeCompanyName(lead.client.name);
    if (nameKey.length >= 2) {
      const existingName = nameMap.get(nameKey) || [];
      existingName.push(lead);
      nameMap.set(nameKey, existingName);
    }
  }

  const groups: ConsolidationGroup[] = [];
  const processedLeadIds = new Set<string>();

  // ─── 1. Domain groups (highest confidence) ──────────────────────────────
  for (const [domain, domainLeads] of domainMap) {
    if (domainLeads.length < 2) continue;

    // Use the lead's client.name if they all match, otherwise derive from domain
    const names = new Set(domainLeads.map((l) => l.client.name));
    const companyName = names.size === 1
      ? domainLeads[0].client.name
      : domain
          .split(".")[0]
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());

    // Collect all contacts: client contacts + their subContacts
    const contacts = domainLeads.flatMap((l) => {
      const primary = { leadId: l.id, name: l.client.name, email: l.client.email, phone: l.client.phone };
      const subs = (l.subContacts || []).map((sc) => ({
        leadId: l.id,
        name: sc.name,
        email: sc.email,
        phone: sc.phone,
      }));
      return [primary, ...subs];
    });
    // Deduplicate contacts by email
    const seenEmails = new Set<string>();
    const uniqueContacts = contacts.filter((c) => {
      const key = c.email.toLowerCase();
      if (seenEmails.has(key)) return false;
      seenEmails.add(key);
      return true;
    });

    groups.push({
      id: `domain-${domain}`,
      companyName,
      domain,
      contacts: uniqueContacts,
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

  // ─── 2. Name groups (fuzzy match, skip already-grouped leads) ───────────
  for (const [, nameLeads] of nameMap) {
    const ungrouped = nameLeads.filter((l) => !processedLeadIds.has(l.id));
    if (ungrouped.length < 2) continue;

    const contacts = ungrouped.flatMap((l) => {
      const primary = { leadId: l.id, name: l.client.name, email: l.client.email, phone: l.client.phone };
      const subs = (l.subContacts || []).map((sc) => ({
        leadId: l.id,
        name: sc.name,
        email: sc.email,
        phone: sc.phone,
      }));
      return [primary, ...subs];
    });
    const seenEmails = new Set<string>();
    const uniqueContacts = contacts.filter((c) => {
      const key = c.email.toLowerCase();
      if (seenEmails.has(key)) return false;
      seenEmails.add(key);
      return true;
    });

    groups.push({
      id: `name-${ungrouped[0].client.name.toLowerCase().replace(/\s+/g, "-")}`,
      companyName: ungrouped[0].client.name,
      domain: null,
      contacts: uniqueContacts,
      leads: ungrouped.map((l) => ({
        leadId: l.id,
        title: "",
        primaryContactEmail: l.client.email,
        correspondenceCount: l.correspondenceCount,
        lastMessageDate: l.lastMessageDate,
      })),
      decision: null,
    });
    ungrouped.forEach((l) => processedLeadIds.add(l.id));
  }

  // ─── 3. Single leads with subContacts or merged threads ─────────────────
  // These aren't multi-lead groups but need user review to confirm the
  // contact list or thread merge is correct.
  for (const lead of leads) {
    if (!lead.enabled || processedLeadIds.has(lead.id)) continue;

    const hasSubContacts = (lead.subContacts?.length ?? 0) > 0;
    const wasMerged = !!lead.duplicateGroupId && lead.duplicateGroupId.includes(",");

    if (!hasSubContacts && !wasMerged) continue;

    const contacts = [
      { leadId: lead.id, name: lead.client.name, email: lead.client.email, phone: lead.client.phone },
      ...(lead.subContacts || []).map((sc) => ({
        leadId: lead.id,
        name: sc.name,
        email: sc.email,
        phone: sc.phone,
      })),
    ];
    // Deduplicate contacts by email
    const seenEmails = new Set<string>();
    const uniqueContacts = contacts.filter((c) => {
      const key = c.email.toLowerCase();
      if (seenEmails.has(key)) return false;
      seenEmails.add(key);
      return true;
    });

    // Only create a group if there are actually multiple distinct contacts
    if (uniqueContacts.length < 2) continue;

    groups.push({
      id: `contacts-${lead.id}`,
      companyName: lead.client.name,
      domain: lead.client.email.split("@")[1]?.toLowerCase() || null,
      contacts: uniqueContacts,
      leads: [{
        leadId: lead.id,
        title: "",
        primaryContactEmail: lead.client.email,
        correspondenceCount: lead.correspondenceCount,
        lastMessageDate: lead.lastMessageDate,
      }],
      decision: null,
    });
    processedLeadIds.add(lead.id);
  }

  return groups;
}
