import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { verifyFirebaseToken } from "@/lib/firebase/admin-verify";
import { AdminSidebar } from "./_components/sidebar";
import { CompanySheetProvider } from "./_components/company-sheet-provider";

const ADMIN_EMAIL = "jack@opsapp.co";

async function getAdminUser() {
  const cookieStore = await cookies();
  const headersList = await headers();

  const token =
    headersList.get("authorization")?.replace("Bearer ", "") ||
    cookieStore.get("__session")?.value ||
    cookieStore.get("ops-auth-token")?.value;

  if (!token) return null;

  try {
    const user = await verifyFirebaseToken(token);
    if (user.email !== ADMIN_EMAIL) return null;
    return user;
  } catch {
    return null;
  }
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAdminUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <CompanySheetProvider>
      <div className="flex min-h-screen bg-[#0D0D0D]">
        <AdminSidebar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </CompanySheetProvider>
  );
}
