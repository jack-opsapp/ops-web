/**
 * Unit tests for the S3 folder + filename authorization helpers.
 *
 * These functions are the security boundary for the upload-presign
 * endpoint: every byte that lands in `ops-app-files-prod` flows
 * through them, and a regression here would let one tenant write into
 * another's prefix.
 */

import { describe, it, expect } from "vitest";
import {
  authorizeFolder,
  sanitizeFilename,
  inferExtension,
  buildUniqueSuffix,
} from "@/lib/s3/path-auth";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";
const PROJECT_ID = "33333333-3333-3333-3333-333333333333";

describe("authorizeFolder", () => {
  it("accepts a folder that already contains the caller's companyId", () => {
    const result = authorizeFolder(`projects/${COMPANY_A}/${PROJECT_ID}`, COMPANY_A);
    expect(result).toEqual({ ok: true, folder: `projects/${COMPANY_A}/${PROJECT_ID}` });
  });

  it("appends caller's companyId when folder lacks it", () => {
    const result = authorizeFolder("profiles", COMPANY_A);
    expect(result).toEqual({ ok: true, folder: `profiles/${COMPANY_A}` });
  });

  it("appends companyId for an empty folder string", () => {
    const result = authorizeFolder("", COMPANY_A);
    expect(result).toEqual({ ok: true, folder: COMPANY_A });
  });

  it("appends companyId when folder has only non-UUID segments", () => {
    const result = authorizeFolder("blog-thumbnails", COMPANY_A);
    expect(result).toEqual({ ok: true, folder: `blog-thumbnails/${COMPANY_A}` });
  });

  it("rejects a folder that names a different company UUID", () => {
    const result = authorizeFolder(`projects/${COMPANY_B}/${PROJECT_ID}`, COMPANY_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/different company/i);
  });

  it("rejects a folder with .. traversal", () => {
    const result = authorizeFolder("../etc/passwd", COMPANY_A);
    expect(result.ok).toBe(false);
  });

  it("rejects folder segments with disallowed characters", () => {
    const result = authorizeFolder("projects/has space/x", COMPANY_A);
    expect(result.ok).toBe(false);
  });

  it("rejects when callerCompanyId itself is not a UUID", () => {
    const result = authorizeFolder("anything", "not-a-uuid");
    expect(result.ok).toBe(false);
  });

  it("normalizes leading and trailing slashes", () => {
    const result = authorizeFolder(`/projects/${COMPANY_A}/${PROJECT_ID}/`, COMPANY_A);
    expect(result).toEqual({ ok: true, folder: `projects/${COMPANY_A}/${PROJECT_ID}` });
  });

  it("collapses repeated slashes via empty-segment filter", () => {
    const result = authorizeFolder(`projects//${COMPANY_A}/${PROJECT_ID}`, COMPANY_A);
    expect(result).toEqual({ ok: true, folder: `projects/${COMPANY_A}/${PROJECT_ID}` });
  });

  it("accepts a project-scoped folder where projectId is a UUID under caller's company", () => {
    // Realistic iOS pattern: `projects/{companyId}/{projectId}` where
    // both are UUIDs but only one is the caller's company.
    const result = authorizeFolder(`projects/${COMPANY_A}/${PROJECT_ID}`, COMPANY_A);
    expect(result.ok).toBe(true);
  });

  it("preserves training_data nested folders for caller's company", () => {
    const folder = `training_data/deck_scanner/${COMPANY_A}/user-1/2026-04-30`;
    const result = authorizeFolder(folder, COMPANY_A);
    expect(result).toEqual({ ok: true, folder });
  });

  // The bucket's public-read policy is written against the established
  // `company-{uuid}/...` families. A folder already in that shape is
  // company-scoped by construction, so it must survive untouched —
  // appending the bare id would push the object out of the public prefix
  // and every read of it would 403.
  it("accepts a company-prefixed segment naming the caller, without appending", () => {
    const result = authorizeFolder(`company-${COMPANY_A}/logos`, COMPANY_A);
    expect(result).toEqual({ ok: true, folder: `company-${COMPANY_A}/logos` });
  });

  it("accepts a company-prefixed segment on its own", () => {
    const result = authorizeFolder(`company-${COMPANY_A}`, COMPANY_A);
    expect(result).toEqual({ ok: true, folder: `company-${COMPANY_A}` });
  });

  it("matches a company-prefixed segment case-insensitively", () => {
    const folder = `company-${COMPANY_A.toUpperCase()}/logos`;
    const result = authorizeFolder(folder, COMPANY_A);
    expect(result).toEqual({ ok: true, folder });
  });

  it("accepts a company-prefixed segment deeper in the path", () => {
    const folder = `company-${COMPANY_A}/logos/nested`;
    const result = authorizeFolder(folder, COMPANY_A);
    expect(result).toEqual({ ok: true, folder });
  });

  it("rejects a company-prefixed segment naming a different company", () => {
    const result = authorizeFolder(`company-${COMPANY_B}/logos`, COMPANY_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/different company/i);
  });

  it("rejects a company-prefixed foreign id even beside a legitimate segment", () => {
    const result = authorizeFolder(
      `company-${COMPANY_B}/logos/${PROJECT_ID}`,
      COMPANY_A
    );
    expect(result.ok).toBe(false);
  });

  // Only an exact `company-{uuid}` counts as a scope claim. A folder that
  // merely starts with the word keeps the legacy append behaviour, so no
  // existing caller silently changes shape.
  it("appends companyId for a company-prefixed segment that is not a UUID", () => {
    const result = authorizeFolder("company-legacy/logos", COMPANY_A);
    expect(result).toEqual({
      ok: true,
      folder: `company-legacy/logos/${COMPANY_A}`,
    });
  });
});

