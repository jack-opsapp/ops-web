import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { createShopCategory, reorderShopCategories } from "@/lib/admin/shop-queries";

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const { name, slug } = await req.json();

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  try {
    const category = await createShopCategory(name, slug);
    return NextResponse.json(category);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
});

export const PUT = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const { orderedIds } = await req.json();

  try {
    await reorderShopCategories(orderedIds);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
});
