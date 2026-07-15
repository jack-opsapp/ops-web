import { describe, expect, it } from "vitest";

import {
  createEmailSignatureContent,
  emailSignatureHtmlToText,
  renderEmailBodyWithSignature,
  resolveEffectiveEmailSignature,
  sanitizeEmailSignatureHtml,
  stripKnownRenderedEmailSignatures,
  stripRenderedEmailSignature,
  type EmailSignatureRecord,
} from "@/lib/api/services/email-signature-service";

function signatureRow(
  overrides: Partial<EmailSignatureRecord> = {}
): EmailSignatureRecord {
  return {
    id: "signature-1",
    companyId: "company-1",
    connectionId: "connection-1",
    scopeUserId: null,
    source: "gmail_send_as",
    contentHtml: "<div>Provider</div>",
    contentText: "Provider",
    contentHash: "provider-hash",
    providerIdentity: "operator@example.com",
    isActive: true,
    fetchedAt: "2026-07-14T18:00:00.000Z",
    confirmedAt: null,
    createdBy: null,
    updatedBy: null,
    createdAt: "2026-07-14T18:00:00.000Z",
    updatedAt: "2026-07-14T18:00:00.000Z",
    ...overrides,
  };
}

describe("email signature HTML", () => {
  it("removes executable markup while preserving safe signature formatting", () => {
    const result = sanitizeEmailSignatureHtml(
      '<div onclick="steal()"><strong>Jackson</strong><script>alert(1)</script>' +
        '<a href="javascript:alert(2)" onmouseover="steal()">OPS</a></div>'
    );

    expect(result).toBe(
      '<div><strong>Jackson</strong><a rel="noopener noreferrer">OPS</a></div>'
    );
  });

  it("derives readable plain text from a formatted signature", () => {
    expect(
      emailSignatureHtmlToText(
        "<div><strong>Jackson Sweet</strong><br>OPS LTD.</div>" +
          '<div><a href="mailto:jackson@example.com">jackson@example.com</a></div>'
      )
    ).toBe("Jackson Sweet\nOPS LTD.\njackson@example.com");
  });

  it("keeps common Gmail signature layout and safe remote images", () => {
    const result = sanitizeEmailSignatureHtml(
      '<table style="border-collapse: collapse; position: fixed"><tbody><tr><td>' +
        '<img src="https://cdn.example.com/logo.png" alt="OPS" width="80" ' +
        'onerror="steal()"></td><td style="color: #334155; font-size: 12px">' +
        "Jackson</td></tr></tbody></table>"
    );

    expect(result).toContain("<table");
    expect(result).toContain('src="https://cdn.example.com/logo.png"');
    expect(result).toContain('alt="OPS"');
    expect(result).toContain("border-collapse:collapse");
    expect(result).toContain("color:#334155");
    expect(result).not.toContain("position");
    expect(result).not.toContain("onerror");
  });
});

