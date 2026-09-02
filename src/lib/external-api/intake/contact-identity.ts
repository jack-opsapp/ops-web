import "server-only";

import { z } from "zod";

import { type CountryCode, isSupportedCountry } from "libphonenumber-js";

import { InvalidPhoneError, normalizePhoneE164 } from "@/lib/sms/phone-utils";

const validatedEmailSchema = z.string().email().max(320);

export type ContactIdentitySignal = Readonly<{
  kind: "email" | "phone";
  value: string;
}>;

export interface ContactIdentityInput {
  name: string;
  email?: string;
  phone?: string;
  phoneRegion?: string;
}

export interface ContactIdentityOptions {
  defaultPhoneRegion?: string;
}

export interface CanonicalContactIdentity {
  evidence: {
    name: string;
    email?: string;
    phone?: string;
    phoneRegion?: string;
  };
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  normalizedName: string;
  identitySignals: readonly ContactIdentitySignal[];
}

function normalizeEvidenceText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function normalizeValidatedEmail(value: string): string {
  const evidence = value.trim().normalize("NFC");
  const parsed = validatedEmailSchema.safeParse(evidence);
  if (!parsed.success) {
    throw new Error("validated contact email is invalid");
  }
  return parsed.data.toLowerCase();
}

export function normalizeComparisonName(value: string): string {
  return normalizeEvidenceText(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function reliablePhoneRegion(
  explicitRegion: string | undefined,
  defaultRegion: string | undefined
): CountryCode | null {
  const selected = explicitRegion ?? defaultRegion;
  if (!selected) return null;
  if (!isSupportedCountry(selected)) {
    throw new Error("contact phone region is unsupported");
  }
  return selected;
}

export function canonicalizeContactIdentity(
  input: ContactIdentityInput,
  options: ContactIdentityOptions = {}
): CanonicalContactIdentity {
  const name = normalizeEvidenceText(input.name);
  const evidenceEmail = input.email?.trim().normalize("NFC");
  const evidencePhone = input.phone?.trim().normalize("NFKC");
  const evidenceRegion = input.phoneRegion?.trim().toUpperCase();
  const normalizedEmail = evidenceEmail
    ? normalizeValidatedEmail(evidenceEmail)
    : null;

  let normalizedPhone: string | null = null;
  if (evidencePhone) {
    const isInternational = evidencePhone.startsWith("+");
    const region = reliablePhoneRegion(
      evidenceRegion,
      options.defaultPhoneRegion?.trim().toUpperCase()
    );
    if (isInternational || region) {
      try {
        normalizedPhone = normalizePhoneE164(evidencePhone, region ?? "US");
      } catch (error) {
        if (!(error instanceof InvalidPhoneError)) throw error;
      }
    }
  }

  const identitySignals: ContactIdentitySignal[] = [];
  if (normalizedEmail) {
    identitySignals.push({ kind: "email", value: normalizedEmail });
  }
  if (normalizedPhone) {
    identitySignals.push({ kind: "phone", value: normalizedPhone });
  }

  return Object.freeze({
    evidence: Object.freeze({
      name,
      ...(evidenceEmail ? { email: evidenceEmail } : {}),
      ...(evidencePhone ? { phone: evidencePhone } : {}),
      ...(evidenceRegion ? { phoneRegion: evidenceRegion } : {}),
    }),
    normalizedEmail,
    normalizedPhone,
    normalizedName: normalizeComparisonName(name),
    identitySignals: Object.freeze(identitySignals),
  });
}
