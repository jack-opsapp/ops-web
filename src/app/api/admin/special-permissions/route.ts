import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/firebase/admin-verify";
import { isAdminEmail } from "@/lib/admin/admin-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

async function requireAdmin(req: NextRequest) {
  const user = await verifyAdminAuth(req);
  if (!user || !user.email || !(await isAdminEmail(user.email))) {
    return null;
  }
  return user;
}

// GET — search users or companies, or list all distinct permissions in use
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminSupabase();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type"); // "users" | "companies" | "permissions"
  const q = searchParams.get("q")?.trim() ?? "";

  try {
    if (type === "permissions") {
      // Get all distinct permissions currently in use
      const { data, error } = await db
        .from("users")
        .select("special_permissions")
        .not("special_permissions", "eq", "{}");

      if (error) throw error;

      const allPerms = new Set<string>();
      for (const row of data ?? []) {
        for (const p of row.special_permissions ?? []) {
          allPerms.add(p);
        }
      }
      return NextResponse.json({ permissions: Array.from(allPerms).sort() });
    }

    if (type === "companies") {
      let query = db
        .from("companies")
        .select("id, name")
        .is("deleted_at", null)
        .order("name")
        .limit(20);

      if (q) {
        query = query.ilike("name", `%${q}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json({ companies: data ?? [] });
    }

    // Default: search users
    let query = db
      .from("users")
      .select("id, first_name, last_name, email, role, company_id, special_permissions")
      .is("deleted_at", null)
      .order("last_name")
      .limit(30);

    if (q) {
      query = query.or(
        `first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`
      );
    }

    const companyId = searchParams.get("company_id");
    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ users: data ?? [] });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Fetch failed" },
      { status: 500 }
    );
  }
}

// POST — add or remove a permission from a user or all users in a company
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminSupabase();
  const body = await req.json();
  const { action, permission, userId, companyId } = body as {
    action: "add" | "remove";
    permission: string;
    userId?: string;
    companyId?: string;
  };

  if (!action || !permission) {
    return NextResponse.json(
      { error: "Missing action or permission" },
      { status: 400 }
    );
  }

  if (!userId && !companyId) {
    return NextResponse.json(
      { error: "Must provide userId or companyId" },
      { status: 400 }
    );
  }

  try {
    if (userId) {
      // Single user update
      const { data: user, error: fetchErr } = await db
        .from("users")
        .select("special_permissions")
        .eq("id", userId)
        .single();

      if (fetchErr) throw fetchErr;

      const current: string[] = user.special_permissions ?? [];
      let updated: string[];

      if (action === "add") {
        updated = current.includes(permission)
          ? current
          : [...current, permission];
      } else {
        updated = current.filter((p: string) => p !== permission);
      }

      const { error: updateErr } = await db
        .from("users")
        .update({ special_permissions: updated })
        .eq("id", userId);

      if (updateErr) throw updateErr;

      return NextResponse.json({ success: true, updated, count: 1 });
    }

    // Company-wide update
    const { data: users, error: fetchErr } = await db
      .from("users")
      .select("id, special_permissions")
      .eq("company_id", companyId!)
      .is("deleted_at", null);

    if (fetchErr) throw fetchErr;

    let updateCount = 0;
    for (const user of users ?? []) {
      const current: string[] = user.special_permissions ?? [];
      let updated: string[];

      if (action === "add") {
        if (current.includes(permission)) continue;
        updated = [...current, permission];
      } else {
        if (!current.includes(permission)) continue;
        updated = current.filter((p: string) => p !== permission);
      }

      const { error } = await db
        .from("users")
        .update({ special_permissions: updated })
        .eq("id", user.id);

      if (error) throw error;
      updateCount++;
    }

    return NextResponse.json({ success: true, count: updateCount });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}
