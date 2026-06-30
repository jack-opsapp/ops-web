import { describe, it, expect } from "vitest";

import {
  parseInspectionResponse,
  classifyInspectableAttachment,
  attachmentInspectionKey,
  planAttachmentInspections,
  type ProviderAttachmentMeta,
} from "@/lib/api/services/conversation-state/attachment-inspector";

// ─────────────────────────────────────────────────────────────────────────────
// attachment-inspector — PURE cores. The vision call (download bytes → OpenAI)
// is a thin wrapper; these tested cores are (1) parsing the model's JSON verdict
// into an AttachmentInspection and (2) deciding which mime types we can inspect.
// A parse that fails must degrade to an empty-summary inspection so the router
// treats it as "inspection failed → human review", never a false signal.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = "gpt-5.4";

describe("parseInspectionResponse", () => {
  it("parses a well-formed verdict", () => {
    const raw = JSON.stringify({
      summary: "Hand-drawn deck layout, ~14ft x 20ft with stairs on the south side",
      isSignedEstimate: false,
      facts: { dimensions: "14x20", structure: "deck" },
    });
    const r = parseInspectionResponse(raw, MODEL);
    expect(r.summary).toContain("deck layout");
    expect(r.isSignedEstimate).toBe(false);
    expect(r.facts.dimensions).toBe("14x20");
    expect(r.model).toBe(MODEL);
  });

  it("captures a signed-estimate verdict with its total", () => {
    const raw = JSON.stringify({
      summary: "Signed estimate #1042, customer signature present, total $8,400",
      isSignedEstimate: true,
      facts: { total: 8400, estimateNumber: "1042" },
    });
    const r = parseInspectionResponse(raw, MODEL);
    expect(r.isSignedEstimate).toBe(true);
    expect(r.facts.total).toBe(8400);
  });

  it("extracts the JSON object even when the model wraps it in prose/fences", () => {
    const raw = "Here is the analysis:\n```json\n{\"summary\":\"a photo of storm damage to a fence\",\"isSignedEstimate\":false,\"facts\":{}}\n```";
    const r = parseInspectionResponse(raw, MODEL);
    expect(r.summary).toContain("storm damage");
    expect(r.isSignedEstimate).toBe(false);
  });

  it("degrades to an empty-summary inspection on malformed output (router → human review)", () => {
    const r = parseInspectionResponse("the image could not be read", MODEL);
    expect(r.summary).toBe("");
    expect(r.isSignedEstimate).toBe(false);
    expect(r.facts).toEqual({});
    expect(r.model).toBe(MODEL);
  });

  it("coerces a non-boolean isSignedEstimate to false and a missing summary to empty", () => {
    const raw = JSON.stringify({ isSignedEstimate: "yes", facts: { note: "x" } });
    const r = parseInspectionResponse(raw, MODEL);
    expect(r.isSignedEstimate).toBe(false); // only a real boolean true counts
    expect(r.summary).toBe("");
    expect(r.facts.note).toBe("x");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// planAttachmentInspections — the COST-ONCE gate. Decides which provider
// attachments get a (paid) vision call now: inspectable kind (image/pdf), sent by
// a NON-operator (customer), and not already cached. Operator-sent attachments
// (e.g. the original estimate the operator emailed out) must never be inspected
// as a customer signed estimate — that would false-positive an auto-Won.
// ─────────────────────────────────────────────────────────────────────────────

const OPERATOR_EMAILS = new Set(["canprojack@gmail.com"]);
const OPERATOR_DOMAINS = new Set(["canprodeck.com"]); // private domain (gmail.com excluded upstream)

function meta(over: Partial<ProviderAttachmentMeta> = {}): ProviderAttachmentMeta {
  return {
    messageId: "m1",
    attachmentId: "a1",
    filename: "signed-estimate.pdf",
    mimeType: "application/pdf",
    fromEmail: "sarah@gmail.com", // a customer
    ...over,
  };
}

describe("attachmentInspectionKey", () => {
  it("is stable and uniquely keyed by (messageId, attachmentId)", () => {
    expect(attachmentInspectionKey("m1", "a1")).toBe(attachmentInspectionKey("m1", "a1"));
    expect(attachmentInspectionKey("m1", "a1")).not.toBe(attachmentInspectionKey("m1", "a2"));
    expect(attachmentInspectionKey("m2", "a1")).not.toBe(attachmentInspectionKey("m1", "a1"));
  });
});

describe("planAttachmentInspections", () => {
  it("plans an image and a PDF on a customer message", () => {
    const plan = planAttachmentInspections({
      attachments: [
        meta({ attachmentId: "a1", filename: "deck.jpg", mimeType: "image/jpeg" }),
        meta({ attachmentId: "a2", filename: "estimate.pdf", mimeType: "application/pdf" }),
      ],
      operatorEmails: OPERATOR_EMAILS,
      operatorDomains: OPERATOR_DOMAINS,
      cachedKeys: new Set<string>(),
    });
    expect(plan.map((p) => p.attachmentId)).toEqual(["a1", "a2"]);
    expect(plan.find((p) => p.attachmentId === "a1")!.kind).toBe("image");
    expect(plan.find((p) => p.attachmentId === "a2")!.kind).toBe("pdf");
  });

  it("excludes operator-sent attachments (matched by exact email or private domain)", () => {
    const plan = planAttachmentInspections({
      attachments: [
        meta({ attachmentId: "op1", fromEmail: "canprojack@gmail.com" }), // operator exact email
        meta({ attachmentId: "op2", fromEmail: "jane@canprodeck.com" }), // operator private domain
        meta({ attachmentId: "cust", fromEmail: "sarah@gmail.com" }), // customer
      ],
      operatorEmails: OPERATOR_EMAILS,
      operatorDomains: OPERATOR_DOMAINS,
      cachedKeys: new Set<string>(),
    });
    expect(plan.map((p) => p.attachmentId)).toEqual(["cust"]);
  });

  it("excludes attachments already in the inspection cache (cost-once)", () => {
    const plan = planAttachmentInspections({
      attachments: [
        meta({ messageId: "m1", attachmentId: "a1" }),
        meta({ messageId: "m1", attachmentId: "a2" }),
      ],
      operatorEmails: OPERATOR_EMAILS,
      operatorDomains: OPERATOR_DOMAINS,
      cachedKeys: new Set([attachmentInspectionKey("m1", "a1")]),
    });
    expect(plan.map((p) => p.attachmentId)).toEqual(["a2"]);
  });

  it("excludes unsupported kinds (only image/pdf are inspectable)", () => {
    const plan = planAttachmentInspections({
      attachments: [
        meta({ attachmentId: "doc", filename: "notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
        meta({ attachmentId: "ics", filename: "invite.ics", mimeType: "text/calendar" }),
      ],
      operatorEmails: OPERATOR_EMAILS,
      operatorDomains: OPERATOR_DOMAINS,
      cachedKeys: new Set<string>(),
    });
    expect(plan).toHaveLength(0);
  });

  it("treats an unknown/blank sender as a customer (inspects it) rather than skipping", () => {
    const plan = planAttachmentInspections({
      attachments: [meta({ attachmentId: "a1", fromEmail: "" })],
      operatorEmails: OPERATOR_EMAILS,
      operatorDomains: OPERATOR_DOMAINS,
      cachedKeys: new Set<string>(),
    });
    expect(plan.map((p) => p.attachmentId)).toEqual(["a1"]);
  });
});

describe("classifyInspectableAttachment", () => {
  it("treats images as directly inspectable", () => {
    expect(classifyInspectableAttachment("image/jpeg", "deck.jpg")).toBe("image");
    expect(classifyInspectableAttachment("image/png", "x.png")).toBe("image");
  });

  it("treats PDFs as pdf (needs a render step before vision)", () => {
    expect(classifyInspectableAttachment("application/pdf", "estimate.pdf")).toBe("pdf");
    expect(classifyInspectableAttachment("", "estimate.PDF")).toBe("pdf");
  });

  it("returns unsupported for everything else", () => {
    expect(classifyInspectableAttachment("text/calendar", "invite.ics")).toBe("unsupported");
    expect(classifyInspectableAttachment("application/zip", "a.zip")).toBe("unsupported");
  });
});
