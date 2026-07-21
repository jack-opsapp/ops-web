import { createHash } from "node:crypto";
import sanitizeHtml from "sanitize-html";

import { htmlToPlainText } from "@/lib/utils/email-parsing";
import { requireSupabase } from "@/lib/supabase/helpers";
import type { EmailProviderInterface } from "./email-provider";
import {
  runEmailProviderMailboxOperation,
  type EmailProviderMailboxCheckpoint,
} from "./email-provider-mailbox-operation";

export type EmailSignatureSource =
  | "ops"
  | "gmail_send_as"
  | "microsoft_confirmed";

export interface EmailSignatureRecord {
  id: string;
  companyId: string;
  connectionId: string;
  scopeUserId: string | null;
  source: EmailSignatureSource;
  contentHtml: string;
  contentText: string;
  contentHash: string;
  providerIdentity: string | null;
  isActive: boolean;
  fetchedAt: string | null;
  confirmedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveEmailSignature {
  recordId: string;
  source: EmailSignatureSource;
  scope: "operator" | "mailbox" | "provider";
  html: string;
  text: string;
  hash: string;
  providerIdentity: string | null;
}

export interface EmailSignatureRenderContent {
  html: string;
  text: string;
  hash: string;
}

interface SignatureRenderInput {
  body: string;
  contentType: "text" | "html";
  signature: EmailSignatureRenderContent;
}

const MARKED_HTML_SIGNATURE_SUFFIX =
  /\s*(?:<br\s*\/?>\s*){0,2}<!--OPS_EMAIL_SIGNATURE:([a-f0-9]{64}):START--><div data-ops-signature-hash="\1">[\s\S]*<\/div><!--OPS_EMAIL_SIGNATURE:\1:END-->\s*$/i;
const OPS_HTML_WRAPPER_SUFFIX =
  /\s*(?:<br\s*\/?>\s*){0,2}<div\s+data-ops-signature-hash=(["'])[a-f0-9]{64}\1[^>]*>[\s\S]*<\/div>\s*$/i;

export function renderEmailBodyWithSignature(
  input: SignatureRenderInput
): string {
  const authoredBody = stripRenderedEmailSignature(input).trimEnd();

  if (input.contentType === "text") {
    const signatureText = normalizePlainText(input.signature.text);
    if (!signatureText) return authoredBody;
    return authoredBody
      ? `${authoredBody}\n\n-- \n${signatureText}`
      : signatureText;
  }

  const signatureHtml = sanitizeEmailSignatureHtml(input.signature.html).trim();
  if (!signatureHtml) return authoredBody;

  const block = markedHtmlSignature(input.signature.hash, signatureHtml);
  return authoredBody ? `${authoredBody}<br><br>${block}` : block;
}

export function stripRenderedEmailSignature(
  input: SignatureRenderInput
): string {
  if (input.contentType === "text") {
    const signatureText = normalizePlainText(input.signature.text);
    if (!signatureText) return input.body;
    const normalizedBody = input.body.replace(/\r\n?/g, "\n").trimEnd();
    const suffix = `\n\n-- \n${signatureText}`;
    if (normalizedBody.endsWith(suffix)) {
      return normalizedBody.slice(0, -suffix.length).trimEnd();
    }
    // Provider round-trips commonly flatten the marked HTML block into plain
    // text. The exact known signature is safe to remove only as an anchored
    // suffix separated from the authored body by a blank line.
    const providerFlattenedSuffix = `\n\n${signatureText}`;
    if (normalizedBody.endsWith(providerFlattenedSuffix)) {
      return normalizedBody.slice(0, -providerFlattenedSuffix.length).trimEnd();
    }
    return normalizedBody;
  }

  const marked = input.body.match(MARKED_HTML_SIGNATURE_SUFFIX);
  if (marked?.index !== undefined) {
    return input.body.slice(0, marked.index).trimEnd();
  }

  const wrapperMarked = input.body.match(OPS_HTML_WRAPPER_SUFFIX);
  if (wrapperMarked?.index !== undefined) {
    return input.body.slice(0, wrapperMarked.index).trimEnd();
  }

  // Some providers preserve the wrapper but remove HTML comments. The exact
  // known signature remains safe to strip because it is anchored at the end.
  const signatureHtml = sanitizeEmailSignatureHtml(input.signature.html).trim();
  const wrapper = `<div data-ops-signature-hash="${input.signature.hash}">${signatureHtml}</div>`;
  if (signatureHtml && input.body.trimEnd().endsWith(wrapper)) {
    const withoutWrapper = input.body
      .trimEnd()
      .slice(0, -wrapper.length)
      .replace(/(?:<br\s*\/?>\s*){0,2}$/i, "");
    return withoutWrapper.trimEnd();
  }

  return input.body;
}

export function stripKnownRenderedEmailSignatures(input: {
  body: string;
  contentType: "text" | "html";
  signatures: EmailSignatureRenderContent[];
}): string {
  let body = input.body;
  const signatures = Array.from(
    new Map(
      input.signatures.map((signature) => [
        `${signature.hash}\u0000${signature.html}\u0000${signature.text}`,
        signature,
      ])
    ).values()
  );

  // A provider can preserve an old flattened signature and then receive a
  // newly rendered signature on a later save. Peel only exact, known suffixes,
  // one revision at a time, until the authored body is stable.
  for (let pass = 0; pass < signatures.length; pass += 1) {
    let removed = false;
    for (const signature of signatures) {
      const stripped = stripRenderedEmailSignature({
        body,
        contentType: input.contentType,
        signature,
      });
      if (stripped !== body) {
        body = stripped;
        removed = true;
        break;
      }
    }
    if (!removed) break;
  }

  return body;
}

function markedHtmlSignature(hash: string, html: string): string {
  return (
    `<!--OPS_EMAIL_SIGNATURE:${hash}:START-->` +
    `<div data-ops-signature-hash="${hash}">${html}</div>` +
    `<!--OPS_EMAIL_SIGNATURE:${hash}:END-->`
  );
}

export function createEmailSignatureContent(_input: {
  html?: string | null;
  text?: string | null;
}): { html: string; text: string; hash: string } {
  const inputText = normalizePlainText(_input.text ?? "");
  const sourceHtml = _input.html?.trim()
    ? _input.html
    : plainTextToSignatureHtml(inputText);
  const html = sanitizeEmailSignatureHtml(sourceHtml).trim();
  const text = normalizePlainText(
    html ? emailSignatureHtmlToText(html) : inputText
  );
  const hash = createHash("sha256")
    .update(`${html}\u0000${text}`, "utf8")
    .digest("hex");

  return { html, text, hash };
}

export function resolveEffectiveEmailSignature(
  _rows: EmailSignatureRecord[],
  _context: {
    companyId: string;
    connectionId: string;
    userId?: string | null;
    mailboxAddress: string;
  }
): EffectiveEmailSignature | null {
  const eligible = _rows
    .filter(
      (row) =>
        row.isActive &&
        row.companyId === _context.companyId &&
        row.connectionId === _context.connectionId &&
        Boolean(row.contentHtml || row.contentText)
    )
    .sort(compareNewestFirst);

  const operatorOps = _context.userId
    ? eligible.find(
        (row) => row.source === "ops" && row.scopeUserId === _context.userId
      )
    : undefined;
  if (operatorOps) return toEffective(operatorOps, "operator");

  const mailboxOps = eligible.find(
    (row) => row.source === "ops" && row.scopeUserId === null
  );
  if (mailboxOps) return toEffective(mailboxOps, "mailbox");

  const mailboxAddress = normalizeEmailAddress(_context.mailboxAddress);
  const provider = eligible.find(
    (row) =>
      row.source !== "ops" &&
      normalizeEmailAddress(row.providerIdentity ?? "") === mailboxAddress
  );
  return provider ? toEffective(provider, "provider") : null;
}

function normalizePlainText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function plainTextToSignatureHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br>");
}

function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

function compareNewestFirst(
  left: EmailSignatureRecord,
  right: EmailSignatureRecord
): number {
  const byUpdated =
    Date.parse(right.updatedAt || right.createdAt) -
    Date.parse(left.updatedAt || left.createdAt);
  if (Number.isFinite(byUpdated) && byUpdated !== 0) return byUpdated;
  return right.id.localeCompare(left.id);
}

function toEffective(
  record: EmailSignatureRecord,
  scope: EffectiveEmailSignature["scope"]
): EffectiveEmailSignature {
  return {
    recordId: record.id,
    source: record.source,
    scope,
    html: record.contentHtml,
    text: record.contentText,
    hash: record.contentHash,
    providerIdentity: record.providerIdentity,
  };
}

function mapEmailSignatureRow(
  row: Record<string, unknown>
): EmailSignatureRecord {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    connectionId: row.connection_id as string,
    scopeUserId: (row.scope_user_id as string | null) ?? null,
    source: row.source as EmailSignatureSource,
    contentHtml: (row.content_html as string | null) ?? "",
    contentText: (row.content_text as string | null) ?? "",
    contentHash: row.content_hash as string,
    providerIdentity: (row.provider_identity as string | null) ?? null,
    isActive: row.active === true,
    fetchedAt: (row.fetched_at as string | null) ?? null,
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    updatedBy: (row.updated_by as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

interface SignatureLookupInput {
  companyId: string;
  connectionId: string;
}

interface EffectiveSignatureLookupInput extends SignatureLookupInput {
  userId?: string | null;
  mailboxAddress: string;
}

interface RefreshProviderSignatureInput extends SignatureLookupInput {
  scopeUserId?: string | null;
  mailboxAddress: string;
  provider: EmailProviderInterface;
  actorUserId: string;
  providerLockCheckpoint?: EmailProviderMailboxCheckpoint;
}

interface SaveOpsSignatureInput extends SignatureLookupInput {
  scopeUserId?: string | null;
  html?: string | null;
  text?: string | null;
  actorUserId: string;
}

interface SaveProviderSignatureInput extends SignatureLookupInput {
  scopeUserId?: string | null;
  source: Exclude<EmailSignatureSource, "ops">;
  providerIdentity: string;
  html?: string | null;
  text?: string | null;
  fetchedAt?: string | null;
  confirmedAt?: string | null;
  actorUserId: string;
}

interface ConfirmMicrosoftSignatureInput extends SignatureLookupInput {
  scopeUserId?: string | null;
  mailboxAddress: string;
  html?: string | null;
  text?: string | null;
  actorUserId: string;
}

interface DeactivateEmailSignatureInput extends SignatureLookupInput {
  signatureId?: string;
  source?: EmailSignatureSource;
  scopeUserId?: string | null;
  actorUserId: string;
}

interface PersistSignatureInput extends SignatureLookupInput {
  scopeUserId: string | null;
  source: EmailSignatureSource;
  providerIdentity: string | null;
  html?: string | null;
  text?: string | null;
  fetchedAt: string | null;
  confirmedAt: string | null;
  actorUserId: string;
}

async function persistSignature(
  input: PersistSignatureInput
): Promise<EmailSignatureRecord> {
  const content = createEmailSignatureContent({
    html: input.html,
    text: input.text,
  });
  if (!content.html && !content.text) {
    throw new Error("Email signature content cannot be empty");
  }

  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc(
    "replace_email_signature_as_system",
    {
      p_actor_user_id: input.actorUserId,
      p_connection_id: input.connectionId,
      p_source: input.source,
      p_content_html: content.html || null,
      p_content_text: content.text || null,
      p_content_hash: content.hash,
      p_provider_identity: input.providerIdentity,
      p_fetched_at: input.fetchedAt,
      p_confirmed_at: input.confirmedAt,
    }
  );
  if (error) {
    throw new Error(`Failed to replace email signature: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error("Failed to replace email signature: RPC returned no row");
  }
  return mapEmailSignatureRow(row as Record<string, unknown>);
}

export const EmailSignatureService = {
  async listKnown(
    input: SignatureLookupInput
  ): Promise<EmailSignatureRecord[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_signatures")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("connection_id", input.connectionId)
      .order("updated_at", { ascending: false });

    if (error) {
      throw new Error(
        `Failed to load known email signatures: ${error.message}`
      );
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map(
      mapEmailSignatureRow
    );
  },

  async listActive(
    input: SignatureLookupInput
  ): Promise<EmailSignatureRecord[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("email_signatures")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("connection_id", input.connectionId)
      .eq("active", true)
      .order("updated_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to load email signatures: ${error.message}`);
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map(
      mapEmailSignatureRow
    );
  },

  async resolveEffective(
    input: EffectiveSignatureLookupInput
  ): Promise<EffectiveEmailSignature | null> {
    const rows = await EmailSignatureService.listActive(input);
    return resolveEffectiveEmailSignature(rows, input);
  },

  async saveOps(input: SaveOpsSignatureInput): Promise<EmailSignatureRecord> {
    return persistSignature({
      ...input,
      scopeUserId: input.scopeUserId ?? null,
      source: "ops",
      providerIdentity: null,
      fetchedAt: null,
      confirmedAt: null,
      actorUserId: input.actorUserId,
    });
  },

  async confirmMicrosoft(
    input: ConfirmMicrosoftSignatureInput
  ): Promise<EmailSignatureRecord> {
    return EmailSignatureService.saveProvider({
      companyId: input.companyId,
      connectionId: input.connectionId,
      scopeUserId: input.scopeUserId ?? null,
      source: "microsoft_confirmed",
      providerIdentity: input.mailboxAddress,
      html: input.html,
      text: input.text,
      fetchedAt: null,
      confirmedAt: new Date().toISOString(),
      actorUserId: input.actorUserId,
    });
  },

  async saveProvider(
    input: SaveProviderSignatureInput
  ): Promise<EmailSignatureRecord> {
    const providerIdentity = normalizeEmailAddress(input.providerIdentity);
    if (!providerIdentity) {
      throw new Error("Provider signature identity cannot be empty");
    }
    const now = new Date().toISOString();
    return persistSignature({
      ...input,
      // Provider-managed signatures belong to the connected mailbox identity,
      // not to whichever OPS operator happened to import them.
      scopeUserId: null,
      providerIdentity,
      fetchedAt:
        input.source === "gmail_send_as" ? (input.fetchedAt ?? now) : null,
      confirmedAt:
        input.source === "microsoft_confirmed"
          ? (input.confirmedAt ?? now)
          : null,
      actorUserId: input.actorUserId,
    });
  },

  async deactivate(input: DeactivateEmailSignatureInput): Promise<void> {
    if (!input.signatureId && !input.source) {
      throw new Error("A signature id or source is required to deactivate");
    }
    const supabase = requireSupabase();
    const { error } = await supabase.rpc(
      "deactivate_email_signature_as_system",
      {
        p_actor_user_id: input.actorUserId,
        p_connection_id: input.connectionId,
        p_signature_id: input.signatureId ?? null,
        p_source: input.source ?? null,
      }
    );
    if (error) {
      throw new Error(`Failed to deactivate email signature: ${error.message}`);
    }
  },

  async refreshProvider(input: RefreshProviderSignatureInput): Promise<
    | {
        status: "stale";
        signature: EmailSignatureRecord | null;
        error: string;
      }
    | {
        status: "unsupported" | "not_configured";
        signature: EmailSignatureRecord | null;
      }
    | { status: "refreshed"; signature: EmailSignatureRecord }
  > {
    const rows = await EmailSignatureService.listActive(input);
    const providerSource =
      input.provider.providerType === "gmail"
        ? "gmail_send_as"
        : "microsoft_confirmed";
    const mailboxAddress = normalizeEmailAddress(input.mailboxAddress);
    const existing =
      rows.find(
        (row) =>
          row.source === providerSource &&
          normalizeEmailAddress(row.providerIdentity ?? "") === mailboxAddress
      ) ?? null;

    if (!input.provider.getEmailSignature) {
      return { status: "unsupported", signature: existing };
    }

    const providerRead = await runEmailProviderMailboxOperation({
      supabase: input.providerLockCheckpoint ? undefined : requireSupabase(),
      connectionId: input.connectionId,
      context: "email-signature-provider-refresh",
      busyError: "EMAIL_SIGNATURE_PROVIDER_MAILBOX_BUSY",
      providerLockCheckpoint: input.providerLockCheckpoint,
      run: async (checkpoint) => {
        await checkpoint();
        let result;
        try {
          result = await input.provider.getEmailSignature!();
        } catch (error) {
          await checkpoint();
          return { ok: false as const, error };
        }
        await checkpoint();
        return { ok: true as const, result };
      },
    });
    if (!providerRead.ok) {
      return {
        status: "stale",
        signature: existing,
        error:
          providerRead.error instanceof Error
            ? providerRead.error.message
            : String(providerRead.error),
      };
    }

    const result = providerRead.result;
    try {
      if (result.status === "unsupported") {
        return { status: "unsupported", signature: existing };
      }
      if (result.status === "not_configured") {
        if (existing) {
          await EmailSignatureService.deactivate({
            companyId: input.companyId,
            connectionId: input.connectionId,
            signatureId: existing.id,
            actorUserId: input.actorUserId,
          });
        }
        return { status: "not_configured", signature: null };
      }
      const saved = await EmailSignatureService.saveProvider({
        companyId: input.companyId,
        connectionId: input.connectionId,
        scopeUserId: null,
        source: result.source,
        providerIdentity:
          result.providerIdentity ??
          normalizeEmailAddress(input.mailboxAddress),
        html: result.contentHtml,
        actorUserId: input.actorUserId,
      });
      return { status: "refreshed", signature: saved };
    } catch (error) {
      return {
        status: "stale",
        signature: existing,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export function emailSignatureHtmlToText(html: string): string {
  return htmlToPlainText(sanitizeEmailSignatureHtml(html));
}

export function sanitizeEmailSignatureHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      "*": ["style"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
        "background-color": [
          /^#[0-9a-f]{3,8}$/i,
          /^rgba?\([\d\s.,%]+\)$/i,
          /^[a-z]+$/i,
        ],
        "border-collapse": [/^(?:collapse|separate)$/i],
        "font-family": [/^[\w\s,'"-]+$/],
        "font-size": [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i],
        "font-style": [/^(?:normal|italic|oblique)$/i],
        "font-weight": [/^(?:normal|bold|[1-9]00)$/i],
        "line-height": [/^(?:normal|\d+(?:\.\d+)?(?:px|pt|em|rem|%)?)$/i],
        "text-align": [/^(?:left|right|center|justify)$/i],
        "text-decoration": [/^(?:none|underline|line-through)$/i],
        "vertical-align": [/^(?:baseline|middle|top|bottom)$/i],
        "white-space": [/^(?:normal|nowrap|pre|pre-wrap)$/i],
        width: [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i],
        height: [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i],
      },
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
      }),
    },
  });
}
