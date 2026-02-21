import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { AdminPageHeader } from "../_components/admin-page-header";
import { CompaniesTable } from "./_components/companies-table";

async function fetchCompanies() {
  const db = getAdminSupabase();

  const { data: companies } = await db
    .from("companies")
    .select(`
      id, name, subscription_plan, subscription_status, created_at,
      seated_employee_ids, max_seats
    `)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (!companies) return [];

  // Fetch user and project counts per company in parallel
  const counts = await Promise.all(
    companies.map(async (c) => {
      const [{ count: userCount }, { count: projectCount }] = await Promise.all([
        db.from("users").select("*", { count: "exact", head: true })
          .eq("company_id", c.id).is("deleted_at", null),
        db.from("projects").select("*", { count: "exact", head: true })
          .eq("company_id", c.id).is("deleted_at", null),
      ]);
      return { id: c.id, userCount: userCount ?? 0, projectCount: projectCount ?? 0 };
    })
  );

  const countsById = Object.fromEntries(counts.map((c) => [c.id, c]));

  return companies.map((c) => ({
    ...c,
    userCount: countsById[c.id]?.userCount ?? 0,
    projectCount: countsById[c.id]?.projectCount ?? 0,
  }));
}

export default async function CompaniesPage() {
  let companies;
  try {
    companies = await fetchCompanies();
  } catch (err: unknown) {
    return (
      <div className="p-8">
        <h1 className="text-red-400 font-mohave text-lg mb-4">Companies Fetch Failed</h1>
        <pre className="text-[13px] text-[#E5E5E5] bg-white/[0.05] rounded p-4 whitespace-pre-wrap">
          {err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="Companies"
        caption={`${companies.length} total`}
      />
      <div className="p-8">
        <CompaniesTable companies={companies} />
      </div>
    </div>
  );
}
