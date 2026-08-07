import { describe, expect, it } from "vitest";

import { buildDraftSystemPrompt } from "../draft-system-prompt";

const PROFILE = {
  greeting_patterns: ["Hey {name},"],
  closing_patterns: ["Cheers,", "Thanks,"],
  tone_traits: { direct: true },
  avg_sentence_length: 11,
  formality_score: 0.4,
  vocabulary_preferences: {},
};

const OPERATOR = {
  firstName: "Jackson",
  lastName: "Sweet",
  companyName: "Canpro Deck and Rail",
};

describe("buildDraftSystemPrompt — operator identity", () => {
  it("names the operator the draft is written as", () => {
    const prompt = buildDraftSystemPrompt({
      profile: PROFILE,
      operator: OPERATOR,
      signatureWillBeAppended: false,
    });

    expect(prompt).toContain("OPERATOR IDENTITY");
    expect(prompt).toContain(
      "You are writing as Jackson Sweet of Canpro Deck and Rail."
    );
  });

  it("forbids adopting another person's identity from a forwarded message", () => {
    const prompt = buildDraftSystemPrompt({
      profile: PROFILE,
      operator: OPERATOR,
      signatureWillBeAppended: false,
    });

    expect(prompt).toContain(
      "Never sign as, or adopt contact details of, any other person appearing in the email — forwarded messages often carry someone else's signature."
    );
  });

  it("bans any written name or contact block when a signature is appended", () => {
    const prompt = buildDraftSystemPrompt({
      profile: PROFILE,
      operator: OPERATOR,
      signatureWillBeAppended: true,
    });

    expect(prompt).toContain(
      'End the email with your closing phrase only (e.g. "Cheers,").'
    );
    expect(prompt).toContain(
      "Do NOT write a name, phone number, or contact block — the operator's signature is appended automatically."
    );
    expect(prompt).not.toContain("first name only");
  });

  it("allows a first-name sign-off when no signature will be appended", () => {
    const prompt = buildDraftSystemPrompt({
      profile: PROFILE,
      operator: OPERATOR,
      signatureWillBeAppended: false,
    });

    expect(prompt).toContain(
      'Sign off with your closing phrase and first name only ("Jackson").'
    );
    expect(prompt).toContain("Never invent a phone number or contact block.");
    expect(prompt).not.toContain("is appended automatically");
  });

  it("keeps the impersonation ban when the operator identity is unknown", () => {
    const prompt = buildDraftSystemPrompt({
      profile: PROFILE,
      operator: null,
      signatureWillBeAppended: true,
    });

    expect(prompt).toContain("OPERATOR IDENTITY");
    expect(prompt).toContain("You are writing as the owner of this mailbox.");
    expect(prompt).toContain(
      "Never sign as, or adopt contact details of, any other person appearing in the email"
    );
    expect(prompt).not.toContain("You are writing as  of");
  });

  it("places the identity block ahead of the general rules", () => {
    const prompt = buildDraftSystemPrompt({
      profile: PROFILE,
      operator: OPERATOR,
      signatureWillBeAppended: true,
    });

    expect(prompt.indexOf("OPERATOR IDENTITY")).toBeGreaterThan(-1);
    expect(prompt.indexOf("OPERATOR IDENTITY")).toBeLessThan(
      prompt.indexOf("RULES:")
    );
  });

  it("falls back to a default closing phrase when the profile has none", () => {
    const prompt = buildDraftSystemPrompt({
      profile: { ...PROFILE, closing_patterns: [] },
      operator: OPERATOR,
      signatureWillBeAppended: true,
    });

    expect(prompt).toContain(
      'End the email with your closing phrase only (e.g. "Cheers,").'
    );
  });

  it("still renders the 12 writing dimensions and untrusted-data rules", () => {
    const prompt = buildDraftSystemPrompt({
      profile: PROFILE,
      operator: OPERATOR,
      signatureWillBeAppended: true,
    });

    expect(prompt).toContain("WRITING VOICE (12 dimensions");
    expect(prompt).toContain("1. FORMALITY: 0.40/1.0");
    expect(prompt).toContain("8. GREETING: Hey {name},");
    expect(prompt).toContain("UNTRUSTED DATA");
  });
});
