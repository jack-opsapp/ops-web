import { redirect } from "next/navigation";

export default function Home() {
  // Root page redirects to dashboard (or login if not authenticated)
  redirect("/projects");
}