// A generic folder may only mint keys inside namespaces no dedicated writer
// owns. Every namespace below has a server-built key and (where it takes
// caller input) its own permission check; letting the generic folder lane
// reach it would bypass that check. Refusal, never a silent rewrite.
describe("authorizeFolder — reserved namespaces", () => {
  const VISIT_ID = "44444444-4444-4444-4444-444444444444";
  const USER_ID = "55555555-5555-5555-5555-555555555555";
  const EXPENSE_ID = "66666666-6666-6666-6666-666666666666";

  it.each([
    ["site visit media", `site-visits/${COMPANY_A}/${VISIT_ID}`],
    ["site visit root (company appended)", "site-visits"],
    ["site visit, mixed case", `Site-Visits/${COMPANY_A}/${VISIT_ID}`],
    ["site visit, upper-case ids", `SITE-VISITS/${COMPANY_A.toUpperCase()}/x`],
    ["site visit, stray slashes", `//site-visits//${COMPANY_A}/${VISIT_ID}/`],
    ["site visit, padded", `  site-visits/${COMPANY_A}  `],
    ["expense receipt tree", `expenses/${COMPANY_A}/${USER_ID}/${EXPENSE_ID}`],
    ["expense subfolder", `expenses/${COMPANY_A}/anything`],
    ["expense, upper-case root", `EXPENSES/${COMPANY_A}`],
    ["expense, company-prefixed", `expenses/company-${COMPANY_A}`],
    ["bug report screenshots", `bug-reports/${COMPANY_A}/r1`],
    ["generated documents", `documents/${COMPANY_A}`],
    ["blog images", "blog"],
    ["journal images", "blog/weekly"],
    ["shop images", "shop"],
    ["social media assets", `social-media/${COMPANY_A}`],
    ["intake quarantine", `quarantine/${COMPANY_A}`],
    ["intake accepted originals", `accepted-original/${COMPANY_A}`],
    ["intake safe derivatives", `safe-derivative/${COMPANY_A}`],
    ["supplier bill documents", `${COMPANY_A}/supplier-bills/r1`],
    ["supplier bills root", `${COMPANY_A}/supplier-bills`],
    [
      "supplier bills, mixed case",
      `${COMPANY_A.toUpperCase()}/Supplier-Bills/r1`,
    ],
  ])("refuses %s", (_label, folder) => {
    const result = authorizeFolder(folder, COMPANY_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/reserved/i);
  });

  it("refuses a dot segment that could resolve into a reserved namespace", () => {
    const result = authorizeFolder(`./site-visits/${COMPANY_A}`, COMPANY_A);
    expect(result.ok).toBe(false);
  });

  // App builds from before the typed receipt contract (2026-07-19) still
  // upload receipts through the generic lane as exactly
  // `expenses/{companyId}`. Those keys get a random suffix one level below
  // the company, so they can never land in a user's receipt tree.
  it("keeps the legacy receipt folder working", () => {
    expect(authorizeFolder(`expenses/${COMPANY_A}`, COMPANY_A)).toEqual({
      ok: true,
      folder: `expenses/${COMPANY_A}`,
    });
    expect(authorizeFolder("expenses", COMPANY_A)).toEqual({
      ok: true,
      folder: `expenses/${COMPANY_A}`,
    });
  });

  it.each([
    ["web default", "uploads", `uploads/${COMPANY_A}`],
    ["web profile", "profiles", `profiles/${COMPANY_A}`],
    ["project photos", `projects/${COMPANY_A}/${PROJECT_ID}`, null],
    ["lead photos", `projects/${COMPANY_A}/leads/${PROJECT_ID}`, null],
    ["note photos", `notes/${COMPANY_A}/${PROJECT_ID}`, null],
    ["client avatars", `client-images/${COMPANY_A}`, null],
    ["profile images", `profiles/${COMPANY_A}`, null],
    ["logos", `logos/${COMPANY_A}`, null],
    ["measurements", `measurements/${COMPANY_A}/${PROJECT_ID}`, null],
    ["annotations", `annotations/${COMPANY_A}/${PROJECT_ID}/strokes`, null],
    ["entity photos", `photos/${COMPANY_A}/project/${PROJECT_ID}`, null],
    ["deck designs", `deck_designs/${COMPANY_A}`, null],
    [
      "training data",
      `training_data/deck_scanner/${COMPANY_A}/${USER_ID}/2026-04-30`,
      null,
    ],
    ["signature logos", `company-${COMPANY_A}/logos`, null],
    ["look-alike root", `site-visits-archive/${COMPANY_A}`, null],
    ["reserved word below the root", `projects/${COMPANY_A}/site-visits`, null],
  ])("still accepts %s", (_label, folder, expected) => {
    expect(authorizeFolder(folder, COMPANY_A)).toEqual({
      ok: true,
      folder: expected ?? folder,
    });
  });
});

