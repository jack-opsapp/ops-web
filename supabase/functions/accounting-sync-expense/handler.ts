/** Compatibility only. Financial writes belong to the database queue and its workers. */
interface Configuration {
  supabaseUrl: string;
  anonKey: string;
  fetcher?: typeof fetch;
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function identifier(value: unknown): string | null {
  return typeof value === "string" && uuid.test(value)
    ? value.toLowerCase()
    : null;
}
function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { ...cors, "cache-control": "no-store" },
  });
}

export function createExpenseSyncHandler(configuration: Configuration) {
  const rpcUrl = new URL(
    "/rest/v1/rpc/request_expense_accounting_sync",
    configuration.supabaseUrl
  );
  const fetcher = configuration.fetcher ?? fetch;
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST")
      return json({ error: "POST required." }, 405);
    const authorization = request.headers.get("authorization");
    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
      return json({ error: "Authentication required." }, 401);
    }
    let body: Record<string, unknown>;
    try {
      // Bound parsing without trusting Content-Length (chunked bodies have none).
      const reader = request.body?.getReader();
      if (!reader) return json({ error: "Expense required." }, 400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 4096) {
          await reader.cancel();
          return json({ error: "Request too large." }, 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error();
      body = parsed as Record<string, unknown>;
      if (
        Object.keys(body).some(
          (key) => !["expense_id", "expenseId", "companyId"].includes(key)
        )
      )
        throw new Error();
    } catch {
      return json({ error: "Invalid expense request." }, 400);
    }
    const current = identifier(body.expense_id);
    const legacy = identifier(body.expenseId);
    const company =
      body.companyId === undefined ? null : identifier(body.companyId);
    if (
      (!current && !legacy) ||
      (body.expense_id !== undefined && !current) ||
      (body.expenseId !== undefined && !legacy) ||
      (current && legacy && current !== legacy) ||
      (body.companyId !== undefined && !company)
    ) {
      return json({ error: "Invalid expense request." }, 400);
    }
    try {
      const response = await fetcher(rpcUrl.toString(), {
        method: "POST",
        headers: {
          authorization,
          apikey: configuration.anonKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_expense_id: current ?? legacy,
          p_company_id: company,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const status = [400, 401, 403, 404, 409, 429].includes(response.status)
          ? response.status
          : 503;
        return json(
          {
            error:
              status === 401 || status === 403
                ? "Accounting access denied."
                : "Accounting sync is unavailable. Try again.",
          },
          status
        );
      }
      const receipt: unknown = await response.json();
      if (
        !receipt ||
        typeof receipt !== "object" ||
        Array.isArray(receipt) ||
        !("status" in receipt) ||
        typeof receipt.status !== "string" ||
        ![
          "pending",
          "queued",
          "synced",
          "error",
          "needs_review",
          "not_required",
        ].includes(receipt.status)
      ) {
        return json(
          { error: "Accounting sync is unavailable. Try again." },
          503
        );
      }
      return json(receipt);
    } catch {
      return json({ error: "Accounting sync is unavailable. Try again." }, 503);
    }
  };
}
