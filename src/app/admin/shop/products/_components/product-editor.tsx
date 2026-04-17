"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Archive, Trash2 } from "lucide-react";
import Link from "next/link";
import { ImageUploader } from "./image-uploader";
import { OptionManager, type EditorOption } from "./option-manager";
import { VariantMatrix, type EditorVariant } from "./variant-matrix";
import { Switch } from "@/components/ui/switch";
import { centsToDecimal } from "../../_components/format-cents";
import type {
  ShopProduct,
  ShopCategory,
  ShopProductOption,
  ShopVariant,
} from "@/lib/admin/shop-types";

interface ProductEditorProps {
  product: ShopProduct | null;
  categories: ShopCategory[];
  options: ShopProductOption[];
  variants: ShopVariant[];
}

export function ProductEditor({ product, categories, options: initialOptions, variants: initialVariants }: ProductEditorProps) {
  const router = useRouter();
  const isNew = !product;

  // Form state
  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? (categories[0]?.id ?? ""));
  const [priceCents, setPriceCents] = useState(product?.priceCents ?? 0);
  const [taxCode, setTaxCode] = useState(product?.taxCode ?? "txcd_99999999");
  const [isFeatured, setIsFeatured] = useState(product?.isFeatured ?? false);
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [images, setImages] = useState<string[]>(product?.images ?? []);

  const [editorOptions, setEditorOptions] = useState<EditorOption[]>(
    initialOptions.map((o) => ({
      id: o.id,
      name: o.name,
      values: o.values.map((v) => ({ id: v.id, value: v.value })),
    }))
  );

  const [editorVariants, setEditorVariants] = useState<EditorVariant[]>(
    initialVariants.map((v) => ({
      id: v.id,
      sku: v.sku,
      priceCents: v.priceCents,
      stockQuantity: v.stockQuantity,
      reservedQuantity: v.reservedQuantity,
      isActive: v.isActive,
      optionValues: v.optionValues,
    }))
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-generate slug from name
  const handleNameChange = useCallback((value: string) => {
    setName(value);
    if (isNew || slug === slugify(product?.name ?? "")) {
      setSlug(slugify(value));
    }
  }, [isNew, slug, product?.name]);

  function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  async function handleSave() {
    setError(null);
    setSaving(true);

    const payload = {
      name,
      slug,
      description: description || undefined,
      categoryId,
      priceCents,
      images,
      isFeatured,
      isActive,
      taxCode,
      options: editorOptions.map((o) => ({
        id: o.id,
        name: o.name,
        values: o.values.map((v) => ({ id: v.id, value: v.value })),
      })),
      variants: editorVariants.map((v) => ({
        id: v.id,
        sku: v.sku,
        priceCents: v.priceCents,
        stockQuantity: v.stockQuantity,
        isActive: v.isActive,
        optionValues: v.optionValues,
      })),
    };

    try {
      const url = isNew
        ? "/api/admin/shop/products"
        : `/api/admin/shop/products/${product.id}/full`;
      const method = isNew ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Save failed");
        setSaving(false);
        return;
      }

      if (isNew && data.id) {
        router.push(`/admin/shop/products/${data.id}`);
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error");
    }

    setSaving(false);
  }

  async function handleArchive() {
    if (!product) return;
    await fetch(`/api/admin/shop/products/${product.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archivedAt: new Date().toISOString(), isActive: false }),
    });
    router.push("/admin/shop");
  }

  async function handleDelete() {
    if (!product) return;
    if (!confirm("Delete this product permanently? This cannot be undone.")) return;

    const res = await fetch(`/api/admin/shop/products/${product.id}`, { method: "DELETE" });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Delete failed");
      return;
    }

    router.push("/admin/shop");
  }

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/admin/shop"
          className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
        >
          <ArrowLeft size={14} /> Back to Products
        </Link>
        <div className="flex items-center gap-2">
          {!isNew && (
            <>
              <button
                onClick={handleArchive}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.12] rounded-sm font-mono text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
              >
                <Archive size={12} /> Archive
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-red-500/20 rounded-sm font-mono text-[11px] uppercase tracking-widest text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !name || !slug || !categoryId}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-ops-accent rounded-sm font-mono text-[11px] uppercase tracking-widest text-white hover:bg-ops-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={12} /> {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 border border-red-500/20 rounded-sm bg-red-500/5">
          <span className="font-mohave text-[13px] text-red-400">{error}</span>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-8 mb-8">
        {/* Left column — Product details */}
        <div className="space-y-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-1">
            Product Details
          </p>

          <div>
            <label className="block font-mono text-micro uppercase tracking-widest text-[#6B6B6B] mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-mono text-micro uppercase tracking-widest text-[#6B6B6B] mb-1">
              Slug
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-mono text-micro uppercase tracking-widest text-[#6B6B6B] mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none resize-none"
            />
          </div>

          <div>
            <label className="block font-mono text-micro uppercase tracking-widest text-[#6B6B6B] mb-1">
              Category
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-micro uppercase tracking-widest text-[#6B6B6B] mb-1">
                Base Price ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={centsToDecimal(priceCents)}
                onChange={(e) => setPriceCents(Math.round(parseFloat(e.target.value || "0") * 100))}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-mono text-micro uppercase tracking-widest text-[#6B6B6B] mb-1">
                Tax Code
              </label>
              <input
                type="text"
                value={taxCode}
                onChange={(e) => setTaxCode(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={isFeatured} onCheckedChange={setIsFeatured} />
              <span className="font-mono text-micro uppercase tracking-widest text-[#6B6B6B]">Featured</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <span className="font-mono text-micro uppercase tracking-widest text-[#6B6B6B]">Active</span>
            </label>
          </div>
        </div>

        {/* Right column — Images + Options */}
        <div className="space-y-6">
          <ImageUploader images={images} onChange={setImages} />
          <OptionManager options={editorOptions} onChange={setEditorOptions} />
        </div>
      </div>

      {/* Full-width variant matrix */}
      <div className="border-t border-white/[0.08] pt-6">
        <VariantMatrix
          options={editorOptions}
          variants={editorVariants}
          productSlug={slug}
          basePriceCents={priceCents}
          onChange={setEditorVariants}
        />
      </div>
    </div>
  );
}
