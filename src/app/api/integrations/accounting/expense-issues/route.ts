import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveSupplierBillActor } from "@/lib/accounting/supplier-bills/route-auth";
import { loadExpenseAccountingIssues } from "@/lib/accounting/expenses/review-service";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

const permissions = ["accounting.manage_connections", "expenses.approve"];
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: NextRequest) {
  const actor = await resolveSupplierBillActor(request, permissions);
  if (actor instanceof NextResponse) return actor;
  const parsed = z
    .object({
      connectionId: z.string().uuid(),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .safeParse({
      connectionId: request.nextUrl.searchParams.get("connectionId"),
      offset: request.nextUrl.searchParams.get("offset") ?? 0,
    });
  if (!parsed.success)
    return response({ error: "Choose an accounting connection." }, 400);
  try {
    return response(
      await loadExpenseAccountingIssues(
        getServiceRoleClient(),
        actor.companyId,
        parsed.data.connectionId,
        parsed.data.offset
      )
    );
  } catch {
    return response(
      { error: "Expense sync issues could not load. Try again." },
      503
    );
  }
}

export async function POST(request: NextRequest) {
  const actor = await resolveSupplierBillActor(request, permissions);
  if (actor instanceof NextResponse) return actor;
  const parsed = z
    .object({ queueId: z.string().uuid() })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return response({ error: "Choose an expense to retry." }, 400);
  try {
    const { data, error } = await getServiceRoleClient().rpc(
      "retry_expense_accounting_before_write",
      {
        p_actor_user_id: actor.actorUserId,
        p_queue_id: parsed.data.queueId,
      }
    );
    if (error)
      return response(
        {
          error:
            "This expense cannot be retried. Refresh its accounting status.",
        },
        error.code === "42501" ? 403 : 409
      );
    if (
      !data ||
      data.queueId !== parsed.data.queueId ||
      !["pending", "cancelled"].includes(data.status)
    )
      return response(
        {
          error:
            "The retry could not be confirmed. Refresh its accounting status.",
        },
        503
      );
    return response(data);
  } catch {
    return response(
      {
        error:
          "The retry could not be confirmed. Refresh its accounting status.",
      },
      503
    );
  }
}
