/**
 * OPS Web - Lead Client Matcher
 *
 * Bug 1d5ab9aa — a manually saved lead never created its client. The
 * email/lead-engine import paths create-and-link a `clients` row; the manual
 * create-lead modal did not, so a hand-entered lead existed only as free-text
 * contact fields and Won-conversion produced a client-less project.
 *
 * This mirrors `ops-ios OPS/Services/LeadClientMatcher.swift` exactly so both
 * platforms converge on the same client rows. Match half: BEFORE creating a
 * client, look for one the company already has so repeat callers never spawn
 * duplicates. Strongest signal first:
 *
 *   1. phone  — digits-only, suffix match ≥7 digits (survives +1 / formatting)
 *   2. email  — case-insensitive exact
 *   3. name   — case- and whitespace-insensitive exact
 *
 * Soft-deleted clients never match (client merges also stamp `deleted_at` on
 * the losing row, so merged clients are excluded by the same filter). Create
 * half: `resolveLeadClientId` — client failure never blocks the lead; it
 * returns null and the lead saves unlinked.
 */

import type { Client } from "@/lib/types/models";

export interface LeadContactFields {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  /** Present only when the address carries a real geocoded pin. */
  latitude?: number | null;
  longitude?: number | null;
}

export interface LeadClientResolverDeps {
  /** Fresh company-scoped client list (soft-deleted rows excluded upstream or filtered here). */
  fetchClients: () => Promise<Client[]>;
  /** Durable create path (ClientService / useCreateClient) — companyId bound by the caller. */
  createClient: (fields: {
    name: string;
    email: string | null;
    phoneNumber: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  }) => Promise<Client>;
  /** Last-known client list to match against when the fresh fetch fails. */
  cachedClients?: Client[];
}

/** Digits-only form of a phone number; null when fewer than 7 digits (too short to be a meaningful match key). */
export function normalizedPhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

/** Trimmed, lowercased email; null when empty or not plausibly an email. */
export function normalizedEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed.includes("@") || trimmed.length < 3) return null;
  return trimmed;
}

/** Trimmed, lowercased name; null when empty. */
export function normalizedName(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Two phones match when either digits-string is a suffix of the other
 * (handles "+1 604 555 0142" vs "604-555-0142"). Both sides must keep ≥7
 * digits, so a bare extension can never claim a client.
 */
export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizedPhone(a);
  const nb = normalizedPhone(b);
  if (na === null || nb === null) return false;
  return na.endsWith(nb) || nb.endsWith(na);
}

/** First live client matching phone → email → name, in that priority. Soft-deleted clients never match. */
export function matchLeadClient(
  clients: Client[],
  contact: Pick<LeadContactFields, "name" | "email" | "phone">
): Client | null {
  const live = clients.filter((c) => c.deletedAt == null);

  if (normalizedPhone(contact.phone) !== null) {
    const byPhone = live.find((c) => phonesMatch(c.phoneNumber, contact.phone));
    if (byPhone) return byPhone;
  }

  const targetEmail = normalizedEmail(contact.email);
  if (targetEmail !== null) {
    const byEmail = live.find((c) => normalizedEmail(c.email) === targetEmail);
    if (byEmail) return byEmail;
  }

  const targetName = normalizedName(contact.name);
  if (targetName !== null) {
    const byName = live.find((c) => normalizedName(c.name) === targetName);
    if (byName) return byName;
  }

  return null;
}

/**
 * Match-or-create the client for a manually entered lead. Returns the client
 * id to link, or null when no client could be resolved — never throws, so the
 * lead itself is never blocked.
 */
export async function resolveLeadClientId(
  contact: LeadContactFields,
  deps: LeadClientResolverDeps
): Promise<string | null> {
  const name = contact.name.trim();
  if (!name) return null;

  let clients: Client[];
  try {
    clients = await deps.fetchClients();
  } catch (error) {
    console.error(
      "[create-lead] client fetch for matching failed — matching against cached list:",
      error
    );
    clients = deps.cachedClients ?? [];
  }

  const existing = matchLeadClient(clients, contact);
  if (existing) return existing.id;

  try {
    const created = await deps.createClient({
      name,
      email: contact.email || null,
      phoneNumber: contact.phone || null,
      address: contact.address || null,
      latitude: contact.latitude ?? null,
      longitude: contact.longitude ?? null,
    });
    return created.id;
  } catch (error) {
    console.error("[create-lead] client autocreate failed — saving lead unlinked:", error);
    return null;
  }
}
