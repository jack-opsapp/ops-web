import { describe, expect, it } from "vitest";

import {
  createEmailSignatureContent,
  emailSignatureHtmlToProviderRenderedText,
  emailSignatureHtmlToText,
  hasConfirmedEmailIdentity,
  renderEmailBodyWithSignature,
  resolveEffectiveEmailSignature,
  sanitizeEmailSignatureHtml,
  stripKnownRenderedEmailSignatures,
  stripRenderedEmailSignature,
  type EmailSignatureRecord,
} from "@/lib/api/services/email-signature-service";
import { authoredMessageBody } from "@/lib/api/services/conversation-state/message-cleaner";

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

  it("keeps the box properties a card layout is built from", () => {
    const result = sanitizeEmailSignatureHtml(
      '<table><tbody><tr><td style="padding-right: 14px; border-right: 1px solid #6b6b6b">' +
        '<img src="https://cdn.example.com/logo.png" alt="OPS" width="96" ' +
        'style="max-width: 96px"></td>' +
        '<td style="padding: 0 0 0 14px"><div style="padding-top: 10px; ' +
        'padding-bottom: 4px; border-top: 1px solid #dddddd; margin-top: 6px">' +
        "Jackson</div></td></tr></tbody></table>"
    );

    expect(result).toContain("padding-right:14px");
    expect(result).toContain("border-right:1px solid #6b6b6b");
    expect(result).toContain("max-width:96px");
    expect(result).toContain("padding:0 0 0 14px");
    expect(result).toContain("padding-top:10px");
    expect(result).toContain("padding-bottom:4px");
    expect(result).toContain("border-top:1px solid #dddddd");
    expect(result).toContain("margin-top:6px");
  });

  it("refuses style values that can fetch, escape, or overlay", () => {
    const result = sanitizeEmailSignatureHtml(
      '<div style="padding-left: expression(alert(1)); ' +
        "border-right: 1px solid url(https://tracker.example.com/p.gif); " +
        "max-width: calc(100% - 10px); margin: -400px; " +
        'position: absolute">Jackson</div>'
    );

    // `!important` is deliberately not asserted on: sanitize-html evaluates the
    // declaration value without the flag and re-emits it, for every allowed
    // property alike. It unlocks no property the allowlist forbids, so the
    // threat model is unchanged — and this predates the box-property support.
    expect(result).toBe("<div>Jackson</div>");
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

  it("keeps an authored plain-text mirror instead of flattening the HTML", () => {
    // A table-based card flattens to one run-on line, because only block tags
    // become newlines. When the caller knows the real line breaks, they win.
    const derived = createEmailSignatureContent({
      html: "<table><tbody><tr><td>Jackson Sweet</td><td>OPS</td></tr></tbody></table>",
    });
    const authored = createEmailSignatureContent({
      html: "<table><tbody><tr><td>Jackson Sweet</td><td>OPS</td></tr></tbody></table>",
      text: "Jackson Sweet\nOwner, OPS",
    });

    expect(derived.text).not.toContain("\n");
    expect(authored.text).toBe("Jackson Sweet\nOwner, OPS");
    expect(authored.hash).not.toBe(derived.hash);
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

describe("confirmed sender identity", () => {
  const scope = {
    companyId: "company-1",
    connectionId: "connection-1",
    userId: "user-1",
  };
  const confirmedAt = "2026-08-02T18:00:00.000Z";

  function opsRow(
    overrides: Partial<EmailSignatureRecord> = {}
  ): EmailSignatureRecord {
    return signatureRow({
      id: "operator-ops",
      scopeUserId: "user-1",
      source: "ops",
      contentHtml: "<div>Jackson Sweet</div>",
      contentText: "Jackson Sweet",
      contentHash: "operator-hash",
      providerIdentity: null,
      confirmedAt,
      ...overrides,
    });
  }

  it("accepts a confirmed operator-scope signature", () => {
    expect(hasConfirmedEmailIdentity([opsRow()], scope)).toBe(true);
  });

  it("accepts a confirmed mailbox-scope signature for any operator", () => {
    expect(
      hasConfirmedEmailIdentity(
        [opsRow({ id: "mailbox-ops", scopeUserId: null })],
        { ...scope, userId: "user-9" }
      )
    ).toBe(true);
  });

  it("rejects an OPS signature that was never confirmed", () => {
    expect(
      hasConfirmedEmailIdentity([opsRow({ confirmedAt: null })], scope)
    ).toBe(false);
  });

  it("rejects a provider-imported signature even when it carries a confirmation stamp", () => {
    // Provider HTML is somebody else's block until it is rebuilt as an OPS
    // signature. A timestamp on the imported row is not the operator's word.
    expect(
      hasConfirmedEmailIdentity(
        [
          signatureRow({
            providerIdentity: "operator@example.com",
            confirmedAt,
          }),
        ],
        scope
      )
    ).toBe(false);
  });

  it("rejects another operator's confirmed signature", () => {
    expect(
      hasConfirmedEmailIdentity([opsRow({ scopeUserId: "user-2" })], scope)
    ).toBe(false);
  });

  it("rejects other tenants, other connections, inactive rows, and empty content", () => {
    expect(
      hasConfirmedEmailIdentity(
        [
          opsRow({ id: "other-tenant", companyId: "company-2" }),
          opsRow({ id: "other-connection", connectionId: "connection-2" }),
          opsRow({ id: "inactive", isActive: false }),
          opsRow({ id: "empty", contentHtml: "", contentText: "" }),
        ],
        scope
      )
    ).toBe(false);
  });

  it("rejects an empty mailbox", () => {
    expect(hasConfirmedEmailIdentity([], scope)).toBe(false);
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

// A sent message read back from the provider carries the signature the way the
// PROVIDER's composer rendered the HTML into text/plain — not the way our
// stored plain-text mirror writes it. Gmail (verified against real Canpro
// sends, Aug 2026): the logo <img> becomes an "[image: alt]" line, block
// boundaries become single line breaks, an anchor keeps only its label, and
// inline runs stay joined — so phone and website share one "·" line while the
// stored mirror gives each fact its own line. The matcher must recognize that
// rendering, or every recognized send reads as "operator deleted the
// signature" and learning stays fail-closed forever.
describe("provider-rendered signature recognition", () => {
  // The real confirmed Canpro signature row, verbatim.
  const canproSignature = {
    html:
      '<table style="border-collapse:collapse"><tbody><tr><td style="vertical-align:middle;padding-right:14px;border-right:1px solid #6b6b6b"><img src="https://ops-app-files-prod.s3.us-west-2.amazonaws.com/company-a612edc0-5c18-4c4d-af97-55b9410dd077/logos/signature_1785965355793-btqkghoy.png" alt="Canpro Deck and Rail" width="96" /></td><td style="vertical-align:middle;padding-left:14px"><div style="font-family:-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif;font-size:13px;line-height:1.5;color:#6b6b6b"><div style="font-size:15px;font-weight:bold;color:#1a1a1a">Jackson Sweet</div><div>Canpro Deck and Rail</div><div>(250) 538-8994 · <a href="https://www.canprodeckandrail.com/" rel="noopener noreferrer" style="color:#6b6b6b;text-decoration:none">www.canprodeckandrail.com</a></div></div></td></tr></tbody></table>',
    text: "Jackson Sweet\nCanpro Deck and Rail\n(250) 538-8994\nwww.canprodeckandrail.com",
    hash: "a051aabf86cb29868b7d28c7b36a855433347b0b8bec3103225230426b924064",
  };

  const gmailRenderedBlock =
    "[image: Canpro Deck and Rail]\n" +
    "Jackson Sweet\n" +
    "Canpro Deck and Rail\n" +
    "(250) 538-8994 · www.canprodeckandrail.com";

  // Gmail message 19fd4817141c585b as synced into activities.body_text — the
  // operator's real send, one blank line between sign-off and signature.
  const steveSentBody =
    "Hi Steve,\r\n\r\nHope you’re doing well, and thanks for reaching out again.\r\n\r\nHappy to take a look at the front deck repair at Tanner Ridge. If you have\r\nany dimensions and photos to share, I could likely get you an idea of\r\npricing within the next day or two. We can also book a site visit for\r\nFriday if you are available late morning.\r\n\r\nAll the best,\r\n\r\nJackson\r\n\r\n[image: Canpro Deck and Rail]\r\nJackson Sweet\r\nCanpro Deck and Rail\r\n(250) 538-8994 · www.canprodeckandrail.com\r\n";

  const steveAuthoredBody =
    "Hi Steve,\n\nHope you’re doing well, and thanks for reaching out again.\n\nHappy to take a look at the front deck repair at Tanner Ridge. If you have\nany dimensions and photos to share, I could likely get you an idea of\npricing within the next day or two. We can also book a site visit for\nFriday if you are available late morning.\n\nAll the best,\n\nJackson";

  it("derives Gmail's text/plain rendering from the stored signature HTML", () => {
    expect(emailSignatureHtmlToProviderRenderedText(canproSignature.html)).toBe(
      gmailRenderedBlock
    );
  });

  it("strips the Gmail-rendered signature from a real sent body", () => {
    expect(
      stripRenderedEmailSignature({
        body: steveSentBody,
        contentType: "text",
        signature: canproSignature,
      })
    ).toBe(steveAuthoredBody);
  });

  it("strips the rendering even when extra blank lines precede it", () => {
    // Four of the five real sends carry two blank lines between the sign-off
    // and the signature block (Gmail message 19fd47b0a364e45b and siblings).
    const karanTail =
      "we can book a site visit to go over everything together if you'd like.\r\n\r\nAll the best,\r\n\r\nJackson\r\n\r\n\r\n[image: Canpro Deck and Rail]\r\nJackson Sweet\r\nCanpro Deck and Rail\r\n(250) 538-8994 · www.canprodeckandrail.com\r\n";

    expect(
      stripRenderedEmailSignature({
        body: karanTail,
        contentType: "text",
        signature: canproSignature,
      })
    ).toBe(
      "we can book a site visit to go over everything together if you'd like.\n\nAll the best,\n\nJackson"
    );
  });

  it("strips the rendering when a provider re-wrapped the contact line", () => {
    const wrapped =
      "All the best,\n\nJackson\n\n[image: Canpro Deck and Rail]\nJackson Sweet\nCanpro Deck and Rail\n(250) 538-8994 ·\nwww.canprodeckandrail.com";

    expect(
      stripRenderedEmailSignature({
        body: wrapped,
        contentType: "text",
        signature: canproSignature,
      })
    ).toBe("All the best,\n\nJackson");
  });

  it("never strips when authored text follows the signature block", () => {
    const body =
      "All the best,\n\nJackson\n\n" +
      gmailRenderedBlock +
      "\n\nPS: the gate code is 4411.";

    expect(
      stripRenderedEmailSignature({
        body,
        contentType: "text",
        signature: canproSignature,
      })
    ).toBe(body);
  });

  it("never strips a near-miss block that differs from the known signature", () => {
    const body =
      "All the best,\n\nJackson\n\n[image: Canpro Deck and Rail]\nJackson Sweet\nCanpro Deck and Rail\n(250) 538-1234 · www.canprodeckandrail.com";

    expect(
      stripRenderedEmailSignature({
        body,
        contentType: "text",
        signature: canproSignature,
      })
    ).toBe(body);
  });

  it("never strips a signature block that touches the authored text", () => {
    // Without a blank line the boundary is unproven, so nothing is removed.
    const body = "All the best,\nJackson\n" + gmailRenderedBlock;

    expect(
      stripRenderedEmailSignature({
        body,
        contentType: "text",
        signature: canproSignature,
      })
    ).toBe(body);
  });

  it("recognizes the send through the reconciliation seam", () => {
    // Mirrors authoredBodyWithoutKnownSignature: quote-strip the raw synced
    // body, then peel known signatures. The result flipping away from the
    // original is what proves the operator kept the signature — the gate for
    // sent_from_mailbox learning.
    const original = authoredMessageBody(steveSentBody, {
      subject: "Canpro Deck and Rail Estimate",
    }).trim();
    const authored = stripKnownRenderedEmailSignatures({
      body: original,
      contentType: "text",
      signatures: [canproSignature],
    }).trim();

    expect(authored).toBe(steveAuthoredBody);
    expect(authored).not.toBe(original);
  });
});


describe("createEmailSignatureContent control-character hygiene", () => {
  // Postgres rejects NUL in text columns with "null character not permitted"
  // (2026-08-05 incident: a pasted identity field blocked the founder's
  // confirm). Every persisted signature flows through this function, so a
  // smuggled control character must die here, not in the database.
  it("strips NUL from authored text before hashing and persisting", () => {
    const content = createEmailSignatureContent({
      text: "Jackson \x00 Sweet\nCanpro Deck and Rail\x00",
    });
    expect(content.text).not.toContain("\x00");
    expect(content.html).not.toContain("\x00");
    expect(content.text).toContain("Jackson  Sweet");
  });

  it("strips NUL from provided html while keeping the markup intact", () => {
    const content = createEmailSignatureContent({
      html: "<p>Jackson \x00Sweet</p>\n<p>Owner</p>",
    });
    expect(content.html).not.toContain("\x00");
    expect(content.html).toContain("Jackson Sweet");
    expect(content.text).toContain("Owner");
  });

  it("strips the wider C0 range from plain text", () => {
    const content = createEmailSignatureContent({
      text: "Jackson\x1b[0m Sweet",
    });
    expect(content.text).toBe("Jackson[0m Sweet");
  });
});
