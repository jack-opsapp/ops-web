import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type { TaxRate } from "@/lib/types/pipeline";
import { normalizeStoredTaxRate } from "@/lib/tax/estimate-tax";

function mapTaxRate(row: Record<string, unknown>): TaxRate {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    rate: normalizeStoredTaxRate(Number(row.rate)),
    isDefault: row.is_default === true,
    isActive: row.is_active !== false,
    createdAt: parseDate(row.created_at),
  };
}

export const TaxRateService = {
  async fetchActive(companyId: string): Promise<TaxRate[]> {
    const { data, error } = await requireSupabase()
      .from("tax_rates")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("name", { ascending: true });
    if (error) {
      throw new Error(`Failed to load tax rates: ${error.message}`);
    }
    return (data ?? []).map((row) =>
      mapTaxRate(row as Record<string, unknown>),
    );
  },
};
