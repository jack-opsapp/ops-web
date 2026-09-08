import { NextRequest, NextResponse } from "next/server";
import { z } from "zod-v4";
import { authenticateRequest, isErrorResponse } from "../_lib/auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { FinancialPolicyService } from "@/lib/agent-control-plane/services/financial-policy/financial-policy-service";
export const dynamic = "force-dynamic";
async function handle(request: NextRequest, mutate: boolean) {
  try {
    const auth = await authenticateRequest(request);
    if (isErrorResponse(auth)) return auth;
    const client = getServiceRoleClient();
    const service = new FinancialPolicyService((name, args) =>
      client.rpc(name, args)
    );
    const identity = { actorId: auth.id, companyId: auth.companyId };
    const data = mutate
      ? await service.decide(identity, await readBody(request))
      : await service.readiness(
          identity,
          request.nextUrl.searchParams.get("source") ?? undefined
        );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const code =
      error instanceof z.ZodError
        ? "FINANCIAL_POLICY_INPUT_INVALID"
        : error instanceof Error &&
            /^FINANCIAL_POLICY_[A-Z_]+$/.test(error.message)
          ? error.message
          : "FINANCIAL_POLICY_UNAVAILABLE";
    const status = /OWNER_REQUIRED|PERMISSION_DENIED/.test(code)
      ? 403
      : /INPUT_INVALID/.test(code)
        ? 400
        : 409;
    return NextResponse.json(
      { error: code },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }
}
async function readBody(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("FINANCIAL_POLICY_INPUT_INVALID");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) {
        await reader.cancel();
        throw new Error("FINANCIAL_POLICY_INPUT_INVALID");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new Error("FINANCIAL_POLICY_INPUT_INVALID");
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
