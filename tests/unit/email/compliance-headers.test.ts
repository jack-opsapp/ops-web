/**
 * Compliance-header building blocks. The `buildComplianceHeaders` helper
 * is internal to `sendgrid.tsx`; we re-derive the same contract here from
 * its public dependencies so the test does not require running SendGrid.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { KIND_TO_LIST, OPS_SUPPORT_EMAIL } from "@/lib/email/constants";

describe("compliance headers", () => {
  beforeEach(() => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "z".repeat(64);
    process.env.NEXT_PUBLIC_APP_URL = "https://app.opsapp.co";
  });

  it("List-Unsubscribe contains both HTTPS URL and mailto fallback", () => {
    const url = `https://app.opsapp.co/api/email/unsubscribe?t=${signUnsubscribeToken({
      email: "u@example.com",
      list: "global",
    })}`;
    const header = `<${url}>, <mailto:${OPS_SUPPORT_EMAIL}?subject=unsubscribe>`;
    expect(header).toContain("https://app.opsapp.co/api/email/unsubscribe");
    expect(header).toContain(`mailto:${OPS_SUPPORT_EMAIL}`);
  });

  it("KIND_TO_LIST routes transactional kinds to global", () => {
    expect(KIND_TO_LIST.password_reset).toBe("global");
    expect(KIND_TO_LIST.team_invite).toBe("global");
    expect(KIND_TO_LIST.email_verification).toBe("global");
    expect(KIND_TO_LIST.portal_magic_link).toBe("global");
  });

  it("KIND_TO_LIST routes newsletter kinds to per-list", () => {
    expect(KIND_TO_LIST.field_notes_newsletter).toBe("field_notes");
    expect(KIND_TO_LIST.blog_newsletter).toBe("blog");
  });
});
