import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { IngestionOperatorIdentity } from "@/lib/email/email-ingestion-routing";
import {
  extractEmailAddress,
  stripQuotedHistoryForIdentity,
} from "@/lib/utils/email-parsing";

/** A named introduction to an actual recipient identifies a customer, not authorship. */
export function resolveInboundReferralContact(
  email: Pick<NormalizedEmail, "from" | "to" | "cc" | "bodyText">,
  operator: IngestionOperatorIdentity
): { name: string; email: string } | null {
  const normalize = (value: string) =>
    extractEmailAddress(value).trim().toLowerCase();
  const excluded = new Set(
    [
      email.from,
      operator.connectionEmail,
      ...(operator.userEmailAddresses ?? []),
      ...(operator.teamForwarders ?? []),
      ...(operator.knownPlatformSenders ?? []),
      ...(operator.staffMembers ?? []).flatMap((member) => [
        member.registeredEmail,
        ...member.verifiedAliases,
        ...member.pendingAliases,
      ]),
    ].map(normalize)
  );
  const domains = new Set(
    (operator.companyDomains ?? []).map((domain) => domain.toLowerCase())
  );
  const current = stripQuotedHistoryForIdentity(email.bodyText).replace(
    /\s+/g,
    " "
  );
  const candidates = new Map<string, { name: string; email: string }>();
  for (const header of [...email.to, ...email.cc]) {
    const address = normalize(header);
    if (!address || excluded.has(address) || domains.has(address.split("@")[1]))
      continue;
    // Display names must come from the recipient header, never an address guess.
    const name = header.match(/^\s*"?([^<>]+?)"?\s*<[^<>]+>\s*$/)?.[1]?.trim();
    if (!name || !/^[\p{L}][\p{L} .'-]+$/u.test(name)) continue;
    const escape = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const named = `(?:${escape(name)}|${escape(name.split(/\s+/)[0])})`;
    const introduction = new RegExp(
      `\\bI(?:(?:\\s+will|'ll)\\s+leave|(?:'d|\\s+would)\\s+like\\s+to\\s+(?:introduce|connect|refer)|(?:'m|\\s+am)\\s+(?:introducing|connecting|referring))\\s+${named}\\s+(?:with|to)\\s+you\\b`,
      "i"
    );
    const affirmative = current
      .split(/[.!?]/)
      .some(
        (sentence) =>
          !/\b(?:if|unless|when|once|not|never|provided|might|maybe)\b/i.test(
            sentence
          ) && introduction.test(sentence)
      );
    if (affirmative) candidates.set(address, { name, email: address });
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}
