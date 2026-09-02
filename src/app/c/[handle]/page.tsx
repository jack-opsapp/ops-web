import { redirect } from "next/navigation";

/** `/c/<handle>` has no content of its own — it is the sign-in door. */
export default async function HostedCustomerRoot({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  redirect(`/c/${handle}/signin`);
}
