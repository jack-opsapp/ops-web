/**
 * Derive the phone + address shown on the inbox right-rail client strip.
 *
 * The strip's job is to surface "who the thread is with" — name / phone /
 * address. The clients table is the canonical home for these fields, but
 * sync only populates `clients.phone_number` / `clients.address` when the
 * source row carried them at create-time. When a quote-form opportunity
 * lands with phone + address but the matching client row is created from
 * just a sender email, that contact info is captured on the opportunity
 * (and downstream project) and never backfilled to the client. Net result
 * for the operator: the strip shows the email, hides the phone they need
 * to call, and hides the address they need to drive to — even though the
 * data is sitting one join away.
 *
 * This helper resolves that fragmentation at read time. It walks a fixed
 * fallback chain — client → most-recent opportunity → most-recent project
 * — and returns the first non-empty value for each field. The strip does
 * not invent data; every value here exists somewhere in the operator's
 * own records.
 *
 * Sync-side fix tracked separately: see Supabase bug report for the
 * backfill gap (clients.phone_number / clients.address never populated
 * from later opportunities or projects).
 */

import type { Client, Project } from "../types/models";
import type { Opportunity } from "../types/pipeline";

export interface StripContact {
  phone: string | null;
  address: string | null;
}

interface ContactInputs {
  client: Pick<Client, "phoneNumber" | "address"> | null | undefined;
  opportunities: ReadonlyArray<
    Pick<Opportunity, "contactPhone" | "address" | "createdAt">
  >;
  projects: ReadonlyArray<Pick<Project, "address" | "createdAt">>;
}

export function deriveStripContact(inputs: ContactInputs): StripContact {
  const { client, opportunities, projects } = inputs;

  const oppsByDateDesc = [...opportunities].sort(
    (a, b) => dateValue(b.createdAt) - dateValue(a.createdAt),
  );
  const projectsByDateDesc = [...projects].sort(
    (a, b) => dateValue(b.createdAt) - dateValue(a.createdAt),
  );

  const phone =
    nonEmpty(client?.phoneNumber) ??
    firstNonEmpty(oppsByDateDesc.map((o) => o.contactPhone));

  const address =
    nonEmpty(client?.address) ??
    firstNonEmpty(oppsByDateDesc.map((o) => o.address)) ??
    firstNonEmpty(projectsByDateDesc.map((p) => p.address));

  return { phone, address };
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstNonEmpty(
  values: ReadonlyArray<string | null | undefined>,
): string | null {
  for (const v of values) {
    const result = nonEmpty(v);
    if (result !== null) return result;
  }
  return null;
}

function dateValue(value: Date | null | undefined): number {
  if (!value) return 0;
  const ms = value.getTime();
  return Number.isFinite(ms) ? ms : 0;
}
