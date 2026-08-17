import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.join(process.cwd(), "src");
const APPROVED_SDK_DIRECTORIES = [
  path.join(SOURCE_ROOT, "lib", "agent-control-plane", "mcp"),
  path.join(SOURCE_ROOT, "app", "mcp"),
];
const MCP_PACKAGE_PREFIX = ["@modelcontextprotocol", ""].join("/");
const FORBIDDEN_ZOD_SUBPATH = ["zod", "v4"].join("/");
const SDK_ADAPTER_PATH = path.join(
  SOURCE_ROOT,
  "lib",
  "agent-control-plane",
  "mcp",
  "sdk.ts",
);

type JsonRpcMessage = {
  id?: string | number;
  result?: unknown;
  [key: string]: unknown;
};

type ProbeTransport = {
  onmessage?: (message: JsonRpcMessage) => void;
  start(): Promise<void>;
  send(message: JsonRpcMessage): Promise<void>;
  close(): Promise<void>;
};

type ProbeServer = {
  registerTool(
    name: string,
    config: { inputSchema: unknown },
    handler: (args: { value: string }) => Promise<{
      content: Array<{ type: "text"; text: string }>;
    }>,
  ): unknown;
  connect(transport: ProbeTransport): Promise<void>;
  close(): Promise<void>;
};

type SdkAdapter = {
  McpServer: new (info: { name: string; version: string }) => ProbeServer;
  createMcpHandler: unknown;
  InMemoryTransport: {
    createLinkedPair(): [ProbeTransport, ProbeTransport];
  };
  mcpZod: {
    object(shape: Record<string, unknown>): unknown;
    string(): unknown;
  };
};

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(entryPath);
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [entryPath] : [];
    }),
  );

  return files.flat();
}

describe("MCP SDK dependency boundary", () => {
  it("loads the approved server symbols through the OPS adapter", async () => {
    const adapterUrl = pathToFileURL(SDK_ADAPTER_PATH).href;

    const adapter = await import(/* @vite-ignore */ adapterUrl);

    expect(adapter.McpServer).toBeTypeOf("function");
    expect(adapter.createMcpHandler).toBeTypeOf("function");
    expect(adapter.InMemoryTransport).toBeTypeOf("function");
    expect(adapter.mcpZod).toBeTypeOf("object");
  });

  it("keeps Zod 3 stable and isolates exact Zod 4 to MCP schemas", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies?.zod).toBe("^3.24.0");
    expect(packageJson.dependencies?.["zod-v4"]).toBe("npm:zod@4.2.0");

    const files = await sourceFiles(SOURCE_ROOT);
    const forbiddenImports: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, "utf8");
      if (contents.includes(FORBIDDEN_ZOD_SUBPATH)) {
        forbiddenImports.push(path.relative(process.cwd(), file));
      }
    }

    expect(forbiddenImports).toEqual([]);
  });

  it("marks the MCP SDK adapter as server-only", async () => {
    const contents = await readFile(SDK_ADAPTER_PATH, "utf8");

    expect(contents.trimStart().startsWith('import "server-only";')).toBe(true);
  });

  it("lists a registered Zod 4 tool with its real JSON input schema", async () => {
    const adapterUrl = pathToFileURL(SDK_ADAPTER_PATH).href;
    const loaded = (await import(/* @vite-ignore */ adapterUrl)) as Record<
      string,
      unknown
    >;

    if (
      typeof loaded.McpServer !== "function" ||
      typeof loaded.InMemoryTransport !== "function" ||
      typeof loaded.mcpZod !== "object" ||
      loaded.mcpZod === null
    ) {
      expect(loaded.InMemoryTransport).toBeTypeOf("function");
      expect(loaded.mcpZod).toBeTypeOf("object");
      return;
    }

    const adapter = loaded as unknown as SdkAdapter;
    const server = new adapter.McpServer({
      name: "ops-boundary-test",
      version: "1.0.0",
    });
    server.registerTool(
      "echo",
      {
        inputSchema: adapter.mcpZod.object({
          value: adapter.mcpZod.string(),
        }),
      },
      async ({ value }) => ({
        content: [{ type: "text", text: value }],
      }),
    );

    const [clientTransport, serverTransport] =
      adapter.InMemoryTransport.createLinkedPair();
    const pending = new Map<
      string | number,
      (message: JsonRpcMessage) => void
    >();
    clientTransport.onmessage = (message) => {
      if (message.id !== undefined) pending.get(message.id)?.(message);
    };

    const request = async (message: JsonRpcMessage) =>
      new Promise<JsonRpcMessage>((resolve, reject) => {
        if (message.id === undefined) {
          reject(new Error("Test request id is required"));
          return;
        }

        const timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for response ${message.id}`)),
          1_000,
        );
        pending.set(message.id, (response) => {
          clearTimeout(timeout);
          pending.delete(message.id as string | number);
          resolve(response);
        });
        void clientTransport.send(message).catch(reject);
      });

    await clientTransport.start();
    await server.connect(serverTransport);

    try {
      await request({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "ops-boundary-test", version: "1.0.0" },
        },
      });
      await clientTransport.send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      });

      const response = await request({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });

      expect(response.result).toEqual({
        tools: [
          {
            name: "echo",
            inputSchema: {
              type: "object",
              $schema: "https://json-schema.org/draft/2020-12/schema",
              properties: { value: { type: "string" } },
              required: ["value"],
            },
          },
        ],
      });
    } finally {
      await server.close();
      await clientTransport.close();
    }
  });

  it("keeps direct SDK imports inside the MCP transport boundary", async () => {
    const files = await sourceFiles(SOURCE_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      if (
        APPROVED_SDK_DIRECTORIES.some(
          (directory) => file === directory || file.startsWith(`${directory}${path.sep}`),
        )
      ) {
        continue;
      }

      const contents = await readFile(file, "utf8");
      if (contents.includes(MCP_PACKAGE_PREFIX)) {
        violations.push(path.relative(process.cwd(), file));
      }
    }

    expect(violations).toEqual([]);
  });
});