describe("effective email signatures", () => {
  it("normalizes content and computes a stable hash", () => {
    const first = createEmailSignatureContent({
      html: "<div><strong>Jackson</strong><br>OPS</div><script>bad()</script>",
    });
    const second = createEmailSignatureContent({
      html: "<div><strong>Jackson</strong><br>OPS</div>",
    });

    expect(first).toEqual(second);
    expect(first.text).toBe("Jackson\nOPS");
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("prefers operator OPS, then mailbox OPS, then the exact provider identity", () => {
    const provider = signatureRow();
    const mailbox = signatureRow({
      id: "mailbox-ops",
      source: "ops",
      contentText: "Mailbox OPS",
      contentHtml: "<div>Mailbox OPS</div>",
      contentHash: "mailbox-hash",
      providerIdentity: null,
    });
    const operator = signatureRow({
      id: "operator-ops",
      scopeUserId: "user-1",
      source: "ops",
      contentText: "Operator OPS",
      contentHtml: "<div>Operator OPS</div>",
      contentHash: "operator-hash",
      providerIdentity: null,
    });

    const effective = resolveEffectiveEmailSignature(
      [provider, mailbox, operator],
      {
        companyId: "company-1",
        connectionId: "connection-1",
        userId: "user-1",
        mailboxAddress: "OPERATOR@example.com",
      }
    );

    expect(effective).toMatchObject({
      recordId: "operator-ops",
      source: "ops",
      scope: "operator",
      text: "Operator OPS",
    });
  });

  it("ignores other tenants, connections, users, inactive rows, and provider aliases", () => {
    const effective = resolveEffectiveEmailSignature(
      [
        signatureRow({ companyId: "company-2", source: "ops" }),
        signatureRow({ connectionId: "connection-2", source: "ops" }),
        signatureRow({ scopeUserId: "user-2", source: "ops" }),
        signatureRow({ isActive: false, source: "ops" }),
        signatureRow({ providerIdentity: "alias@example.com" }),
        signatureRow({
          id: "exact-provider",
          providerIdentity: "Operator@Example.com",
        }),
      ],
      {
        companyId: "company-1",
        connectionId: "connection-1",
        userId: "user-1",
        mailboxAddress: "operator@example.com",
      }
    );

    expect(effective).toMatchObject({
      recordId: "exact-provider",
      source: "gmail_send_as",
      scope: "provider",
    });
  });
});

describe("signature rendering boundary", () => {
  const signature = {
    recordId: "signature-1",
    source: "ops" as const,
    scope: "operator" as const,
    html: "<div><strong>Jackson</strong><br>OPS</div>",
    text: "Jackson\nOPS",
    hash: "a".repeat(64),
    providerIdentity: null,
  };

  it("marks HTML signatures and never appends the same signature twice", () => {
    const once = renderEmailBodyWithSignature({
      body: "<p>Thanks for reaching out.</p>",
      contentType: "html",
      signature,
    });
    const twice = renderEmailBodyWithSignature({
      body: once,
      contentType: "html",
      signature,
    });

    expect(twice).toBe(once);
    expect(once).toContain(`data-ops-signature-hash="${signature.hash}"`);
    expect(once.match(/OPS_EMAIL_SIGNATURE:/g)).toHaveLength(2);
    expect(
      stripRenderedEmailSignature({
        body: once,
        contentType: "html",
        signature,
      })
    ).toBe("<p>Thanks for reaching out.</p>");
  });

  it("replaces an older OPS-marked signature after settings change", () => {
    const oldSignature = { ...signature, hash: "b".repeat(64) };
    const oldBody = renderEmailBodyWithSignature({
      body: "<p>Authored body</p>",
      contentType: "html",
      signature: oldSignature,
    });
    const updated = renderEmailBodyWithSignature({
      body: oldBody,
      contentType: "html",
      signature,
    });

    expect(updated).not.toContain(oldSignature.hash);
    expect(updated.match(/data-ops-signature-hash/g)).toHaveLength(1);
  });

  it("round trips a known plain-text signature without a visible hash", () => {
    const rendered = renderEmailBodyWithSignature({
      body: "Thanks for reaching out.",
      contentType: "text",
      signature,
    });

    expect(rendered).toBe("Thanks for reaching out.\n\n-- \nJackson\nOPS");
    expect(rendered).not.toContain(signature.hash);
    expect(
      stripRenderedEmailSignature({
        body: rendered,
        contentType: "text",
        signature,
      })
    ).toBe("Thanks for reaching out.");
    expect(
      renderEmailBodyWithSignature({
        body: rendered,
        contentType: "text",
        signature,
      })
    ).toBe(rendered);
  });

  it("strips the exact signature after a provider flattens the HTML wrapper", () => {
    expect(
      stripRenderedEmailSignature({
        body: "Thanks for reaching out.\n\nJackson\nOPS",
        contentType: "text",
        signature,
      })
    ).toBe("Thanks for reaching out.");
  });

  it("strips a flattened prior signature revision after the active signature changes", () => {
    const previous = {
      ...signature,
      text: "Old Jackson\nOld OPS",
      hash: "b".repeat(64),
    };

    expect(
      stripKnownRenderedEmailSignatures({
        body: "Authored body\n\nOld Jackson\nOld OPS",
        contentType: "text",
        signatures: [signature, previous],
      })
    ).toBe("Authored body");
  });

  it("removes stacked known revisions before rendering the current signature", () => {
    const previous = {
      ...signature,
      text: "Old Jackson\nOld OPS",
      hash: "b".repeat(64),
    };

    expect(
      stripKnownRenderedEmailSignatures({
        body: "Authored body\n\nOld Jackson\nOld OPS\n\nJackson\nOPS",
        contentType: "text",
        signatures: [signature, previous],
      })
    ).toBe("Authored body");
  });

  it("replaces an older plain signature at the standard signature boundary", () => {
    const previous = {
      ...signature,
      text: "Previous signature",
      hash: "b".repeat(64),
    };
    const oldBody = renderEmailBodyWithSignature({
      body: "Authored body",
      contentType: "text",
      signature: previous,
    });

    const authoredBody = stripKnownRenderedEmailSignatures({
      body: oldBody,
      contentType: "text",
      signatures: [signature, previous],
    });

    expect(
      renderEmailBodyWithSignature({
        body: authoredBody,
        contentType: "text",
        signature,
      })
    ).toBe("Authored body\n\n-- \nJackson\nOPS");
  });

  it("does not strip an unknown plain-text signature solely because it uses the RFC delimiter", () => {
    expect(
      stripRenderedEmailSignature({
        body: "Authored body\n\n-- \nUnknown sender signature",
        contentType: "text",
        signature,
      })
    ).toBe("Authored body\n\n-- \nUnknown sender signature");
  });

  it("strips an OPS wrapper even when a provider removed its comments", () => {
    const providerRoundTrip =
      '<p>Authored body</p><br><br><div data-ops-signature-hash="' +
      "b".repeat(64) +
      '"><div>Previous signature</div></div>';

    expect(
      renderEmailBodyWithSignature({
        body: providerRoundTrip,
        contentType: "html",
        signature,
      })
    ).not.toContain("Previous signature");
  });
});
