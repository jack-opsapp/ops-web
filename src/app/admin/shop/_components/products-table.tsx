"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Archive, Star, StarOff, Eye } from "lucide-react";
import { StockBadge } from "./stock-badge";
import { Toggle } from "./toggle";
import { formatCents } from "./format-cents";
import type { ShopProductListItem } from "@/lib/admin/shop-types";

type SortKey = "name" | "categoryName" | "priceCents" | "variantCount" | "totalStock" | "createdAt";
type SortDir = "asc" | "desc";

interface ProductsTableProps {
  products: ShopProductListItem[];
  categories: { id: string; name: string }[];
  lowStockCount: number;
}

export function ProductsTable({ products, categories, lowStockCount }: ProductsTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">("active");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let list = products;

    // Status filter
    if (statusFilter === "active") list = list.filter((p) => !p.archivedAt && p.isActive);
    else if (statusFilter === "archived") list = list.filter((p) => !!p.archivedAt);

    // Category filter
    if (categoryFilter !== "ALL") list = list.filter((p) => p.categoryId === categoryFilter);

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }

    // Sort
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [products, search, categoryFilter, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
  }

  async function bulkAction(action: "archive" | "activate" | "feature" | "unfeature") {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const res = await fetch("/api/admin/shop/products/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, productIds: ids }),
    });
    if (!res.ok) return;
    setSelected(new Set());
    router.refresh();
  }

  async function toggleFeatured(id: string, current: boolean) {
    const res = await fetch(`/api/admin/shop/products/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFeatured: !current }),
    });
    if (!res.ok) return;
    router.refresh();
  }

  const SortHeader = ({ label, sortKeyName, width }: { label: string; sortKeyName: SortKey; width: string }) => (
    <th
      className={`${width} px-4 py-3 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] cursor-pointer select-none hover:text-[#A0A0A0] transition-colors`}
      onClick={() => toggleSort(sortKeyName)}
    >
      {label} {sortKey === sortKeyName ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>
  );

  return (
    <div>
      {/* Low stock alert */}
      {lowStockCount > 0 && (
        <div className="mb-4 px-4 py-2 border border-amber-500/20 rounded-sm bg-amber-500/5">
          <span className="font-mohave text-[13px] text-amber-400">
            {lowStockCount} variant{lowStockCount !== 1 ? "s" : ""} low on stock
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-xs bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:border-[#597794] focus:outline-none"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
        >
          <option value="ALL">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <div className="flex items-center border border-white/[0.08] rounded-sm overflow-hidden">
          {(["active", "archived", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 font-kosugi text-[11px] uppercase tracking-widest transition-colors ${
                statusFilter === s
                  ? "bg-white/[0.08] text-[#E5E5E5]"
                  : "text-[#6B6B6B] hover:text-[#A0A0A0]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Link
          href="/admin/shop/products/new"
          className="flex items-center gap-2 bg-[#597794] text-white font-kosugi text-[11px] uppercase tracking-widest px-4 py-2 rounded-sm hover:bg-[#597794]/80 transition-colors"
        >
          <Plus size={14} />
          Add Product
        </Link>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2 border border-[#597794]/30 rounded-sm bg-[#597794]/5">
          <span className="font-mohave text-[13px] text-[#E5E5E5]">{selected.size} selected</span>
          <div className="flex-1" />
          <button onClick={() => bulkAction("feature")} className="flex items-center gap-1.5 px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#E5E5E5] border border-white/[0.12] rounded-sm hover:bg-white/[0.04] transition-colors">
            <Star size={12} /> Feature
          </button>
          <button onClick={() => bulkAction("unfeature")} className="flex items-center gap-1.5 px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] border border-white/[0.12] rounded-sm hover:bg-white/[0.04] transition-colors">
            <StarOff size={12} /> Unfeature
          </button>
          <button onClick={() => bulkAction("activate")} className="flex items-center gap-1.5 px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#E5E5E5] border border-white/[0.12] rounded-sm hover:bg-white/[0.04] transition-colors">
            <Eye size={12} /> Activate
          </button>
          <button onClick={() => bulkAction("archive")} className="flex items-center gap-1.5 px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-widest text-red-400 border border-red-500/20 rounded-sm hover:bg-red-500/5 transition-colors">
            <Archive size={12} /> Archive
          </button>
        </div>
      )}

      {/* Table */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/[0.08]">
            <th className="w-[40px] px-4 py-3">
              <input
                type="checkbox"
                checked={selected.size === filtered.length && filtered.length > 0}
                onChange={toggleAll}
                className="accent-[#597794]"
              />
            </th>
            <th className="w-[48px] px-2 py-3" />
            <SortHeader label="Name" sortKeyName="name" width="flex-1" />
            <SortHeader label="Category" sortKeyName="categoryName" width="w-[120px]" />
            <SortHeader label="Price" sortKeyName="priceCents" width="w-[100px]" />
            <SortHeader label="Variants" sortKeyName="variantCount" width="w-[80px]" />
            <SortHeader label="Stock" sortKeyName="totalStock" width="w-[120px]" />
            <th className="w-[80px] px-4 py-3 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]">
              Featured
            </th>
            <th className="w-[100px] px-4 py-3 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => {
            const available = p.totalStock - p.totalReserved;
            return (
              <tr
                key={p.id}
                className="border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors"
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggleSelect(p.id)}
                    className="accent-[#597794]"
                  />
                </td>
                <td className="px-2 py-3">
                  {p.images[0] ? (
                    <img
                      src={p.images[0]}
                      alt=""
                      className="w-10 h-10 object-cover rounded-sm border border-white/[0.08]"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-sm bg-white/[0.04] border border-white/[0.08]" />
                  )}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/shop/products/${p.id}`}
                    className="font-mohave text-[13px] text-[#E5E5E5] hover:text-[#597794] transition-colors"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 bg-white/[0.05] rounded-sm font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B]">
                    {p.categoryName}
                  </span>
                </td>
                <td className="px-4 py-3 font-mohave text-[13px] text-[#E5E5E5]">
                  {formatCents(p.priceCents)}
                </td>
                <td className="px-4 py-3 font-mohave text-[13px] text-[#6B6B6B]">
                  {p.variantCount}
                </td>
                <td className="px-4 py-3">
                  <StockBadge available={available} total={p.totalStock} />
                </td>
                <td className="px-4 py-3">
                  <Toggle checked={p.isFeatured} onChange={() => toggleFeatured(p.id, p.isFeatured)} />
                </td>
                <td className="px-4 py-3">
                  {p.archivedAt ? (
                    <span className="px-2 py-0.5 bg-white/[0.05] rounded-sm font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B]">
                      Archived
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-[#597794]/20 rounded-sm font-kosugi text-[10px] uppercase tracking-widest text-[#597794]">
                      Active
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-12 text-center font-mohave text-[13px] text-[#6B6B6B]">
                No products found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
