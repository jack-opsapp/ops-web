/**
 * Lead-photo array merge semantics — the pure core of the server-state
 * read-modify-write contract (bible 03 § Images contract). These helpers
 * always operate on the JUST-FETCHED server array; the service methods
 * (`OpportunityService.appendImages` / `removeImage`) re-fetch the row and
 * feed it here, mirroring iOS `OpportunityRepository.appendImages/removeImage`
 * exactly: dedupe + skip-empty on append, strict filter on remove, server
 * order preserved.
 */

import { describe, expect, it } from "vitest";
import {
  mergeImageUrls,
  removeImageUrl,
} from "@/lib/utils/opportunity-images";

const A = "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/opportunities/c/o/1.jpg";
const B = "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/opportunities/c/o/2.jpg";
const C = "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/email-imports/c/o/3.png";

describe("mergeImageUrls", () => {
  it("appends new urls after the server array, preserving both orders", () => {
    expect(mergeImageUrls([A], [B, C])).toEqual([A, B, C]);
  });

  it("keeps urls another producer landed since our snapshot (the clobber case)", () => {
    // Server grew to [A, C] while this client only knew about [A]. The RMW
    // contract: merge against the SERVER array, so C survives.
    expect(mergeImageUrls([A, C], [B])).toEqual([A, C, B]);
  });

  it("drops additions the server already has (idempotent re-append)", () => {
    expect(mergeImageUrls([A, B], [B])).toEqual([A, B]);
  });

  it("dedupes within the additions batch itself", () => {
    expect(mergeImageUrls([], [A, A, B])).toEqual([A, B]);
  });

  it("skips empty strings", () => {
    expect(mergeImageUrls([A], ["", B])).toEqual([A, B]);
  });

  it("tolerates a null/undefined server array (column starts NULL)", () => {
    expect(mergeImageUrls(null, [A])).toEqual([A]);
    expect(mergeImageUrls(undefined, [A])).toEqual([A]);
  });

  it("returns a fresh array — never mutates the server snapshot", () => {
    const server = [A];
    const merged = mergeImageUrls(server, [B]);
    expect(server).toEqual([A]);
    expect(merged).not.toBe(server);
  });
});

describe("removeImageUrl", () => {
  it("removes exactly the given url", () => {
    expect(removeImageUrl([A, B, C], B)).toEqual([A, C]);
  });

  it("leaves the array unchanged when the url is absent", () => {
    expect(removeImageUrl([A, B], C)).toEqual([A, B]);
  });

  it("tolerates a null server array", () => {
    expect(removeImageUrl(null, A)).toEqual([]);
  });

  it("does not partially match prefixes", () => {
    expect(removeImageUrl([`${A}?w=100`, A], A)).toEqual([`${A}?w=100`]);
  });
});
