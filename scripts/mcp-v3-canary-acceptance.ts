import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createClient } from "@supabase/supabase-js";

import {
  runMcpV3CanaryAcceptance,
  type CanaryAcceptanceRpcClient,
} from "../src/lib/agent-control-plane/mcp/canary-acceptance";

const execFileAsync = promisify(execFile);
const PRODUCTION_ISSUER = "https://app.opsapp.co";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) {
    throw new Error("MCP canary acceptance configuration is incomplete");
  }
  return value;
}

async function main(): Promise<void> {
  const issuer = requiredEnvironment("OPS_MCP_CANARY_ISSUER");
  if (issuer !== PRODUCTION_ISSUER) {
    throw new Error("MCP canary acceptance requires the production issuer");
  }

  let supabase;
  try {
    supabase = createClient(
      requiredEnvironment("OPS_MCP_CANARY_SUPABASE_URL"),
      requiredEnvironment("OPS_MCP_CANARY_SERVICE_ROLE_KEY"),
      {
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );
  } catch {
    throw new Error("MCP canary acceptance configuration is incomplete");
  }
  const rpcClient: CanaryAcceptanceRpcClient = {
    async rpc(functionName, args) {
      const { data, error } = await supabase.rpc(
        functionName as never,
        args as never
      );
      return { data, error };
    },
  };
  const openPrivately = async (url: URL, signal?: AbortSignal) => {
    await execFileAsync("/usr/bin/open", [url.toString()], {
      windowsHide: true,
      signal,
    });
  };

  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);

  let summary;
  try {
    summary = await runMcpV3CanaryAcceptance(
      {
        rpcClient,
        issuer,
        userId: requiredEnvironment("OPS_MCP_CANARY_USER_ID"),
        companyId: requiredEnvironment("OPS_MCP_CANARY_COMPANY_ID"),
      },
      {
        signal: controller.signal,
        onProgress(stage) {
          if (stage === "waiting_for_consent") {
            process.stdout.write("CANARY CONSENT :: APPROVE IN BROWSER\n");
          } else if (stage === "waiting_for_filing") {
            process.stdout.write("CANARY REVIEW :: FILE CLOSEOUT IN OPS\n");
          } else {
            process.stdout.write("CANARY ROUTINE :: ENABLE IN OPS\n");
          }
        },
        openAuthorization: openPrivately,
        openOperatorSurface: openPrivately,
      }
    );
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "MCP canary acceptance failed"}\n`
  );
  process.exitCode = 1;
});
