"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { centsToDecimal } from "../../_components/format-cents";
import type { ShopShippingMethod } from "@/lib/admin/shop-types";

interface ShippingTableProps {
  methods: ShopShippingMethod[];
}

function InlineEdit({
  value,
  onSave,
  type = "text",
  prefix,
}: {
  value: string;
  onSave: (val: string) => void;
  type?: "text" | "number";
  prefix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(value); setEditing(true); }}
        className="font-mohave text-[13px] text-[#E5E5E5] hover:text-[#597794] transition-colors text-left"
      >
        {prefix}{value || <span className="text-[#6B6B6B]/50">—</span>}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {prefix && <span className="font-mohave text-[12px] text-[#6B6B6B]">{prefix}</span>}
      <input
        type={type}
        step={type === "number" ? "0.01" : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onSave(draft); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onSave(draft); setEditing(false); }
          if (e.key === "Escape") setEditing(false);
        }}
        autoFocus
        className="w-full bg-white/[0.04] border border-[#597794] rounded-sm px-2 py-1 font-mohave text-[13px] text-[#E5E5E5] focus:outline-none"
      />
    </div>
  );
}

export function ShippingTable({ methods }: ShippingTableProps) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newThreshold, setNewThreshold] = useState("");

  async function updateField(id: string, field: string, value: unknown) {
    await fetch(`/api/admin/shop/shipping/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    router.refresh();
  }

  async function toggleActive(id: string, current: boolean) {
    await updateField(id, "isActive", !current);
  }

  async function deleteMethod(id: string) {
    if (!confirm("Delete this shipping method?")) return;
    const res = await fetch(`/api/admin/shop/shipping/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error);
      return;
    }
    router.refresh();
  }

  async function addMethod() {
    if (!newName.trim()) return;
    await fetch("/api/admin/shop/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        description: newDesc.trim() || null,
        priceCents: Math.round(parseFloat(newPrice || "0") * 100),
        minOrderCents: newThreshold ? Math.round(parseFloat(newThreshold) * 100) : null,
        isActive: true,
      }),
    });
    setNewName("");
    setNewDesc("");
    setNewPrice("");
    setNewThreshold("");
    setAdding(false);
    router.refresh();
  }

  return (
    <div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/[0.08]">
            {["Name", "Description", "Price", "Free Threshold", "Active", ""].map((label) => (
              <th
                key={label}
                className="px-4 py-3 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {methods.map((m) => (
            <tr key={m.id} className="border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors">
              <td className="px-4 py-3">
                <InlineEdit
                  value={m.name}
                  onSave={(v) => updateField(m.id, "name", v)}
                />
              </td>
              <td className="px-4 py-3">
                <InlineEdit
                  value={m.description ?? ""}
                  onSave={(v) => updateField(m.id, "description", v)}
                />
              </td>
              <td className="px-4 py-3">
                <InlineEdit
                  value={centsToDecimal(m.priceCents)}
                  onSave={(v) => updateField(m.id, "priceCents", Math.round(parseFloat(v || "0") * 100))}
                  type="number"
                  prefix="$"
                />
              </td>
              <td className="px-4 py-3">
                <InlineEdit
                  value={m.minOrderCents ? centsToDecimal(m.minOrderCents) : ""}
                  onSave={(v) => updateField(m.id, "minOrderCents", v ? Math.round(parseFloat(v) * 100) : null)}
                  type="number"
                  prefix="$"
                />
              </td>
              <td className="px-4 py-3">
                <Switch checked={m.isActive} onCheckedChange={() => toggleActive(m.id, m.isActive)} />
              </td>
              <td className="px-4 py-3">
                <button
                  onClick={() => deleteMethod(m.id)}
                  className="p-1.5 rounded-sm text-[#6B6B6B] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
          {methods.length === 0 && !adding && (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center font-mohave text-[13px] text-[#6B6B6B]">
                No shipping methods configured
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {adding ? (
        <div className="mt-4 border border-white/[0.08] rounded-sm p-4">
          <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
            New Shipping Method
          </p>
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div>
              <label className="block font-kosugi text-micro uppercase tracking-widest text-[#6B6B6B] mb-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-kosugi text-micro uppercase tracking-widest text-[#6B6B6B] mb-1">Description</label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-kosugi text-micro uppercase tracking-widest text-[#6B6B6B] mb-1">Price ($)</label>
              <input
                type="number"
                step="0.01"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-kosugi text-micro uppercase tracking-widest text-[#6B6B6B] mb-1">Free Above ($)</label>
              <input
                type="number"
                step="0.01"
                value={newThreshold}
                onChange={(e) => setNewThreshold(e.target.value)}
                placeholder="Optional"
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:border-[#597794] focus:outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={addMethod}
              disabled={!newName.trim()}
              className="px-4 py-1.5 bg-ops-accent rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-white hover:bg-ops-accent/80 transition-colors disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => setAdding(false)}
              className="px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-4 flex items-center gap-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
        >
          <Plus size={14} /> Add Shipping Method
        </button>
      )}
    </div>
  );
}
