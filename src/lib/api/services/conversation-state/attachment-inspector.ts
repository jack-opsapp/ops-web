// src/lib/api/services/conversation-state/attachment-inspector.ts
//
// Phase 2 — OpenAI VISION inspection of customer attachments (Jackson approved
// the ~$10/mo cost, 2026-06-29). Produces an AttachmentInspection { summary,
// isSignedEstimate, facts } so the drafter can describe what was sent and the
// accept-detector can auto-close a deal on a confirmed signed estimate.
//
// PURE CORES (unit-tested, no I/O):
//   - classifyInspectableAttachment(mime, name) → which inputs vision accepts
//   - parseInspectionResponse(raw, model) → robust JSON → AttachmentInspection;
//     ANY parse failure degrades to an empty-summary inspection so the router
//     treats it as "inspection failed → human review", never a false positive.
//
// THIN WRAPPER (not unit-tested, mirrors the other fetchX wrappers):
//   - inspectImageContent(base64, mime, filename, client?) → one vision call.
//
// Inspection caching, byte download (provider.fetchAttachment), PDF→image
// rendering, and wiring into buildConversationState are the follow-up wiring
// step — vision is expensive, so each attachment must be inspected ONCE and the
// result persisted, never re-inspected on every state build.

import type { AttachmentInspection } from "./types";
import { inboxModel } from "./inbox-models";
import { getSyncOpenAI } from "../openai-clients";

export type InspectableKind = "image" | "pdf" | "unsupported";

/** What the vision step can ingest: images, and PDFs (sent natively to the model). */
export function classifyInspectableAttachment(
  mimeType: string,
  filename: string
): InspectableKind {
  const mt = (mimeType || "").toLowerCase();
  const fn = (filename || "").toLowerCase();
  if (mt.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/.test(fn)) {
    return "image";
  }
  if (mt.includes("pdf") || fn.endsWith(".pdf")) return "pdf";
  return "unsupported";
}

// ─── Cost-once planning (PURE) ────────────────────────────────────────────────
//
// Vision is paid per attachment (~$0.01–0.02). These pure helpers enforce the
// cost-once contract BEFORE any network call: a single stable cache key per
// attachment, and a planner that selects only the attachments that genuinely
// need inspecting now — inspectable kind, sent by a customer (not the operator),
// and not already in the cache. The impure runner (attachment-ingest.ts) feeds
// these the provider metadata + the cached keys and acts on the plan.

/** Stable per-attachment cache key. Cost-once is enforced against this string. */
export function attachmentInspectionKey(
  messageId: string,
  attachmentId: string
): string {
  return `${messageId}::${attachmentId}`;
}

/** The provider attachment fields the planner reads (subset of EmailAttachmentMeta). */
export interface ProviderAttachmentMeta {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  /** Sender of the message that owns the attachment — used to exclude operator-sent files. */
  fromEmail: string;
}

/** One attachment the planner has decided to inspect, with its resolved kind. */
export interface PlannedInspection {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  kind: "image" | "pdf";
}

/**
 * True when an attachment's sender is the OPERATOR — matched by exact email or by
 * the operator's PRIVATE domains (public provider domains like gmail.com are
 * excluded from `operatorDomains` upstream, so a gmail operator matches by exact
 * email only and never sweeps in gmail customers). A blank/unknown sender is NOT
 * the operator — we err toward inspecting it (treating it as a customer file).
 */
function isOperatorSender(
  fromEmail: string,
  operatorEmails: ReadonlySet<string>,
  operatorDomains: ReadonlySet<string>
): boolean {
  const e = (fromEmail || "").toLowerCase().trim();
  if (!e) return false;
  if (operatorEmails.has(e)) return true;
  const at = e.lastIndexOf("@");
  const domain = at >= 0 ? e.slice(at + 1) : "";
  return domain.length > 0 && operatorDomains.has(domain);
}

/**
 * The cost-once gate. Select the attachments to inspect NOW: an inspectable kind
 * (image/pdf), sent by a customer (not the operator — inspecting the operator's
 * own outbound estimate as a "customer signed estimate" would false-positive an
 * auto-Won), and not already cached. PURE — no DB, no network, no model.
 */
export function planAttachmentInspections(args: {
  attachments: ProviderAttachmentMeta[];
  operatorEmails: ReadonlySet<string>;
  operatorDomains: ReadonlySet<string>;
  cachedKeys: ReadonlySet<string>;
}): PlannedInspection[] {
  const { attachments, operatorEmails, operatorDomains, cachedKeys } = args;
  const out: PlannedInspection[] = [];
  for (const att of attachments) {
    const kind = classifyInspectableAttachment(att.mimeType, att.filename);
    if (kind === "unsupported") continue;
    if (isOperatorSender(att.fromEmail, operatorEmails, operatorDomains)) continue;
    if (cachedKeys.has(attachmentInspectionKey(att.messageId, att.attachmentId))) continue;
    out.push({
      messageId: att.messageId,
      attachmentId: att.attachmentId,
      filename: att.filename,
      mimeType: att.mimeType,
      kind,
    });
  }
  return out;
}

