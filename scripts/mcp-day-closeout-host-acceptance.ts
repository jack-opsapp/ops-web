import { runDayCloseoutHostAcceptance } from "../src/lib/agent-control-plane/mcp/host-acceptance";

async function main(): Promise<void> {
  const endpoint = process.env.OPS_MCP_ACCEPTANCE_ENDPOINT;
  const bearer = process.env.OPS_MCP_ACCEPTANCE_BEARER;
  const idempotencyKey = process.env.OPS_MCP_ACCEPTANCE_IDEMPOTENCY_KEY;
  if (!endpoint || !bearer || !idempotencyKey) {
    throw new Error("MCP host acceptance configuration is incomplete");
  }

  const summary = await runDayCloseoutHostAcceptance({
    endpoint,
    bearer,
    idempotencyKey,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "MCP host acceptance failed"}\n`
  );
  process.exitCode = 1;
});
