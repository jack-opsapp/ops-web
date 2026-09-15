import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveSupplierBillActor } from "@/lib/accounting/supplier-bills/route-auth";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  expenseAccountingConnection,
  expenseCatalogueBinding,
  expenseSettingsRequestSchema,
  loadExpenseCatalogue,
  loadExpenseProjectSettings,
  validateExpenseSettingsSelection,
} from "@/lib/accounting/expenses/configuration-service";

const permissions = ["accounting.manage_connections", "expenses.approve"];
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: NextRequest) {
  const actor = await resolveSupplierBillActor(request, permissions);
  if (actor instanceof NextResponse) return actor;
  const connectionId = request.nextUrl.searchParams.get("connectionId");
  if (!z.string().uuid().safeParse(connectionId).success)
    return response({ error: "Choose an accounting connection." }, 400);
  try {
    const db = getServiceRoleClient();
    const connection = await expenseAccountingConnection(
      db,
      actor.companyId,
      connectionId!
    );
    const [
      settings,
      categories,
      crew,
      categoryMappings,
      payeeMappings,
      taxMappings,
      catalogue,
      projectSettings,
    ] = await Promise.all([
      db
        .from("expense_accounting_settings")
        .select("configuration")
        .eq("company_id", actor.companyId)
        .eq("connection_id", connectionId!)
        .maybeSingle(),
      db
        .from("expense_categories")
        .select("id,name")
        .eq("company_id", actor.companyId)
        .order("name"),
      db
        .from("users")
        .select("id,first_name,last_name,email,is_active,deleted_at")
        .eq("company_id", actor.companyId)
        .order("first_name"),
      db
        .from("expense_accounting_category_mappings")
        .select("category_id,external_account_id")
        .eq("company_id", actor.companyId)
        .eq("connection_id", connectionId!),
      db
        .from("expense_accounting_payee_mappings")
        .select("user_id,external_employee_id")
        .eq("company_id", actor.companyId)
        .eq("connection_id", connectionId!),
      db
        .from("expense_accounting_tax_mappings")
        .select("tax_rate,external_tax_code_id")
        .eq("company_id", actor.companyId)
        .eq("connection_id", connectionId!),
      loadExpenseCatalogue(db, connection),
      loadExpenseProjectSettings(db, actor.companyId, connectionId!),
    ]);
    for (const result of [
      settings,
      categories,
      crew,
      categoryMappings,
      payeeMappings,
      taxMappings,
    ])
      if (result.error) throw result.error;
    const configuration = settings.data?.configuration ?? null;
    const mappedUsers = new Set(
      (payeeMappings.data ?? []).map((row) => row.user_id)
    );
    const mappedEmployees = new Set(
      (payeeMappings.data ?? []).map((row) => row.external_employee_id)
    );
    return response({
      connectionId,
      catalogueBinding: expenseCatalogueBinding(connection),
      provider: connection.provider,
      configuration,
      recommendedCurrency: configuration?.currency ?? null,
      recommendedCountryCode: configuration?.countryCode ?? null,
      categories: categories.data ?? [],
      crew: (crew.data ?? [])
        .filter(
          (user) =>
            (user.is_active === true && !user.deleted_at) ||
            mappedUsers.has(user.id)
        )
        .map((user) => ({
          id: user.id,
          archived: user.is_active !== true || Boolean(user.deleted_at),
          name:
            [user.first_name, user.last_name].filter(Boolean).join(" ") ||
            user.email ||
            "",
        }))
        .filter((user) => user.name),
      categoryMappings: (categoryMappings.data ?? []).map((row) => ({
        categoryId: row.category_id,
        externalAccountId: row.external_account_id,
      })),
      payeeMappings: (payeeMappings.data ?? []).map((row) => ({
        userId: row.user_id,
        externalEmployeeId: row.external_employee_id,
      })),
      taxMappings: (taxMappings.data ?? []).map((row) => ({
        taxRate: Number(row.tax_rate),
        externalTaxCodeId: row.external_tax_code_id,
      })),
      ...catalogue,
      ...projectSettings,
      preservedProjects: (catalogue.preservedProjects ?? []).filter((project) =>
        projectSettings.projectMappings.some(
          (mapping) => mapping.externalProjectId === project.id
        )
      ),
      preservedEmployees: (catalogue.preservedEmployees ?? []).filter(
        (employee) => mappedEmployees.has(employee.id)
      ),
    });
  } catch {
    return response(
      {
        error:
          "Expense accounting settings are unavailable. Check the connection and try again.",
      },
      503
    );
  }
}

export async function POST(request: NextRequest) {
  const actor = await resolveSupplierBillActor(request, permissions);
  if (actor instanceof NextResponse) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response({ error: "Invalid expense accounting settings." }, 400);
  }
  const parsed = expenseSettingsRequestSchema.safeParse(body);
  if (!parsed.success)
    return response(
      { error: "Complete the expense accounting selections." },
      400
    );
  try {
    const db = getServiceRoleClient();
    const connection = await expenseAccountingConnection(
      db,
      actor.companyId,
      parsed.data.connectionId
    );
    if (parsed.data.catalogueBinding !== expenseCatalogueBinding(connection))
      return response(
        {
          error:
            "The accounting connection changed. Reload the settings before saving.",
        },
        409
      );
    const [catalogue, preserved, preservedProjects] = await Promise.all([
      loadExpenseCatalogue(db, connection),
      db
        .from("expense_accounting_payee_mappings")
        .select("user_id,external_employee_id")
        .eq("company_id", actor.companyId)
        .eq("connection_id", parsed.data.connectionId),
      db
        .from("expense_accounting_project_mappings")
        .select("project_id,external_project_id")
        .eq("company_id", actor.companyId)
        .eq("connection_id", parsed.data.connectionId),
    ]);
    if (preserved.error) throw preserved.error;
    if (preservedProjects.error) throw preservedProjects.error;
    // Only a stored exact assignment may survive an unavailable provider employee.
    // This never makes that employee selectable for another crew member.
    const preservedPayees = (preserved.data ?? []).map((row) => ({
      userId: String(row.user_id),
      externalEmployeeId: String(row.external_employee_id),
    }));
    try {
      validateExpenseSettingsSelection(
        parsed.data,
        String(connection.provider),
        catalogue,
        preservedPayees,
        (preservedProjects.data ?? []).map((row) => ({
          projectId: String(row.project_id),
          externalProjectId: String(row.external_project_id),
        }))
      );
    } catch (error) {
      return response(
        {
          error:
            error instanceof Error
              ? error.message
              : "Check the expense accounting selections.",
        },
        400
      );
    }
    const { error } = await db.rpc("save_expense_accounting_settings", {
      p_actor_user_id: actor.actorUserId,
      p_connection_id: parsed.data.connectionId,
      p_configuration: parsed.data.configuration,
      p_category_mappings: parsed.data.categoryMappings,
      p_payee_mappings: parsed.data.payeeMappings,
      p_tax_mappings: parsed.data.taxMappings ?? null,
      p_project_mappings: parsed.data.projectMappings ?? null,
      p_expected_provider: connection.provider,
      p_expected_environment: connection.provider_environment,
      p_expected_identity:
        connection.provider === "quickbooks"
          ? connection.realm_id_lookup
          : connection.sage_business_id_lookup,
    });
    if (error)
      return response(
        {
          error:
            "Expense accounting settings could not be saved. Refresh and try again.",
        },
        error.code === "42501" ? 403 : 409
      );
    return response({ saved: true });
  } catch {
    return response(
      {
        error:
          "Accounting account choices are unavailable. Check the connection and try again.",
      },
      503
    );
  }
}
