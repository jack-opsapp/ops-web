import {
  extractAddressFromBody,
  extractPhoneFromBody,
} from "@/lib/utils/body-fact-extractors";

export interface ClientExtractionFactsInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface ImportExtractionMessage {
  direction: "inbound" | "outbound";
  body: string | null | undefined;
}

export interface ClientExtractionSanitizerContext {
  clientEmail?: string | null;
  internalNames?: Array<string | null | undefined>;
  internalEmails?: Array<string | null | undefined>;
  internalPhones: Array<string | null | undefined>;
  companyAddresses?: Array<string | null | undefined>;
  messages: ImportExtractionMessage[];
}

export interface SanitizedClientExtractionFacts {
  name: string | null;
  phone: string | null;
  address: string | null;
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIdentityKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeIdentityLetters(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function identitySet(
  values: Array<string | null | undefined> | undefined
): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => cleanText(value))
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => [
        normalizeIdentityKey(value),
        normalizeIdentityLetters(value),
      ])
      .filter(Boolean)
  );
}

export function sanitizeExtractedClientName(
  name: string | null | undefined,
  email: string | null | undefined,
  options?: {
    internalNames?: Array<string | null | undefined>;
    internalEmails?: Array<string | null | undefined>;
  }
): string | null {
  const cleaned = cleanText(name);
  if (!cleaned) return null;
  if (cleaned.includes("@")) return null;

  const emailLocalPart = cleanText(email)?.split("@")[0] ?? null;
  const internalNameKeys = identitySet(options?.internalNames);
  const internalEmailLocalKeys = identitySet(
    (options?.internalEmails ?? []).map(
      (internalEmail) => cleanText(internalEmail)?.split("@")[0]
    )
  );
  const cleanedKey = normalizeIdentityKey(cleaned);
  const cleanedLetters = normalizeIdentityLetters(cleaned);
  if (
    internalNameKeys.has(cleanedKey) ||
    internalNameKeys.has(cleanedLetters) ||
    internalEmailLocalKeys.has(cleanedKey) ||
    internalEmailLocalKeys.has(cleanedLetters)
  ) {
    return null;
  }

  if (!emailLocalPart) return cleaned;

  const nameKey = cleanedKey;
  const localKey = normalizeIdentityKey(emailLocalPart);
  const nameLetters = cleanedLetters;
  const localLetters = normalizeIdentityLetters(emailLocalPart);

  if (nameKey && nameKey === localKey) return null;
  if (nameLetters && nameLetters === localLetters) return null;
  return cleaned;
}

function inboundMessageBodies(messages: ImportExtractionMessage[]): string[] {
  return messages
    .filter((message) => message.direction === "inbound")
    .map((message) => message.body ?? "")
    .filter(Boolean);
}

function normalizeAddressKey(value: string | null | undefined): string | null {
  const extracted = extractAddressFromBody(value) ?? cleanText(value);
  if (!extracted) return null;
  const key = extracted
    .toLowerCase()
    .replace(/\b(crescent|cres)\b/g, "cres")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(lane|ln)\b/g, "lane")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/[^a-z0-9]/g, "");
  return key || null;
}

function isExcludedAddress(
  candidate: string | null,
  excludedAddresses: Array<string | null | undefined> | undefined
): boolean {
  const candidateKey = normalizeAddressKey(candidate);
  if (!candidateKey) return false;
  for (const excluded of excludedAddresses ?? []) {
    const excludedKey = normalizeAddressKey(excluded);
    if (excludedKey && excludedKey === candidateKey) return true;
  }
  return false;
}

export function sanitizeClientExtractionFacts(
  client: ClientExtractionFactsInput,
  context: ClientExtractionSanitizerContext
): SanitizedClientExtractionFacts {
  const inboundBodies = inboundMessageBodies(context.messages);

  const phone =
    extractPhoneFromBody(client.phone, {
      excludedPhones: context.internalPhones,
    }) ??
    extractNewestPhoneFromInboundBodies(inboundBodies, context.internalPhones);

  const clientAddress = extractAddressFromBody(client.address);
  const address =
    clientAddress && !isExcludedAddress(clientAddress, context.companyAddresses)
      ? clientAddress
      : extractNewestAddressFromInboundBodies(
          inboundBodies,
          context.companyAddresses
        );

  return {
    name: sanitizeExtractedClientName(
      client.name,
      client.email ?? context.clientEmail,
      {
        internalNames: context.internalNames,
        internalEmails: context.internalEmails,
      }
    ),
    phone,
    address,
  };
}

function extractNewestPhoneFromInboundBodies(
  bodies: string[],
  excludedPhones: Array<string | null | undefined>
): string | null {
  for (let index = bodies.length - 1; index >= 0; index--) {
    const phone = extractPhoneFromBody(bodies[index], { excludedPhones });
    if (phone) return phone;
  }
  return null;
}

function extractNewestAddressFromInboundBodies(
  bodies: string[],
  excludedAddresses: Array<string | null | undefined> | undefined
): string | null {
  for (let index = bodies.length - 1; index >= 0; index--) {
    const address = extractAddressFromBody(bodies[index]);
    if (address && !isExcludedAddress(address, excludedAddresses)) {
      return address;
    }
  }
  return null;
}
