import {
  DayCloseoutResultSchema,
  PrepareDayCloseoutInputSchema,
} from "@/lib/agent-control-plane/contracts/day-closeout";

const PROTOCOL_VERSION = "2025-03-26" as const;
const EXPECTED_TOOL = "prepare_day_closeout" as const;
const DEFAULT_TIMEOUT_MS = 30_000;

type AcceptanceFetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface DayCloseoutHostAcceptanceSummary {
  readonly protocolVersion: string;
  readonly toolNames: readonly [typeof EXPECTED_TOOL];
  readonly state: "clear" | "attention" | "partial";
  readonly findingCount: number;
  readonly filingKind: "not_required" | "approval_required";
  readonly completeComponents: number;
  readonly partialComponents: number;
}

function failure(stage: string): Error {
  return new Error(`MCP host acceptance failed at ${stage}`);
}

function parseEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw failure("configuration");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password
  ) {
    throw failure("configuration");
  }
  return url.toString();
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseRpcBody(raw: string, stage: string): Record<string, unknown> {
  const dataLine = raw.split(/\r?\n/u).find((line) => line.startsWith("data:"));
  const serialized = dataLine ? dataLine.slice(5).trim() : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw failure(stage);
  }
  const envelope = jsonObject(parsed);
  if (!envelope || envelope.jsonrpc !== "2.0" || envelope.error != null) {
    throw failure(stage);
  }
  return envelope;
}

async function rpc(
  input: {
    readonly endpoint: string;
    readonly bearer: string;
    readonly fetcher: AcceptanceFetcher;
    readonly timeoutMs: number;
  },
  stage: string,
  body: Readonly<Record<string, unknown>>
): Promise<unknown> {
  let response: Response;
  try {
    response = await input.fetcher(input.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.bearer}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch {
    throw failure(stage);
  }
  if (!response.ok) throw failure(stage);
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    throw failure(stage);
  }
  const envelope = parseRpcBody(raw, stage);
  if (envelope.id !== body.id || !("result" in envelope)) {
    throw failure(stage);
  }
  return envelope.result;
}

async function notify(
  input: {
    readonly endpoint: string;
    readonly bearer: string;
    readonly fetcher: AcceptanceFetcher;
    readonly timeoutMs: number;
  },
  stage: string,
  body: Readonly<Record<string, unknown>>
): Promise<void> {
  let response: Response;
  try {
    response = await input.fetcher(input.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.bearer}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch {
    throw failure(stage);
  }
  if (!response.ok) throw failure(stage);
}

export async function runDayCloseoutHostAcceptance(input: {
  readonly endpoint: string;
  readonly bearer: string;
  readonly idempotencyKey: string;
  readonly fetcher?: AcceptanceFetcher;
  readonly timeoutMs?: number;
}): Promise<DayCloseoutHostAcceptanceSummary> {
  const endpoint = parseEndpoint(input.endpoint);
  if (
    typeof input.bearer !== "string" ||
    input.bearer.trim() !== input.bearer ||
    input.bearer.length < 16 ||
    input.bearer.length > 4_096
  ) {
    throw failure("configuration");
  }
  const prepareInput = PrepareDayCloseoutInputSchema.safeParse({
    idempotency_key: input.idempotencyKey,
  });
  if (!prepareInput.success) throw failure("configuration");
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 120_000
  ) {
    throw failure("configuration");
  }
  const transport = {
    endpoint,
    bearer: input.bearer,
    fetcher: input.fetcher ?? fetch,
    timeoutMs,
  };

  const initialize = jsonObject(
    await rpc(transport, "initialize", {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "OPS host acceptance", version: "1.0.0" },
      },
    })
  );
  if (
    !initialize ||
    typeof initialize.protocolVersion !== "string" ||
    initialize.protocolVersion !== PROTOCOL_VERSION
  ) {
    throw failure("initialize");
  }

  await notify(transport, "notifications/initialized", {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });

  const listed = jsonObject(
    await rpc(transport, "tools/list", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    })
  );
  const tools = listed?.tools;
  if (!Array.isArray(tools) || tools.length !== 1) {
    throw failure("tools/list");
  }
  const tool = jsonObject(tools[0]);
  const annotations = jsonObject(tool?.annotations);
  if (
    tool?.name !== EXPECTED_TOOL ||
    annotations?.readOnlyHint !== false ||
    annotations.destructiveHint !== false ||
    annotations.idempotentHint !== true ||
    annotations.openWorldHint !== false
  ) {
    throw failure("tools/list");
  }

  const called = jsonObject(
    await rpc(transport, "tools/call", {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: EXPECTED_TOOL,
        arguments: prepareInput.data,
      },
    })
  );
  if (!called || called.isError === true || !Array.isArray(called.content)) {
    throw failure("tools/call");
  }
  const textBlocks = called.content
    .map(jsonObject)
    .filter(
      (block): block is Record<string, unknown> =>
        block !== null &&
        block.type === "text" &&
        typeof block.text === "string"
    );
  if (textBlocks.length !== 1) throw failure("tools/call");
  let resultValue: unknown;
  try {
    resultValue = JSON.parse(textBlocks[0]!.text as string);
  } catch {
    throw failure("tools/call");
  }
  const parsedResult = DayCloseoutResultSchema.safeParse(resultValue);
  if (!parsedResult.success) throw failure("tools/call");
  const result = parsedResult.data;
  const completeComponents = result.components.filter(
    ({ coverage }) => coverage.state === "complete"
  ).length;

  return Object.freeze({
    protocolVersion: initialize.protocolVersion,
    toolNames: Object.freeze([EXPECTED_TOOL]) as readonly [
      typeof EXPECTED_TOOL,
    ],
    state: result.state,
    findingCount: result.findings.length,
    filingKind: result.filing.kind,
    completeComponents,
    partialComponents: result.components.length - completeComponents,
  });
}
