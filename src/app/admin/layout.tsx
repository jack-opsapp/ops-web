import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { verifyFirebaseToken } from "@/lib/firebase/admin-verify";
import { isAdminEmail } from "@/lib/admin/admin-queries";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import {
  ADMIN_RETURN_TO_HEADER,
  LEGACY_SESSION_COOKIE_NAME,
  OPS_AUTH_COOKIE_NAME,
  selectFirebaseIdTokenCookie,
} from "@/lib/auth/firebase-id-token-cookie";
import { AdminSidebar } from "./_components/sidebar";
import { CompanySheetProvider } from "./_components/company-sheet-provider";
import { AdminQueryProvider } from "./_components/query-provider";

type AdminAccess =
  | { status: "authorized" }
  | { status: "unauthenticated"; returnTo: string }
  | { status: "forbidden" };

async function getAdminAccess(): Promise<AdminAccess> {
  const cookieStore = await cookies();
  const headersList = await headers();
  const returnTo = safeRedirectPath(
    headersList.get(ADMIN_RETURN_TO_HEADER),
    "/admin"
  );

  const token =
    headersList.get("authorization")?.replace("Bearer ", "") ||
    selectFirebaseIdTokenCookie(
      cookieStore.get(OPS_AUTH_COOKIE_NAME)?.value,
      cookieStore.get(LEGACY_SESSION_COOKIE_NAME)?.value
    );

  if (!token) return { status: "unauthenticated", returnTo };

  let user;
  try {
    user = await verifyFirebaseToken(token);
  } catch {
    return { status: "unauthenticated", returnTo };
  }

  if (!user.email || !(await isAdminEmail(user.email))) {
    return { status: "forbidden" };
  }

  return { status: "authorized" };
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await getAdminAccess();

  if (access.status === "unauthenticated") {
    const search = new URLSearchParams({ redirect: access.returnTo });
    redirect(`/login?${search.toString()}`);
  }

  if (access.status === "forbidden") {
    redirect("/dashboard");
  }

  return (
    <AdminQueryProvider>
      <CompanySheetProvider>
        <div className="flex min-h-screen bg-black">
          <AdminSidebar />
          <main className="min-w-0 flex-1 overflow-auto">{children}</main>
        </div>
      </CompanySheetProvider>
    </AdminQueryProvider>
  );
}
