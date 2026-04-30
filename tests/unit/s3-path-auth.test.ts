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
