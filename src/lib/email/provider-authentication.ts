/**
 * Extract the authenticated RFC5322.From domains recorded by Gmail itself.
 *
 * Only the first Authentication-Results header issued by Google's receiving
 * MX is authoritative. A sender can include lower, forged headers in the raw
 * message, but Gmail prepends its own result ahead of sender-supplied headers.
 * We collect DMARC, DKIM, and SPF pass domains. The ingestion trust boundary
 * separately requires an exact match with the visible wrapper From domain, so
 * an unaligned envelope sender is never sufficient. That aligned-SPF path is
 * required for Google Workspace forwards: Gmail can report Workspace DKIM on
 * a gappssmtp.com signing subdomain while the authenticated smtp.mailfrom is
 * the visible custom domain.
 */
export function gmailAuthenticatedFromDomains(
  headers: Array<{ name: string; value: string }>
): string[] {
  const result = headers.find((header) => {
    if (header.name.trim().toLowerCase() !== "authentication-results") {
      return false;
    }
    return /^\s*mx\.google\.com\s*;/i.test(header.value);
  });
  if (!result) return [];

  const domains = new Set<string>();
  const value = result.value.toLowerCase();
  for (const match of value.matchAll(
    /dmarc=pass\b[^;]*\bheader\.from=([^\s;]+)/gi
  )) {
    const domain = match[1]?.replace(/^@/, "").replace(/\.$/, "");
    if (domain) domains.add(domain);
  }
  for (const match of value.matchAll(
    /dkim=pass\b[^;]*\bheader\.i=@?([^\s;>]+)/gi
  )) {
    const domain = match[1]?.replace(/^@/, "").replace(/\.$/, "");
    if (domain) domains.add(domain);
  }
  for (const match of value.matchAll(
    /spf=pass\b[^;]*\bsmtp\.mailfrom=([^\s;]+)/gi
  )) {
    const identity = match[1]
      ?.replace(/^[<\"]+|[>\"]+$/g, "")
      .replace(/\.$/, "");
    const domain = identity?.includes("@")
      ? identity.slice(identity.lastIndexOf("@") + 1)
      : identity;
    if (domain) domains.add(domain);
  }
  return [...domains];
}