/** The vision system prompt — forces a compact JSON verdict. */
export const INSPECTOR_SYSTEM_PROMPT = `You are inspecting an attachment a customer sent to a trades business.
Return ONLY a JSON object with exactly these keys:
- "summary": a one-line plain-text description for the business owner (e.g. "hand-drawn deck layout ~14ft x 20ft", "photo of storm-damaged fence", "signed estimate #1042, total $8,400").
- "isSignedEstimate": boolean — true ONLY if this is (or contains) an estimate/quote/contract that the CUSTOMER has signed or explicitly accepted in writing.
- "facts": an object of any structured details you can read (dimensions, totals, dates, estimate numbers, materials). Use {} if none.
Do not include any text outside the JSON object.`;

function emptyInspection(model: string): AttachmentInspection {
  return { summary: "", isSignedEstimate: false, facts: {}, model };
}

/** Pull the first balanced-looking JSON object out of a model response. */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

/**
 * Parse a vision response into an AttachmentInspection. Robust to prose/fences
 * around the JSON and to malformed output (→ empty-summary inspection, which the
 * router reads as a failed inspection and holds the thread for a human).
 */
export function parseInspectionResponse(
  raw: string,
  model: string
): AttachmentInspection {
  const text = (raw ?? "").trim();
  if (!text) return emptyInspection(model);

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const slice = extractJsonObject(text);
    if (slice) {
      try {
        parsed = JSON.parse(slice);
      } catch {
        return emptyInspection(model);
      }
    } else {
      return emptyInspection(model);
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyInspection(model);
  }

  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  // Only a real boolean true counts — never coerce "yes"/1/truthy strings.
  const isSignedEstimate = obj.isSignedEstimate === true;
  const facts =
    obj.facts && typeof obj.facts === "object" && !Array.isArray(obj.facts)
      ? (obj.facts as Record<string, unknown>)
      : {};

  return { summary, isSignedEstimate, facts, model };
}

/**
 * Run one vision call over a pre-built user content array and parse the verdict.
 *
 * Error contract (deliberate — the cost-once cache depends on it):
 *  - On an API/transport error this THROWS. The runner's per-attachment try/catch
 *    then skips caching, so a transient failure is RETRIED on the next inbound
 *    rather than being permanently cached as "unreadable" — which would silently
 *    sink the headline signed-estimate → Won path on a one-off network blip.
 *  - On a successful call whose body cannot be parsed, `parseInspectionResponse`
 *    returns an empty-summary inspection. That IS a real verdict ("couldn't read
 *    it") and the caller caches it; the router then holds the thread for a human.
 */
async function runVisionCall(
  client: ReturnType<typeof getSyncOpenAI>,
  model: string,
  content: Array<Record<string, unknown>>
): Promise<AttachmentInspection> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: INSPECTOR_SYSTEM_PROMPT },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { role: "user", content: content as any },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 500,
  });
  return parseInspectionResponse(response.choices[0]?.message?.content ?? "", model);
}

/**
 * Inspect a single IMAGE attachment via one OpenAI vision call. `base64` is the
 * raw image bytes base64-encoded. THROWS on an API error (see `runVisionCall`);
 * returns an empty-summary inspection only on an unparseable-but-successful reply.
 * Thin wrapper — the pure cores above hold the tested logic.
 */
export async function inspectImageContent(
  base64: string,
  mimeType: string,
  filename: string,
  client = getSyncOpenAI()
): Promise<AttachmentInspection> {
  const model = inboxModel("attachmentVision");
  return runVisionCall(client, model, [
    { type: "text", text: `Filename: ${filename}. Inspect this attachment.` },
    {
      type: "image_url",
      image_url: { url: `data:${mimeType};base64,${base64}`, detail: "high" },
    },
  ]);
}

/**
 * Inspect a single PDF attachment (e.g. a signed estimate) by sending it to the
 * model NATIVELY as a base64 `file` content part — the model reads every page,
 * including page 1 where the signature/total live, with no PDF→image render step
 * (the simplest reliable path on openai ^6.27.0). THROWS on an API error.
 */
export async function inspectPdfContent(
  base64: string,
  filename: string,
  client = getSyncOpenAI()
): Promise<AttachmentInspection> {
  const model = inboxModel("attachmentVision");
  return runVisionCall(client, model, [
    { type: "text", text: `Filename: ${filename}. Inspect this PDF attachment.` },
    {
      type: "file",
      file: {
        filename: filename || "attachment.pdf",
        file_data: `data:application/pdf;base64,${base64}`,
      },
    },
  ]);
}
