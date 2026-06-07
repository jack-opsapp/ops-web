import type { QuickBooksEnvironment } from "./quickbooks-config";

export type QboWriteEntity = "Customer" | "Invoice" | "Estimate" | "Payment";

export interface QuickBooksWriteServiceInput {
  realmId: string;
  accessToken: string;
  environment: QuickBooksEnvironment;
  fetchImpl?: typeof fetch;
}

export interface QuickBooksWriteResult {
  qbId: string;
  syncToken: string | null;
  metaUpdatedAt: string | null;
  raw: Record<string, unknown>;
}

const ENTITY_PATH: Record<QboWriteEntity, string> = {
  Customer: "customer",
  Invoice: "invoice",
  Estimate: "estimate",
  Payment: "payment",
};

function hostFor(environment: QuickBooksEnvironment): string {
  return environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

function assertQboId(id: string): void {
  if (!/^\d+$/.test(id)) throw new Error("Invalid QuickBooks id");
}

function requireUpdatePayload(payload: Record<string, unknown>): void {
  const id = payload.Id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("QuickBooks update Id required");
  }
  assertQboId(id.trim());

  const syncToken = payload.SyncToken;
  if (typeof syncToken !== "string" || syncToken.trim() === "") {
    throw new Error("QuickBooks update SyncToken required");
  }
}

function entityUrl(input: QuickBooksWriteServiceInput, entity: QboWriteEntity) {
  return `${hostFor(input.environment)}/v3/company/${input.realmId}/${ENTITY_PATH[entity]}?minorversion=75`;
}

function currentUrl(
  input: QuickBooksWriteServiceInput,
  entity: QboWriteEntity,
  id: string,
) {
  return `${hostFor(input.environment)}/v3/company/${input.realmId}/${ENTITY_PATH[entity]}/${id}?minorversion=75`;
}

function entityBody(
  raw: Record<string, unknown>,
  entity: QboWriteEntity,
): Record<string, unknown> {
  const body = raw[entity];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`QuickBooks response missing ${entity} body`);
  }
  return body as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanProviderText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function truncateProviderText(value: string): string {
  return value.length > 600 ? `${value.slice(0, 597)}...` : value;
}

function structuredProviderErrorSuffix(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    const fault = asRecord(asRecord(parsed)?.Fault);
    const errors = fault?.Error;
    if (!Array.isArray(errors)) return "";

    const details = errors
      .map((entry) => {
        const error = asRecord(entry);
        if (!error) return null;
        const code = cleanProviderText(error.code);
        const message = cleanProviderText(error.Message);
        const detail = cleanProviderText(error.Detail);
        const headline = code && message ? `[${code}] ${message}` : (message ?? (code ? `[${code}]` : null));
        if (!headline && !detail) return null;
        if (!detail || detail === message) return headline ?? detail;
        return headline ? `${headline}: ${detail}` : detail;
      })
      .filter((detail): detail is string => Boolean(detail));

    return details.length > 0 ? `: ${truncateProviderText(details.join("; "))}` : "";
  } catch {
    return "";
  }
}

function normalizeWriteResult(
  raw: Record<string, unknown>,
  entity: QboWriteEntity,
): QuickBooksWriteResult {
  const body = entityBody(raw, entity);
  const id = body.Id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`QuickBooks response missing ${entity}.Id`);
  }

  const metaData = body.MetaData;
  const metaUpdatedAt =
    metaData &&
    typeof metaData === "object" &&
    !Array.isArray(metaData) &&
    typeof (metaData as Record<string, unknown>).LastUpdatedTime === "string"
      ? ((metaData as Record<string, unknown>).LastUpdatedTime as string)
      : null;

  return {
    qbId: id,
    syncToken:
      body.SyncToken === null || body.SyncToken === undefined
        ? null
        : String(body.SyncToken),
    metaUpdatedAt,
    raw,
  };
}

export class QuickBooksWriteService {
  public writeCalls = 0;

  private readonly input: QuickBooksWriteServiceInput;

  constructor(input: QuickBooksWriteServiceInput) {
    this.input = input;
  }

  async create(
    entity: QboWriteEntity,
    payload: Record<string, unknown>,
  ): Promise<QuickBooksWriteResult> {
    return this.post(entity, payload);
  }

  async update(
    entity: QboWriteEntity,
    payload: Record<string, unknown>,
  ): Promise<QuickBooksWriteResult> {
    requireUpdatePayload(payload);
    return this.post(entity, payload);
  }

  async fetchCurrent(
    entity: QboWriteEntity,
    id: string,
  ): Promise<Record<string, unknown>> {
    assertQboId(id);
    const fetchImpl = this.input.fetchImpl ?? fetch;
    const response = await fetchImpl(currentUrl(this.input, entity, id), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.input.accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`QuickBooks fetch failed: ${response.status}${structuredProviderErrorSuffix(bodyText)}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  private async post(
    entity: QboWriteEntity,
    payload: Record<string, unknown>,
  ): Promise<QuickBooksWriteResult> {
    const fetchImpl = this.input.fetchImpl ?? fetch;
    this.writeCalls += 1;
    const response = await fetchImpl(entityUrl(this.input, entity), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.input.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`QuickBooks write failed: ${response.status}${structuredProviderErrorSuffix(bodyText)}`);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    return normalizeWriteResult(raw, entity);
  }
}
