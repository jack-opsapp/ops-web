export interface SagePurchasingServiceInput {
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export interface SagePurchasingResult {
  sageId: string;
  raw: Record<string, unknown>;
}

type SagePurchasingEntity =
  "contacts" | "purchase_invoices" | "contact_payments";

const SAGE_API_BASE = "https://api.accounting.sage.com/v3.1";

function readId(raw: Record<string, unknown>): string {
  const id = raw.id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("Sage response is missing its entity identifier.");
  }
  return id;
}

export class SagePurchasingService {
  constructor(private readonly input: SagePurchasingServiceInput) {}

  create(
    entity: SagePurchasingEntity,
    payload: Record<string, unknown>
  ): Promise<SagePurchasingResult> {
    return this.write("POST", entity, payload);
  }

  update(
    entity: SagePurchasingEntity,
    id: string,
    payload: Record<string, unknown>
  ): Promise<SagePurchasingResult> {
    if (!id.trim()) throw new Error("Sage update identifier is required.");
    return this.write("PUT", entity, payload, id);
  }

  async delete(entity: "purchase_invoices", id: string): Promise<void> {
    if (!id.trim()) throw new Error("Sage delete identifier is required.");
    const response = await (this.input.fetchImpl ?? fetch)(
      `${SAGE_API_BASE}/${entity}/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.input.accessToken}`,
          Accept: "application/json",
        },
      }
    );
    if (!response.ok) {
      throw new Error(`Sage delete failed (${response.status}).`);
    }
  }

  private async write(
    method: "POST" | "PUT",
    entity: SagePurchasingEntity,
    payload: Record<string, unknown>,
    id?: string
  ): Promise<SagePurchasingResult> {
    const suffix = id ? `/${encodeURIComponent(id)}` : "";
    const response = await (this.input.fetchImpl ?? fetch)(
      `${SAGE_API_BASE}/${entity}${suffix}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.input.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );
    if (!response.ok) {
      throw new Error(`Sage write failed (${response.status}).`);
    }
    const raw = (await response.json()) as Record<string, unknown>;
    return { sageId: readId(raw), raw };
  }
}
