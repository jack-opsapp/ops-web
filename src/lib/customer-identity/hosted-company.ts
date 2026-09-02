/**
 * OPS Web - Hosted Customer Surface: company resolution
 *
 * Every hosted page lives under `/c/<public_handle>/…`. The handle is the
 * only identifier a customer ever sees (design §4, invariant I4 — companies
 * are addressed by `companies.public_handle`, never by UUID). This module
 * turns a handle into the branded company record the shell renders.
 *
 * Resolution is wrapped in React `cache` so the layout, the page and
 * `generateMetadata` share one database round-trip per request.
 */

import "server-only";
import { cache } from "react";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { PortalBrandingService } from "@/lib/api/services/portal-branding-service";
import type { PortalBranding } from "@/lib/types/portal";

/** Mirrors the CHECK constraint on `companies.public_handle` (P1 migration). */
export const PUBLIC_HANDLE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const PUBLIC_HANDLE_MIN = 3;
export const PUBLIC_HANDLE_MAX = 48;

export function isValidPublicHandle(handle: string): boolean {
  return (
    handle.length >= PUBLIC_HANDLE_MIN &&
    handle.length <= PUBLIC_HANDLE_MAX &&
    PUBLIC_HANDLE_PATTERN.test(handle)
  );
}

export interface HostedCompany {
  id: string;
  handle: string;
  name: string;
  logoUrl: string | null;
  branding: PortalBranding;
}

interface CompanyRow {
  id: string;
  name: string | null;
  logo_url: string | null;
  deleted_at: string | null;
}

/**
 * Some legacy rows store protocol-relative logo URLs (`//…cdn.bubble.io/…`).
 * The service mappers normalize these before `next/image`; the hosted shell
 * renders a plain `<img>` so it normalizes here.
 */
export function normalizeLogoUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

/**
 * Development-only seam: map one handle to one company id without the
 * `companies.public_handle` column. Lets the hosted shell be previewed and
 * end-to-end tested on a database that has not received the P1 migration
 * yet, and keeps the Playwright smoke hermetic afterwards. Inert in
 * production builds regardless of environment variables.
 */
function fixtureCompanyIdFor(handle: string): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const fixtureHandle = process.env.OPS_CUSTOMER_HOSTED_FIXTURE_HANDLE;
  const fixtureCompanyId = process.env.OPS_CUSTOMER_HOSTED_FIXTURE_COMPANY_ID;
  if (!fixtureHandle || !fixtureCompanyId) return null;
  return fixtureHandle === handle ? fixtureCompanyId : null;
}

const COMPANY_COLUMNS = "id, name, logo_url, deleted_at";

/** Postgres: undefined_column — the P1 migration has not been applied to this database. */
const UNDEFINED_COLUMN = "42703";

let warnedMissingHandleColumn = false;

async function loadCompanyRow(handle: string): Promise<CompanyRow | null> {
  const supabase = getServiceRoleClient();

  const fixtureId = fixtureCompanyIdFor(handle);
  if (fixtureId) {
    const { data, error } = await supabase
      .from("companies")
      .select(COMPANY_COLUMNS)
      .eq("id", fixtureId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load hosted company: ${error.message}`);
    return (data as CompanyRow | null) ?? null;
  }

  const { data, error } = await supabase
    .from("companies")
    .select(COMPANY_COLUMNS)
    .eq("public_handle", handle)
    .maybeSingle();

  if (error) {
    if (error.code === UNDEFINED_COLUMN) {
      if (!warnedMissingHandleColumn) {
        warnedMissingHandleColumn = true;
        console.warn(
          "[customer-identity] companies.public_handle does not exist on this database; hosted pages resolve nothing until the P1 migration is applied."
        );
      }
      return null;
    }
    throw new Error(`Failed to load hosted company: ${error.message}`);
  }

  return (data as CompanyRow | null) ?? null;
}

/**
 * Resolve a public handle to its company and branding. Returns null for a
 * malformed handle, an unknown handle, or a soft-deleted company — the
 * caller renders the same not-found page for all three (no distinction is
 * ever surfaced to a visitor).
 */
export const resolveHostedCompany = cache(
  async (handle: string): Promise<HostedCompany | null> => {
    if (!isValidPublicHandle(handle)) return null;

    const row = await loadCompanyRow(handle);
    if (!row || row.deleted_at) return null;

    const branding = await PortalBrandingService.readBranding(row.id);
    const name = row.name?.trim() || "";
    if (name.length === 0) return null;

    return {
      id: row.id,
      handle,
      name,
      logoUrl: normalizeLogoUrl(row.logo_url) ?? normalizeLogoUrl(branding.logoUrl),
      branding,
    };
  }
);
