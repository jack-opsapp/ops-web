"use client";

import { useState, useMemo, useEffect } from "react";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import {
  Plus,
  Search,
  Package,
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
import { EmptyState } from "@/components/ops/empty-state";
import { ProductBomEditor } from "@/components/ops/product-bom-editor";
import {
  useProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useTaskTypes,
  useProductMetrics,
  useCatalogLookups,
  resolveCategoryId,
  resolveUnitId,
} from "@/lib/hooks";
import { MetricsHeader } from "@/components/metrics";
import {
  formatCurrency,
  calculateMargin,
  UNIT_OPTIONS,
} from "@/lib/types/pipeline";
import type {
  Product,
  CreateProduct,
  LineItemType,
  ProductKind,
} from "@/lib/types/pipeline";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

export default function ProductsPage() {
  usePageTitle("Products");
  const { t } = useDictionary("dashboard");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const can = usePermissionStore((s) => s.can);

  const { data: productMetrics = [], isLoading: productMetricsLoading } = useProductMetrics();
  const { data: products = [], isLoading } = useProducts();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const { data: taskTypes = [] } = useTaskTypes();

  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Filter products
  const filtered = useMemo(() => {
    let result = products.filter((p) => !p.deletedAt);

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q) ||
          (p.category ?? "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [products, search]);

  const taskTypeMap = useMemo(() => {
    const map = new Map<string, { display: string; color: string }>();
    for (const tt of taskTypes) {
      map.set(tt.id, { display: tt.display, color: tt.color });
    }
    return map;
  }, [taskTypes]);

  const stats = useMemo(() => {
    const active = products.filter((p) => !p.deletedAt);
    return {
      total: active.length,
      active: active.filter((p) => p.isActive).length,
      inactive: active.filter((p) => !p.isActive).length,
    };
  }, [products]);

  return (
    <div className="space-y-3">
      {/* Metrics Header */}
      <MetricsHeader
        variant="compact"
        tabId="products"
        title="Products"
        metrics={productMetrics}
        isLoading={productMetricsLoading}
        actions={
          can("products.manage") ? (
            <Button variant="default" size="sm" onClick={() => setShowModal(true)} className="gap-1">
              <Plus className="w-[14px] h-[14px]" />
              {t("products.newItem")}
            </Button>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-[320px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-text-3" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("products.searchPlaceholder")}
            className="pl-7"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <span className="font-mono text-caption text-text-mute">{t("products.loading")}</span>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Package className="w-[32px] h-[32px]" />}
          title={t("products.emptyTitle")}
          description={search ? t("products.emptySearchDescription") : t("products.emptyDescription")}
          action={
            !search && can("products.manage")
              ? { label: t("products.addItem"), onClick: () => setShowModal(true) }
              : undefined
          }
        />
      ) : (
        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b border-border bg-[rgba(255,255,255,0.02)]">
                <th className="text-left px-2 py-1.5 font-mono text-caption-sm text-text-3 uppercase tracking-widest">
                  {t("products.colName")}
                </th>
                <th className="text-left px-2 py-1.5 font-mono text-caption-sm text-text-3 uppercase tracking-widest hidden sm:table-cell">
                  {t("products.colUnit")}
                </th>
                <th className="text-left px-2 py-1.5 font-mono text-caption-sm text-text-3 uppercase tracking-widest hidden md:table-cell">
                  {t("products.colCategory")}
                </th>
                <th className="text-left px-2 py-1.5 font-mono text-caption-sm text-text-3 uppercase tracking-widest hidden lg:table-cell">
                  {t("products.colTaskType")}
                </th>
                <th className="text-right px-2 py-1.5 font-mono text-caption-sm text-text-3 uppercase tracking-widest">
                  {t("products.colPrice")}
                </th>
                <th className="text-right px-2 py-1.5 font-mono text-caption-sm text-text-3 uppercase tracking-widest hidden md:table-cell">
                  {t("products.colCost")}
                </th>
                <th className="text-center px-2 py-1.5 font-mono text-caption-sm text-text-3 uppercase tracking-widest hidden sm:table-cell">
                  {t("products.colTaxable")}
                </th>
                <th className="text-right px-2 py-1.5 font-mono text-caption-sm text-text-3 uppercase tracking-widest w-[80px]">
                  {t("products.colActions")}
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
                      <span className="font-mohave text-body text-text block">
                        {product.name}
                      </span>
                      {product.description && (
                        <span className="font-mono text-micro text-text-mute truncate block max-w-[300px]">
                          {product.description}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Unit */}
                  <td className="px-2 py-1.5 hidden sm:table-cell">
                    <span className="font-mono text-caption-sm text-text-2 uppercase">
                      {product.unit}
                    </span>
                  </td>

                  {/* Category */}
                  <td className="px-2 py-1.5 hidden md:table-cell">
                    <span className="font-mono text-caption-sm text-text-3">
                      {product.category || "—"}
                    </span>
                  </td>

                  {/* Task Type */}
                  <td className="px-2 py-1.5 hidden lg:table-cell">
                    {product.taskTypeId && taskTypeMap.has(product.taskTypeId) ? (
                      <span className="inline-flex items-center gap-[4px]">
                        <span
                          className="w-[8px] h-[8px] rounded-full"
                          style={{ backgroundColor: taskTypeMap.get(product.taskTypeId)!.color }}
                        />
                        <span className="font-mono text-caption-sm text-text-2">
                          {taskTypeMap.get(product.taskTypeId)!.display}
                        </span>
                      </span>
                    ) : (
                      <span className="font-mono text-caption-sm text-text-mute">—</span>
                    )}
                  </td>

                  {/* Price */}
                  <td className="px-2 py-1.5 text-right">
                    <span className="font-mono text-data-sm text-text">
                      {formatCurrency(product.defaultPrice)}
                    </span>
                  </td>

                  {/* Cost */}
                  <td className="px-2 py-1.5 text-right hidden md:table-cell">
                    <span className="font-mono text-data-sm text-text-3">
                      {product.unitCost != null ? formatCurrency(product.unitCost) : "—"}
                    </span>
                  </td>

                  {/* Taxable */}
                  <td className="px-2 py-1.5 text-center hidden sm:table-cell">
                    <span
                      className={cn(
                        "font-mono text-micro uppercase tracking-wider px-1 py-0.5 rounded",
                        product.isTaxable
                          ? "bg-[rgba(157,181,130,0.15)] text-status-success"
                          : "bg-[rgba(156,163,175,0.1)] text-text-mute"
                      )}
                    >
                      {product.isTaxable ? t("products.yes") : t("products.no")}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      {can("products.manage") && (
                        <button
                          onClick={() => setEditingProduct(product)}
                          className="p-1 rounded text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                          title={t("products.edit")}
                        >
                          <Pencil className="w-[14px] h-[14px]" />
                        </button>
                      )}
                      {can("products.manage") && (
                        <button
                          onClick={() => {
                            if (confirm(`${t("products.deleteConfirm")} "${product.name}"?`)) {
                              deleteProduct.mutate(product.id);
                            }
                          }}
                          className="p-1 rounded text-text-mute hover:text-ops-error hover:bg-ops-error-muted transition-colors"
                          title={t("products.delete")}
                        >
                          <Trash2 className="w-[14px] h-[14px]" />
                        </button>
                      )}
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
  onCreate: (data: CreateProduct) => void;
  onUpdate: (id: string, data: Partial<CreateProduct>) => void;
}) {
  const { t } = useDictionary("dashboard");
  const isEditing = !!product;
  const { data: taskTypes = [] } = useTaskTypes();
  // Best-effort name -> FK resolution. Stopgap for P0; replaced by real
  // pickers in P0-2. When the typed value matches an existing catalog row
  // (case-insensitive, trimmed) we write the FK alongside the legacy text;
  // otherwise the FK is left NULL and only the legacy column is written.
  const { categories: catalogCategories, units: catalogUnits } =
    useCatalogLookups();

  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [defaultPrice, setDefaultPrice] = useState(product?.defaultPrice ?? 0);
  const [unitCost, setUnitCost] = useState(product?.unitCost ?? 0);
  const [unit, setUnit] = useState(product?.unit ?? "each");
  const [category, setCategory] = useState(product?.category ?? "");
  const [taskTypeId, setTaskTypeId] = useState<string | null>(product?.taskTypeId ?? null);
  const [isTaxable, setIsTaxable] = useState(product?.isTaxable ?? true);
  const [isActive, setIsActive] = useState(product?.isActive ?? true);

  // iOS DTO parity — kind and type need a non-null default at create time
  // because the DB columns are NOT NULL. The user always sees an explicitly
  // selected value the moment the modal opens; nothing is left ambiguous.
  const [kind, setKind] = useState<ProductKind>(
    (product?.kind ?? "service") as ProductKind
  );
  const [type, setType] = useState<LineItemType>(product?.type ?? "LABOR");

  // SKU is uppercased on input to match the iOS QuickAddProductSheet pattern.
  // Minimum charge/quantity are string-typed so an empty field maps to null
  // on save — plain numeric state would force a 0 which is a real value.
  const [sku, setSku] = useState(product?.sku ?? "");
  const [minimumCharge, setMinimumCharge] = useState<string>(
    product?.minimumCharge != null ? String(product.minimumCharge) : ""
  );
  const [minimumQuantity, setMinimumQuantity] = useState<string>(
    product?.minimumQuantity != null ? String(product.minimumQuantity) : ""
  );
  const minimumChargeError =
    minimumCharge.trim() !== "" &&
    !(Number.isFinite(Number(minimumCharge)) && Number(minimumCharge) >= 0);
  const minimumQuantityError =
    minimumQuantity.trim() !== "" &&
    !(Number.isFinite(Number(minimumQuantity)) && Number(minimumQuantity) >= 0);

  // Reset form when product changes
  useEffect(() => {
    if (product) {
      setName(product.name);
      setDescription(product.description ?? "");
      setDefaultPrice(product.defaultPrice);
      setUnitCost(product.unitCost ?? 0);
      setUnit(product.unit ?? "each");
      setCategory(product.category ?? "");
      setTaskTypeId(product.taskTypeId ?? null);
      setIsTaxable(product.isTaxable);
      setIsActive(product.isActive);
      setKind((product.kind ?? "service") as ProductKind);
      setType(product.type ?? "LABOR");
      setSku(product.sku ?? "");
      setMinimumCharge(
        product.minimumCharge != null ? String(product.minimumCharge) : ""
      );
      setMinimumQuantity(
        product.minimumQuantity != null ? String(product.minimumQuantity) : ""
      );
    } else {
      setName("");
      setDescription("");
      setDefaultPrice(0);
      setUnitCost(0);
      setUnit("each");
      setCategory("");
      setTaskTypeId(null);
      setIsTaxable(true);
      setIsActive(true);
      setKind("service");
      setType("LABOR");
      setSku("");
      setMinimumCharge("");
      setMinimumQuantity("");
    }
  }, [product]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    if (minimumChargeError || minimumQuantityError) return;

    const trimmedCategory = category.trim() || null;
    const trimmedSku = sku.trim();
    const resolvedCategoryId = resolveCategoryId(
      trimmedCategory,
      catalogCategories
    );
    const resolvedUnitId = resolveUnitId(unit, catalogUnits);

    const data = {
      name: name.trim(),
      description: description.trim() || null,
      defaultPrice,
      unitCost: unitCost || null,
      unit,
      unitId: resolvedUnitId,
      category: trimmedCategory,
      categoryId: resolvedCategoryId,
      taskTypeId: taskTypeId || null,
      isTaxable,
      isActive,
      kind,
      type,
      sku: trimmedSku === "" ? null : trimmedSku,
      minimumCharge:
        minimumCharge.trim() === "" ? null : Number(minimumCharge),
      minimumQuantity:
        minimumQuantity.trim() === "" ? null : Number(minimumQuantity),
    };

    if (isEditing && product) {
      onUpdate(product.id, data);
    } else {
      onCreate({
        ...data,
        companyId,
      });
    }
  };

  const margin = calculateMargin(defaultPrice, unitCost || null);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="font-mohave text-heading uppercase tracking-wider">
            {isEditing ? `${t("products.edit")} ${product?.name}` : t("products.newProductService")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Name */}
          <div className="space-y-0.5">
            <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
              {t("products.labelName")} *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("products.namePlaceholder")}
            />
          </div>

          {/* Description */}
          <div className="space-y-0.5">
            <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
              {t("products.labelDescription")}
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("products.descriptionPlaceholder")}
              rows={2}
            />
          </div>

          {/* Price / Cost */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
                {t("products.labelDefaultPrice")} *
              </label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={defaultPrice}
                onChange={(e) => setDefaultPrice(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-0.5">
              <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
                {t("products.labelUnitCost")}
              </label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={unitCost}
                onChange={(e) => setUnitCost(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          {/* Unit / Category */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
                {t("products.labelUnit")}
              </label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full bg-fill-neutral-dim border border-border rounded px-2 py-1.5 font-mohave text-body text-text"
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div className="space-y-0.5">
              <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
                {t("products.labelCategory")}
              </label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t("products.categoryPlaceholder")}
              />
            </div>
          </div>

          {/* Task Type */}
          <div className="space-y-0.5">
            <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
              {t("products.labelTaskType")}
            </label>
            <select
              value={taskTypeId ?? ""}
              onChange={(e) => setTaskTypeId(e.target.value || null)}
              className="w-full bg-fill-neutral-dim border border-border rounded px-2 py-1.5 font-mohave text-body text-text"
            >
              <option value="">{t("products.none")}</option>
              {taskTypes.map((tt) => (
                <option key={tt.id} value={tt.id}>
                  {tt.display}
                </option>
              ))}
            </select>
            <p className="font-mono text-micro text-text-mute">
              {t("products.taskTypeHelp")}
            </p>
          </div>

          {/* Toggles */}
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isTaxable}
                onChange={(e) => setIsTaxable(e.target.checked)}
                className="rounded border-border"
              />
              <span className="font-mono text-caption text-text-2">{t("products.taxable")}</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded border-border"
              />
              <span className="font-mono text-caption text-text-2">{t("products.activeLabel")}</span>
            </label>
          </div>

          {/* Margin display */}
          {margin !== null && (
            <div className="bg-[rgba(255,255,255,0.02)] border border-border rounded p-1.5">
              <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
                {t("products.margin")}:{" "}
              </span>
              <span className="font-mono text-data-sm text-status-success">
                {formatCurrency(defaultPrice - (unitCost || 0))} ({margin.toFixed(1)}%)
              </span>
            </div>
          )}

          {/* Advanced section — kind / type segmented pickers.
              Mirrors the iOS QuickAddProductSheet "// ADVANCED" disclosure so a
              product authored on iOS round-trips its kind + line-item type
              through web edits without losing either. */}
          <details className="group border-t border-border pt-2">
            <summary
              className={cn(
                "flex items-center justify-between cursor-pointer list-none",
                "font-cakemono font-light uppercase text-caption-sm tracking-[0.08em] text-text-3",
                "hover:text-text-2 transition-colors"
              )}
            >
              <span>{t("products.advancedSection")}</span>
              <span className="font-mono text-micro text-text-mute group-open:rotate-90 transition-transform">
                [+]
              </span>
            </summary>

            <div className="space-y-3 mt-2">
              {/* Kind */}
              <div className="space-y-0.5">
                <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
                  {t("products.labelKind")}
                </label>
                <SegmentedControl<ProductKind>
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: "service", label: t("products.kindService") },
                    { value: "good", label: t("products.kindGood") },
                  ]}
                  ariaLabel={t("products.labelKind")}
                />
              </div>

              {/* Line item type */}
              <div className="space-y-0.5">
                <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
                  {t("products.labelType")}
                </label>
                <SegmentedControl<LineItemType>
                  value={type}
                  onChange={setType}
                  options={[
                    { value: "LABOR", label: t("products.typeLabor") },
                    { value: "MATERIAL", label: t("products.typeMaterial") },
                    { value: "OTHER", label: t("products.typeOther") },
                  ]}
                  ariaLabel={t("products.labelType")}
                />
              </div>

              {/* SKU + Minimum charge */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
                    {t("products.labelSku")}
                  </label>
                  <Input
                    value={sku}
                    onChange={(e) => setSku(e.target.value.toUpperCase())}
                    placeholder={t("products.skuPlaceholder")}
                    autoCorrect="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
                    {t("products.labelMinimumCharge")}
                  </label>
                  <div className="relative">
                    <span
                      aria-hidden
                      className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-caption text-text-mute pointer-events-none"
                    >
                      $
                    </span>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={minimumCharge}
                      onChange={(e) => setMinimumCharge(e.target.value)}
                      placeholder="0.00"
                      className={cn("pl-5", minimumChargeError && "border-status-error")}
                      aria-invalid={minimumChargeError || undefined}
                    />
                  </div>
                  {!minimumChargeError && (
                    <p className="font-mono text-micro text-text-mute">
                      {t("products.minimumChargeHelp")}
                    </p>
                  )}
                </div>
              </div>

              {/* Minimum quantity */}
              <div className="space-y-0.5">
                <label className="font-mono text-caption-sm text-text-3 uppercase tracking-widest">
                  {t("products.labelMinimumQuantity")}
                </label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={minimumQuantity}
                  onChange={(e) => setMinimumQuantity(e.target.value)}
                  placeholder="0"
                  className={cn(minimumQuantityError && "border-status-error")}
                  aria-invalid={minimumQuantityError || undefined}
                />
                {!minimumQuantityError && (
                  <p className="font-mono text-micro text-text-mute">
                    {t("products.minimumQuantityHelp")}
                  </p>
                )}
              </div>
            </div>
          </details>

          {/* Bill of Materials — only for saved products */}
          {isEditing && product && (
            <div className="border-t border-border pt-3">
              <ProductBomEditor productId={product.id} productUnit={unit} />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-1.5 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("products.cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSubmit}
              disabled={
                !name.trim() || minimumChargeError || minimumQuantityError
              }
            >
              {isEditing ? t("products.update") : t("products.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Segmented Control ─────────────────────────────────────────────────────
//
// A small button-group used for the Kind and Line-item-type fields. Active
// segment fills with the subdued white-8% background + 18% border pattern
// borrowed from `SplitInboxTabs` — spec v2 reserves the steel-blue accent
// for the primary CTA + focus ring only, so segment selection stays
// monochrome.
//
// Generic over `T extends string` so the consumer keeps full type safety:
// `<SegmentedControl<ProductKind> value={kind} onChange={setKind}>`.

interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<SegmentedControlOption<T>>;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-stretch gap-0.5 p-0.5 rounded-[5px] border border-border bg-[rgba(255,255,255,0.02)]"
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option.value)}
            className={cn(
              "px-2.5 py-1 rounded-[4px] border transition-colors duration-150",
              "font-cakemono font-light uppercase text-[11px] tracking-[0.08em] leading-none",
              isActive
                ? "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.08)] text-text"
                : "border-transparent text-text-3 hover:text-text-2 hover:bg-[rgba(255,255,255,0.04)]"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
