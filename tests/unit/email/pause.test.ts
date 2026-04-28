/**
 * Unit tests for src/lib/email/pause.ts.
 *
 * The bucket resolver has zero dependencies and is pure — perfect candidate
 * for unit coverage. Read/write paths are exercised in the integration test
 * for the admin routes (which mocks the service layer).
 */
import { describe, it, expect } from "vitest";
import { resolveEmailBucket } from "@/lib/email/pause";

describe("resolveEmailBucket", () => {
  it("routes auth kinds to gate", () => {
    expect(resolveEmailBucket("password_reset")).toBe("gate");
    expect(resolveEmailBucket("email_verification")).toBe("gate");
    expect(resolveEmailBucket("email_change_confirmation")).toBe("gate");
  });

  it("routes newsletter kinds to field_notes", () => {
    expect(resolveEmailBucket("blog_newsletter")).toBe("field_notes");
    expect(resolveEmailBucket("field_notes_newsletter")).toBe("field_notes");
  });

  it("routes portal kinds to portal", () => {
    expect(resolveEmailBucket("portal_magic_link")).toBe("portal");
    expect(resolveEmailBucket("portal_invoice_ready")).toBe("portal");
    expect(resolveEmailBucket("portal_estimate_ready")).toBe("portal");
    expect(resolveEmailBucket("portal_questions_reminder")).toBe("portal");
  });

  it("defaults unknown / product / billing kinds to dispatch", () => {
    expect(resolveEmailBucket("trial_expiry_warning")).toBe("dispatch");
    expect(resolveEmailBucket("ads_briefing")).toBe("dispatch");
    expect(resolveEmailBucket("unmapped_kind_xyz")).toBe("dispatch");
    expect(resolveEmailBucket("")).toBe("dispatch");
  });
});
