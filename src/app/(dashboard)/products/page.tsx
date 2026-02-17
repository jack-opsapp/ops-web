"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Plus,
  Search,
  Package,
  Wrench,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedPicker } from "@/components/ops/segmented-picker";
import { EmptyState } from "@/components/ops/empty-state";
import {
  useProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
} from "@/lib/hooks";
import {
  ProductType,
  formatCurrency,
} from "@/lib/types/models";
import type { Product } from "@/lib/types/models";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePageActionsStore } from "@/stores/page-actions-store";
import { cn } from "@/lib/utils/cn";

type FilterType = "all" | ProductType;

const typeFilters: { value: FilterType; label: string }[] = [
  { value: "all", label: "All" },
  { value: ProductType.Service, label: "Services" },
  { value: ProductType.Product, label: "Products" },
];

export default function ProductsPage() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  const { data: products = [], isLoading } = useProducts();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Page actions
  const setPageActions = usePageActionsStore((s) => s.setActions);
  useEffect(() => {
    setPageActions([
      {
        label: "New Product",
        icon: Plus,
        onClick: () => setShowModal(true),
      },
    ]);
    return () => setPageActions([]);
  }, [setPageActions]);

  // Filter products
  const filtered = useMemo(() => {
    let result = products.filter((p) => !p.deletedAt);

    if (filterType !== "all") {
      result = result.filter((p) => p.type === filterType);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q) ||
          (p.sku ?? "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [products, filterType, search]);

  const stats = useMemo(() => {
    const active = products.filter((p) => !p.deletedAt);
    return {
      total: active.length,
      services: active.filter((p) => p.type === ProductType.Service).length,
      products: active.filter((p) => p.type === ProductType.Product).length,
    };
  }, [products]);

  return (
    <div className="space-y-3 pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="font-mohave text-heading text-text-primary uppercase tracking-wider">
            Products & Services
          </h1>
          <p className="font-mohave text-body-sm text-text-tertiary">
            {stats.total} items — {stats.services} services, {stats.products} products
          </p>
        </div>
        <Button variant="default" size="sm" onClick={() => setShowModal(true)} className="gap-1">
          <Plus className="w-[14px] h-[14px]" />
          New Item
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-[320px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-text-tertiary" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="pl-7"
          />
        </div>
        <SegmentedPicker
          options={typeFilters.map((f) => ({ value: f.value, label: f.label }))}
          value={filterType}
          onChange={setFilterType}
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <span className="font-kosugi text-caption text-text-disabled">Loading...</span>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Package className="w-[32px] h-[32px]" />}
          title="No products or services"
          description={search ? "No items match your search." : "Add your first product or service to use in estimates and invoices."}
          action={
            !search
              ? { label: "Add Item", onClick: () => setShowModal(true) }
              : undefined
          }
        />
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-[rgba(255,255,255,0.02)]">
                <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Name
                </th>
                <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">
                  Type
                </th>
                <th className="text-right px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Price
                </th>
                <th className="text-right px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden md:table-cell">
                  Cost
                </th>
                <th className="text-center px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">
                  Taxable
                </th>
                <th className="text-center px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden md:table-cell">
                  SKU
                </th>
                <th className="text-right px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest w-[80px]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => (
                <tr
                  key={product.id}
                  className="border-b border-border last:border-b-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                >
                  {/* Name + Description */}
                  <td className="px-2 py-1.5">
                    <div>
                      <span className="font-mohave text-body text-text-primary block">
                        {product.name}
                      </span>
                      {product.description && (
                        <span className="font-kosugi text-[10px] text-text-disabled truncate block max-w-[300px]">
                          {product.description}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Type */}
                  <td className="px-2 py-1.5 hidden sm:table-cell">
                    <div className="flex items-center gap-1">
                      {product.type === ProductType.Service ? (
                        <Wrench className="w-[12px] h-[12px] text-[#8195B5]" />
                      ) : (
                        <Package className="w-[12px] h-[12px] text-[#C4A868]" />
                      )}
                      <span className="font-kosugi text-caption-sm text-text-secondary uppercase">
                        {product.type}
                      </span>
                    </div>
                  </td>

                  {/* Price */}
                  <td className="px-2 py-1.5 text-right">
                    <span className="font-mono text-data-sm text-text-primary">
                      {formatCurrency(product.unitPrice)}
                    </span>
                  </td>

                  {/* Cost */}
                  <td className="px-2 py-1.5 text-right hidden md:table-cell">
                    <span className="font-mono text-data-sm text-text-tertiary">
                      {product.costPrice != null ? formatCurrency(product.costPrice) : "—"}
                    </span>
                  </td>

                  {/* Taxable */}
                  <td className="px-2 py-1.5 text-center hidden sm:table-cell">
                    <span
                      className={cn(
                        "font-kosugi text-[10px] uppercase tracking-wider px-1 py-0.5 rounded",
                        product.taxable
                          ? "bg-[rgba(157,181,130,0.15)] text-status-success"
                          : "bg-[rgba(156,163,175,0.1)] text-text-disabled"
                      )}
                    >
                      {product.taxable ? "Yes" : "No"}
                    </span>
                  </td>

                  {/* SKU */}
                  <td className="px-2 py-1.5 text-center hidden md:table-cell">
                    <span className="font-mono text-[10px] text-text-disabled">
                      {product.sku || "—"}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        onClick={() => setEditingProduct(product)}
                        className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-[14px] h-[14px]" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${product.name}"?`)) {
                            deleteProduct.mutate(product.id);
                          }
                        }}
                        className="p-1 rounded text-text-disabled hover:text-ops-error hover:bg-ops-error-muted transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-[14px] h-[14px]" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      <ProductFormModal
        open={showModal || !!editingProduct}
        onClose={() => {
          setShowModal(false);
          setEditingProduct(null);
        }}
        product={editingProduct}
        companyId={companyId}
        onCreate={(data) => {
          createProduct.mutate(data, { onSuccess: () => setShowModal(false) });
        }}
        onUpdate={(id, data) => {
          updateProduct.mutate(
            { id, data },
            { onSuccess: () => setEditingProduct(null) }
          );
        }}
      />
    </div>
  );
}

// ─── Product Form Modal ─────────────────────────────────────────────────────

function ProductFormModal({
  open,
  onClose,
  product,
  companyId,
  onCreate,
  onUpdate,
}: {
  open: boolean;
  onClose: () => void;
  product: Product | null;
  companyId: string;
  onCreate: (data: Partial<Product> & { name: string; companyId: string }) => void;
  onUpdate: (id: string, data: Partial<Product>) => void;
}) {
  const isEditing = !!product;

  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [type, setType] = useState<ProductType>(product?.type ?? ProductType.Service);
  const [unitPrice, setUnitPrice] = useState(product?.unitPrice ?? 0);
  const [costPrice, setCostPrice] = useState(product?.costPrice ?? 0);
  const [taxable, setTaxable] = useState(product?.taxable ?? true);
  const [sku, setSku] = useState(product?.sku ?? "");
  const [active, setActive] = useState(product?.active ?? true);

  // Reset form when product changes
  useEffect(() => {
    if (product) {
      setName(product.name);
      setDescription(product.description ?? "");
      setType(product.type);
      setUnitPrice(product.unitPrice);
      setCostPrice(product.costPrice ?? 0);
      setTaxable(product.taxable);
      setSku(product.sku ?? "");
      setActive(product.active);
    } else {
      setName("");
      setDescription("");
      setType(ProductType.Service);
      setUnitPrice(0);
      setCostPrice(0);
      setTaxable(true);
      setSku("");
      setActive(true);
    }
  }, [product]);

  const handleSubmit = () => {
    if (!name.trim()) return;

    const data = {
      name: name.trim(),
      description: description.trim() || null,
      type,
      unitPrice,
      costPrice: costPrice || null,
      taxable,
      sku: sku.trim() || null,
      active,
    };

    if (isEditing && product) {
      onUpdate(product.id, data);
    } else {
      onCreate({
        ...data,
        companyId,
        externalQboId: null,
        externalSageId: null,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="font-mohave text-heading uppercase tracking-wider">
            {isEditing ? `Edit ${product?.name}` : "New Product / Service"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Type picker */}
          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
              Type
            </label>
            <SegmentedPicker
              options={[
                { value: ProductType.Service, label: "Service", icon: Wrench },
                { value: ProductType.Product, label: "Product", icon: Package },
              ]}
              value={type}
              onChange={setType}
            />
          </div>

          {/* Name */}
          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
              Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === ProductType.Service ? "e.g. HVAC Installation" : "e.g. Copper Pipe 3/4\""}
            />
          </div>

          {/* Description */}
          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
              Description
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Default description for line items"
              rows={2}
            />
          </div>

          {/* Price / Cost */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                Unit Price *
              </label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={unitPrice}
                onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-0.5">
              <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                Cost Price
              </label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={costPrice}
                onChange={(e) => setCostPrice(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          {/* SKU */}
          <div className="space-y-0.5">
            <label className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
              SKU
            </label>
            <Input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Optional SKU or part number"
            />
          </div>

          {/* Toggles */}
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={taxable}
                onChange={(e) => setTaxable(e.target.checked)}
                className="rounded border-border"
              />
              <span className="font-kosugi text-caption text-text-secondary">Taxable</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="rounded border-border"
              />
              <span className="font-kosugi text-caption text-text-secondary">Active</span>
            </label>
          </div>

          {/* Margin display */}
          {costPrice > 0 && unitPrice > 0 && (
            <div className="bg-[rgba(255,255,255,0.02)] border border-border rounded p-1.5">
              <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider">
                Margin:{" "}
              </span>
              <span className="font-mono text-data-sm text-status-success">
                {formatCurrency(unitPrice - costPrice)} ({((1 - costPrice / unitPrice) * 100).toFixed(1)}%)
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-1.5 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="default" size="sm" onClick={handleSubmit} disabled={!name.trim()}>
              {isEditing ? "Update" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
