import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { updateShopCategory, deleteShopCategory } from "@/lib/admin/shop-queries";

export const PUT = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const segments = req.nextUrl.pathname.split("/");
  const id = segments[segments.indexOf("categories") + 1];
  const body = await req.json();

  try {
    await updateShopCategory(id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
});

export const DELETE = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const segments = req.nextUrl.pathname.split("/");
  const id = segments[segments.indexOf("categories") + 1];

  try {
    await deleteShopCategory(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
});
