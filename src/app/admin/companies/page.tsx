import { getCompanyList } from "@/lib/admin/admin-queries";
import { listAllAuthUsers } from "@/lib/firebase/admin-sdk";
import { AdminPageHeader } from "../_components/admin-page-header";
import { CompaniesTable } from "./_components/companies-table";

async function fetchCompanies() {
  const [companies, authUsers] = await Promise.all([
    getCompanyList(),
    listAllAuthUsers(),
  ]);

  // Build email → lastSignIn map from Firebase
  const lastSignInByEmail: Record<string, string> = {};
  for (const u of authUsers) {
    if (u.email && u.metadata.lastSignInTime) {
      lastSignInByEmail[u.email] = u.metadata.lastSignInTime;
    }
  }

  // We need user emails per company to find lastActive
  // Since getCompanyList doesn't fetch user emails, we'll use the authUsers
  // grouped by company via a separate query
  const db = (await import("@/lib/supabase/admin-client")).getAdminSupabase();
  const { data: users } = await db
    .from("users")
    .select("company_id, email")
    .is("deleted_at", null);

  const companyLastActive: Record<string, string> = {};
  for (const u of users ?? []) {
    if (!u.email || !u.company_id) continue;
    const lastSign = lastSignInByEmail[u.email];
    if (!lastSign) continue;
    if (!companyLastActive[u.company_id] || new Date(lastSign) > new Date(companyLastActive[u.company_id])) {
      companyLastActive[u.company_id] = lastSign;
    }
  }

  return companies.map((c) => ({
    ...c,
    lastActive: companyLastActive[c.id] ?? null,
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