// Bare UUIDs are also entity ids (projects, visits, users), so a foreign
// UUID alone can't be refused. But the first segment that claims a company
// decides whose namespace the key lives in — it must be the caller's.
describe("authorizeFolder — company segment order", () => {
  it("refuses a foreign company that precedes the caller's", () => {
    const result = authorizeFolder(
      `projects/${COMPANY_B}/${COMPANY_A}`,
      COMPANY_A
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/different company/i);
  });

  it("refuses a foreign company root that precedes the caller's", () => {
    const result = authorizeFolder(`${COMPANY_B}/files/${COMPANY_A}`, COMPANY_A);
    expect(result.ok).toBe(false);
  });

  it("refuses an explicit foreign company-prefixed claim anywhere", () => {
    const result = authorizeFolder(
      `company-${COMPANY_A}/logos/company-${COMPANY_B}`,
      COMPANY_A
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a foreign company-prefixed root beside the caller's id", () => {
    const result = authorizeFolder(
      `company-${COMPANY_B}/logos/${COMPANY_A}`,
      COMPANY_A
    );
    expect(result.ok).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it("strips path components", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("foo/bar/baz.jpg")).toBe("baz.jpg");
  });

  it("replaces unsafe characters with underscore", () => {
    expect(sanitizeFilename("a b c.jpg")).toBe("a_b_c.jpg");
    expect(sanitizeFilename("strange chars %&*().jpg")).toBe("strange_chars______.jpg");
  });

  it("collapses repeated dots that look like traversal", () => {
    expect(sanitizeFilename("file..name.jpg")).toBe("file.name.jpg");
  });

  it("falls back to 'upload' for empty input", () => {
    expect(sanitizeFilename("")).toBe("upload");
    expect(sanitizeFilename(null)).toBe("upload");
    expect(sanitizeFilename(undefined)).toBe("upload");
  });

  it("strips leading dots / underscores / dashes", () => {
    expect(sanitizeFilename(".hidden.jpg")).toBe("hidden.jpg");
    expect(sanitizeFilename("---weird.png")).toBe("weird.png");
  });
});

describe("inferExtension", () => {
  it("returns the lowercased extension when present", () => {
    expect(inferExtension("photo.JPG", "jpg")).toBe("jpg");
    expect(inferExtension("crop.WEBP", "jpg")).toBe("webp");
  });

  it("returns the default when no extension is present", () => {
    expect(inferExtension("photo", "jpg")).toBe("jpg");
    expect(inferExtension(".dotonly.", "png")).toBe("png");
  });

  it("returns the default when extension contains non-alphanumerics", () => {
    expect(inferExtension("photo.j_p_g", "png")).toBe("png");
  });
});

describe("buildUniqueSuffix", () => {
  it("returns a {timestamp}-{rand} string", () => {
    const suffix = buildUniqueSuffix();
    expect(suffix).toMatch(/^\d{10,}-[a-z0-9]{6,8}$/);
  });

  it("returns distinct values across rapid calls", () => {
    const a = buildUniqueSuffix();
    const b = buildUniqueSuffix();
    // Same millisecond is possible — guarantee at least the random
    // segment differs across two consecutive calls.
    const aRand = a.split("-")[1];
    const bRand = b.split("-")[1];
    expect(aRand).not.toBe(bRand);
  });
});
