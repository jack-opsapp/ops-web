/**
 * Lead-photo array merge semantics — the pure core of the server-state
 * read-modify-write contract on `opportunities.images` (bible 03 § Images
 * contract). Mirrors iOS `OpportunityRepository.appendImages/removeImage`:
 * the caller fetches the CURRENT server row and passes its array here, so a
 * client holding a stale local array can never blow away photos another
 * producer (iOS device, email-extract pipeline, another web tab) already
 * landed.
 */

/** Append `additions` to the just-fetched server array — skip empties, dedupe, preserve order. */
export function mergeImageUrls(
  server: string[] | null | undefined,
  additions: string[],
): string[] {
  const merged = [...(server ?? [])];
  for (const url of additions) {
    if (url && !merged.includes(url)) merged.push(url);
  }
  return merged;
}

/** Remove exactly `url` from the just-fetched server array. */
export function removeImageUrl(
  server: string[] | null | undefined,
  url: string,
): string[] {
  return (server ?? []).filter((existing) => existing !== url);
}
