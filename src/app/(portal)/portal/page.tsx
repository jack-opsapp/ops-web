import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function PortalIndexPage() {
  const cookieStore = await cookies();
  const portalSession = cookieStore.get("ops-portal-session")?.value;

  if (portalSession) {
    redirect("/portal/home");
  }

  redirect("/portal/verify");
}
