"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { OrderStatusBadge } from "./order-status-badge";
import { formatCents } from "../../_components/format-cents";
import type { ShopOrder } from "@/lib/admin/shop-types";

type SortKey = "orderNumber" | "createdAt" | "email" | "totalCents" | "status";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "pending" | "paid" | "shipped" | "delivered" | "cancelled" | "refunded";

interface OrdersTableProps {
  orders: ShopOrder[];
  orderItemCounts: Record<string, { count: number; firstItem: string }>;
}

export function OrdersTable({ orders, orderItemCounts }: OrdersTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    let list = orders;

    if (statusFilter !== "all") list = list.filter((o) => o.status === statusFilter);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.email.toLowerCase().includes(q)
      );
    }

    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "string" ? (av ?? "").localeCompare((bv as string) ?? "") : ((av as number) ?? 0) - ((bv as number) ?? 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [orders, search, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const statuses: StatusFilter[] = ["all", "pending", "paid", "shipped", "delivered", "cancelled", "refunded"];

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search order # or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-xs bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:border-[#597794] focus:outline-none"
        />
        <div className="flex items-center border border-white/[0.08] rounded-sm overflow-hidden">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-2 font-mono text-micro uppercase tracking-widest transition-colors ${
                statusFilter === s
                  ? "bg-white/[0.08] text-[#E5E5E5]"
                  : "text-[#6B6B6B] hover:text-[#A0A0A0]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/[0.08]">
            {([
              ["Order #", "orderNumber", "w-[120px]"],
              ["Date", "createdAt", "w-[140px]"],
              ["Customer", "email", ""],
              ["Items", "", "w-[200px]"],
              ["Total", "totalCents", "w-[100px]"],
              ["Status", "status", "w-[120px]"],
              ["Tracking", "", "w-[140px]"],
            ] as [string, SortKey | "", string][]).map(([label, key, width]) => (
              <th
                key={label}
                className={`${width} px-4 py-3 text-left font-mono text-[11px] uppercase tracking-widest text-[#6B6B6B] ${
                  key ? "cursor-pointer select-none hover:text-[#A0A0A0] transition-colors" : ""
                }`}
                onClick={() => key && toggleSort(key as SortKey)}
              >
                {label} {key && sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((o) => {
            const itemInfo = orderItemCounts[o.id];
            return (
              <tr key={o.id} className="border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/shop/orders/${o.id}`}
                    className="font-mohave text-[13px] text-[#597794] hover:underline"
                  >
                    {o.orderNumber}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mohave text-[13px] text-[#E5E5E5]">
                  {new Date(o.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>
                <td className="px-4 py-3 font-mohave text-[13px] text-[#E5E5E5]">{o.email}</td>
                <td className="px-4 py-3 font-mohave text-[12px] text-[#6B6B6B] truncate max-w-[200px]">
                  {itemInfo ? `${itemInfo.count} item${itemInfo.count !== 1 ? "s" : ""} — ${itemInfo.firstItem}` : "—"}
                </td>
                <td className="px-4 py-3 font-mohave text-[13px] text-[#E5E5E5]">
                  {formatCents(o.totalCents)}
                </td>
                <td className="px-4 py-3">
                  <OrderStatusBadge status={o.status} />
                </td>
                <td className="px-4 py-3 font-mohave text-[12px]">
                  {o.trackingUrl ? (
                    <a
                      href={o.trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#597794] hover:underline"
                    >
                      {o.trackingNumber}
                    </a>
                  ) : o.trackingNumber ? (
                    <span className="text-[#6B6B6B]">{o.trackingNumber}</span>
                  ) : (
                    <span className="text-[#6B6B6B]/50">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-12 text-center font-mohave text-[13px] text-[#6B6B6B]">
                No orders found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
