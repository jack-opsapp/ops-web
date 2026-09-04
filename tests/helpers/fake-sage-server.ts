export type FakeSageResource =
  | "businesses"
  | "contacts"
  | "sales_estimates"
  | "sales_quotes"
  | "sales_invoices"
  | "contact_payments"
  | "purchase_invoices";

type WriteMethod = "POST" | "PUT" | "DELETE";

interface FakeSageFault {
  method: WriteMethod | "GET";
  resource: FakeSageResource;
  status?: number;
  afterAccept?: boolean;
  page?: number;
}

export interface FakeSageRequest {
  method: string;
  resource: FakeSageResource;
  businessId: string | null;
  authorization: string | null;
  idempotencyId: string | null;
  page: number;
  url: string;
}

const ENVELOPE_BY_RESOURCE: Partial<Record<FakeSageResource, string>> = {
  contacts: "contact",
  contact_payments: "contact_payment",
  purchase_invoices: "purchase_invoice",
  sales_estimates: "sales_estimate",
  sales_invoices: "sales_invoice",
  sales_quotes: "sales_quote",
};

function json(
  status: number,
  body: unknown,
  requestId: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": requestId,
      ...extraHeaders,
    },
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class FakeSageServer {
  readonly primaryBusinessId = "sage-test-business-a";
  readonly secondaryBusinessId = "sage-test-business-b";
  readonly requests: FakeSageRequest[] = [];
  readonly acceptedWrites: Array<{
    method: WriteMethod;
    resource: FakeSageResource;
    id: string;
    idempotencyId: string | null;
  }> = [];

  private readonly state = new Map<
    FakeSageResource,
    Map<string, Record<string, unknown>>
  >();
  private readonly counters = new Map<FakeSageResource, number>();
  private readonly idempotentResponses = new Map<
    string,
    Record<string, unknown>
  >();
  private readonly validTokens = new Set(["access-1"]);
  private readonly faults: FakeSageFault[] = [];
  private requestSequence = 0;
  private revoked = false;
  private duplicatePageBoundary = false;

  constructor(readonly now = "2026-09-04T12:00:00.000Z") {
    for (const resource of [
      "businesses",
      "contacts",
      "sales_estimates",
      "sales_quotes",
      "sales_invoices",
      "contact_payments",
      "purchase_invoices",
    ] as const) {
      this.state.set(resource, new Map());
    }
    this.seed("businesses", [
      { id: this.primaryBusinessId, name: "OPS Test Business", active: true },
      {
        id: this.secondaryBusinessId,
        name: "Foreign Test Business",
        active: true,
      },
    ]);
  }

  readonly fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    );
    const method = String(init.method ?? "GET").toUpperCase();
    const parts = url.pathname.split("/").filter(Boolean);
    const versionIndex = parts.findIndex((part) => /^v\d/.test(part));
    const resource = parts[versionIndex + 1] as FakeSageResource | undefined;
    const id = parts[versionIndex + 2]
      ? decodeURIComponent(parts[versionIndex + 2])
      : undefined;
    if (!resource || !this.state.has(resource)) {
      return this.response(404, { error: "unknown resource" });
    }

    const headers = new Headers(init.headers);
    const businessId = headers.get("X-Business");
    const authorization = headers.get("Authorization");
    const page = Number(url.searchParams.get("page") ?? "1");
    let body: Record<string, unknown> | null = null;
    let idempotencyId: string | null = null;
    if (init.body) {
      const decoded = JSON.parse(String(init.body)) as Record<string, unknown>;
      const envelope = ENVELOPE_BY_RESOURCE[resource];
      body = envelope
        ? ((decoded[envelope] as Record<string, unknown> | undefined) ?? null)
        : null;
      idempotencyId =
        typeof body?.idempotency_id === "string" ? body.idempotency_id : null;
    }
    this.requests.push({
      method,
      resource,
      businessId,
      authorization,
      idempotencyId,
      page,
      url: url.toString(),
    });

    if (!authorization?.startsWith("Bearer ")) {
      return this.response(401, { error: "missing token" });
    }
    if (!this.validTokens.has(authorization.slice("Bearer ".length))) {
      return this.response(401, { error: "expired token" });
    }
    if (this.revoked) {
      return this.response(403, { error: "grant revoked" });
    }
    if (businessId !== this.primaryBusinessId) {
      return this.response(403, { error: "wrong business" });
    }

    const faultIndex = this.faults.findIndex(
      (fault) =>
        fault.resource === resource &&
        fault.method === method &&
        (fault.page === undefined || fault.page === page)
    );
    const fault =
      faultIndex === -1 ? undefined : this.faults.splice(faultIndex, 1)[0];
    if (fault?.status && !fault.afterAccept) {
      return this.response(
        fault.status,
        { error: "injected failure" },
        fault.status === 429 ? { "Retry-After": "2" } : {}
      );
    }

    if (method === "GET") {
      if (id) {
        const found = this.store(resource).get(id);
        return found
          ? this.response(200, clone(found))
          : this.response(404, { error: "not found" });
      }
      return this.list(resource, page, url);
    }
    if (method === "DELETE") {
      if (!id) return this.response(400, { error: "id required" });
      const found = this.store(resource).get(id);
      if (!found) return this.response(404, { error: "not found" });
      found.deleted_at = this.now;
      found.status = { id: "VOIDED" };
      this.acceptedWrites.push({
        method: "DELETE",
        resource,
        id,
        idempotencyId: null,
      });
      return this.response(204, undefined);
    }
    if (method !== "POST" && method !== "PUT") {
      return this.response(405, { error: "method not allowed" });
    }

    if (!body || !idempotencyId || !/^[a-f0-9]{32}$/.test(idempotencyId)) {
      return this.response(422, { error: "idempotency_id required" });
    }
    const replayKey = `${resource}:${idempotencyId}`;
    const replay = this.idempotentResponses.get(replayKey);
    if (replay)
      return this.response(method === "POST" ? 201 : 200, clone(replay));

    const dependencyError = this.validateDependencies(resource, body);
    if (dependencyError) return this.response(422, { error: dependencyError });

    const recordId =
      method === "PUT"
        ? id
        : `${resource}-${(this.counters.get(resource) ?? 0) + 1}`;
    if (!recordId) return this.response(400, { error: "id required" });
    this.counters.set(resource, (this.counters.get(resource) ?? 0) + 1);
    const record = {
      ...clone(body),
      id: recordId,
      updated_at: this.now,
      deleted_at: null,
    };
    this.store(resource).set(recordId, record);
    this.idempotentResponses.set(replayKey, clone(record));
    this.acceptedWrites.push({
      method,
      resource,
      id: recordId,
      idempotencyId,
    });
    if (fault?.afterAccept) {
      throw new TypeError("Injected response loss after provider acceptance");
    }
    return this.response(method === "POST" ? 201 : 200, clone(record));
  };

  seed(resource: FakeSageResource, records: Record<string, unknown>[]): void {
    for (const source of records) {
      const id = String(source.id ?? "").trim();
      if (!id) throw new Error("Fake Sage seed requires an id");
      this.store(resource).set(id, clone(source));
    }
  }

  expireToken(token: string): void {
    this.validTokens.delete(token);
  }

  addToken(token: string): void {
    this.validTokens.add(token);
  }

  revokeGrant(): void {
    this.revoked = true;
  }

  restoreGrant(): void {
    this.revoked = false;
  }

  inject(fault: FakeSageFault): void {
    this.faults.push(fault);
  }

  duplicatePaginationBoundaryOnce(): void {
    this.duplicatePageBoundary = true;
  }

  records(resource: FakeSageResource): Record<string, unknown>[] {
    return [...this.store(resource).values()].map(clone);
  }

  record(
    resource: FakeSageResource,
    id: string
  ): Record<string, unknown> | null {
    const value = this.store(resource).get(id);
    return value ? clone(value) : null;
  }

  logicalAcceptCount(
    resource: FakeSageResource,
    idempotencyId: string
  ): number {
    return this.acceptedWrites.filter(
      (write) =>
        write.resource === resource && write.idempotencyId === idempotencyId
    ).length;
  }

  private store(resource: FakeSageResource) {
    const store = this.state.get(resource);
    if (!store) throw new Error(`Unknown fake Sage resource: ${resource}`);
    return store;
  }

  private response(
    status: number,
    body: unknown,
    extraHeaders: Record<string, string> = {}
  ): Response {
    this.requestSequence += 1;
    return json(
      status,
      body,
      `fake-sage-request-${this.requestSequence}`,
      extraHeaders
    );
  }

  private list(resource: FakeSageResource, page: number, url: URL): Response {
    const since = url.searchParams.get("updated_or_created_since");
    let values = this.records(resource).filter((record) => {
      if (!since || typeof record.updated_at !== "string") return true;
      return Date.parse(record.updated_at) >= Date.parse(since);
    });
    values = values.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const pageSize = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get("items_per_page") ?? "200"))
    );
    const start = (page - 1) * pageSize;
    const pageItems = values.slice(start, start + pageSize);
    if (this.duplicatePageBoundary && page > 1 && start > 0) {
      const overlap = values[start - 1];
      if (overlap) pageItems.unshift(overlap);
      this.duplicatePageBoundary = false;
    }
    return this.response(200, { $items: pageItems });
  }

  private validateDependencies(
    resource: FakeSageResource,
    body: Record<string, unknown>
  ): string | null {
    if (
      [
        "sales_estimates",
        "sales_quotes",
        "sales_invoices",
        "purchase_invoices",
      ].includes(resource)
    ) {
      const contactId = String(body.contact_id ?? "");
      if (!this.store("contacts").has(contactId)) {
        return "contact must exist before document";
      }
    }
    if (resource === "contact_payments") {
      const contactId = String(body.contact_id ?? "");
      if (!this.store("contacts").has(contactId)) {
        return "contact must exist before payment";
      }
      const allocations = Array.isArray(body.allocated_artefacts)
        ? body.allocated_artefacts
        : [];
      for (const value of allocations) {
        const allocation = value as { artefact_id?: unknown };
        const artefactId = String(allocation.artefact_id ?? "");
        if (
          !this.store("sales_invoices").has(artefactId) &&
          !this.store("purchase_invoices").has(artefactId)
        ) {
          return "document must exist before payment";
        }
      }
    }
    return null;
  }
}
