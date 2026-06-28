import type { AnalyzedLead } from "@/lib/types/email-import";

const STAGE_RANK: Record<string, number> = {
  new_lead: 10,
  qualifying: 20,
  quoting: 30,
  quoted: 40,
  follow_up: 45,
  negotiation: 50,
  lost: 90,
  won: 100,
  discarded: 100,
};

function cleanEmailAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).toLowerCase().trim();
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .toLowerCase()
    .replace(/\b(crescent|cres)\b/g, "cres")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(lane|ln)\b/g, "lane")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(court|ct)\b/g, "ct")
    .replace(/\b(place|pl)\b/g, "pl")
    .replace(/[^a-z0-9]/g, "");
  return normalized.length >= 8 ? normalized : null;
}

function normalizeName(value: string | null | undefined): string | null {
  if (!value || value.includes("@")) return null;
  const normalized = value.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length >= 3 ? normalized : null;
}

function firstName(value: string | null | undefined): string | null {
  const normalized = normalizeName(value);
  const first = normalized?.split(" ")[0] ?? null;
  return first && first.length >= 3 ? first : null;
}

function duplicateKeys(lead: AnalyzedLead): string[] {
  const keys: string[] = [];
  const email = cleanEmailAddress(lead.client.email);
  const phone = normalizePhone(lead.client.phone);
  const address = normalizeAddress(lead.client.address);
  const name = normalizeName(lead.client.name);
  const first = firstName(lead.client.name);

  if (email) keys.push(`email:${email}`);
  if (phone && address) keys.push(`phone_address:${phone}:${address}`);
  if (phone && name) keys.push(`name_phone:${name}:${phone}`);
  if (address && name) keys.push(`name_address:${name}:${address}`);
  if (address && first) keys.push(`first_address:${first}:${address}`);

  return keys;
}

function betterDescription(current: string, candidate: string): string {
  if (isBlank(current)) return candidate;
  if (candidate.length > current.length) return candidate;
  return current;
}

function mergeSubContacts(
  primary: AnalyzedLead["subContacts"],
  incoming: AnalyzedLead["subContacts"]
): AnalyzedLead["subContacts"] {
  const seen = new Set(primary.map((sc) => sc.email.toLowerCase().trim()));
  const merged = [...primary];
  for (const sc of incoming) {
    const key = sc.email.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(sc);
  }
  return merged;
}

function mergeLeadIntoPrimary(primary: AnalyzedLead, other: AnalyzedLead): void {
  primary.correspondenceCount += other.correspondenceCount;
  primary.outboundCount += other.outboundCount;
  primary.emails = [...primary.emails, ...other.emails];

  if (other.emailExcerpts?.length) {
    primary.emailExcerpts = [...(primary.emailExcerpts || []), ...other.emailExcerpts];
  }

  if (isBlank(primary.client.phone) && !isBlank(other.client.phone)) {
    primary.client.phone = other.client.phone;
  }
  if (isBlank(primary.client.address) && !isBlank(other.client.address)) {
    primary.client.address = other.client.address;
  }
  if (!isBlank(other.client.description)) {
    primary.client.description = betterDescription(
      primary.client.description,
      other.client.description
    );
  }

  if (
    other.estimatedValue &&
    (!primary.estimatedValue || other.estimatedValue > primary.estimatedValue)
  ) {
    primary.estimatedValue = other.estimatedValue;
  }

  if (other.lastMessageDate > primary.lastMessageDate) {
    primary.lastMessageDate = other.lastMessageDate;
  }

  const otherRank = STAGE_RANK[other.stage] ?? 0;
  const primaryRank = STAGE_RANK[primary.stage] ?? 0;
  if (otherRank > primaryRank) {
    primary.stage = other.stage;
    primary.stageConfidence = Math.max(
      primary.stageConfidence,
      other.stageConfidence
    );
    primary.terminalFlag = other.terminalFlag ?? primary.terminalFlag ?? null;
  }

  if (other.needsReview) {
    primary.needsReview = true;
    primary.reviewReason = other.reviewReason ?? primary.reviewReason ?? null;
    primary.enabled = false;
  }

  primary.subContacts = mergeSubContacts(primary.subContacts, other.subContacts);
}

export function deduplicateAnalyzedLeads(leads: AnalyzedLead[]): AnalyzedLead[] {
  const parent = new Map<number, number>();
  const keyOwner = new Map<string, number>();

  const find = (index: number): number => {
    const current = parent.get(index) ?? index;
    if (current === index) return index;
    const root = find(current);
    parent.set(index, root);
    return root;
  };

  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  leads.forEach((lead, index) => {
    parent.set(index, index);
    for (const key of duplicateKeys(lead)) {
      const existing = keyOwner.get(key);
      if (existing == null) {
        keyOwner.set(key, index);
      } else {
        union(existing, index);
      }
    }
  });

  const groupsByRoot = new Map<number, AnalyzedLead[]>();
  leads.forEach((lead, index) => {
    const root = find(index);
    if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
    groupsByRoot.get(root)!.push(lead);
  });

  const deduplicated: AnalyzedLead[] = [];
  for (const [, group] of groupsByRoot) {
    if (group.length === 1) {
      deduplicated.push(group[0]);
      continue;
    }

    group.sort((a, b) => b.correspondenceCount - a.correspondenceCount);
    const primary: AnalyzedLead = {
      ...group[0],
      client: { ...group[0].client },
      emails: [...group[0].emails],
      subContacts: [...group[0].subContacts],
      emailExcerpts: group[0].emailExcerpts
        ? [...group[0].emailExcerpts]
        : undefined,
    };

    for (let i = 1; i < group.length; i++) {
      mergeLeadIntoPrimary(primary, group[i]);
    }

    if (primary.emailExcerpts && primary.emailExcerpts.length > 0) {
      const seen = new Set<string>();
      primary.emailExcerpts = primary.emailExcerpts
        .filter((ex) => {
          const key = `${ex.date}|${ex.from}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(-8);
    }

    primary.duplicateGroupId = group.map((g) => g.threadId).join(",");
    deduplicated.push(primary);
  }

  return deduplicated;
}
