"use client";

/**
 * CATALOG — the variant-aware price book + stock hub (WEB OVERHAUL P3.2,
 * Direction D "Workbench"). Absorbs the retired /products and /inventory
 * pages into PRODUCTS / STOCK segments mirroring the iOS Catalog tab.
 *
 * URL contract:
 *   /catalog?segment=products|stock
 *           &filter=<chip>           (segment-local filter, e.g. nocost)
 *           &view=counts             (STOCK: snapshots/counts view)
 *           &drill=threshold         (STOCK: below-threshold buy-run pivot)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useProducts } from "@/lib/hooks/use-products";
import { useCatalogStock, useStockHealth, useOnHand } from "@/lib/hooks/use-catalog-stock";
import {
  useCatalogSnapshots,
  useProductConfigCounts,
} from "@/lib/hooks/use-catalog-meta";
import { productMargin } from "@/lib/types/catalog";
import { useCatalogSetupStatus } from "@/lib/hooks/use-catalog-setup-status";
import { SupplyStrip, type ProductAggregate } from "./supply-strip";
import { StockSegment } from "./segments/stock-segment";
import { ProductsSegment } from "./segments/products-segment";
import { CatalogSetupLauncher } from "./setup/catalog-setup-launcher";

export type CatalogSegment = "products" | "stock";

const SEGMENT_STORAGE_KEY = "catalog.segment";

export function CatalogPage() {
  const { t } = useDictionary("catalog");
  usePageTitle(t("title", "Catalog"));
  const router = useRouter();
  const searchParams = useSearchParams();
  const can = usePermissionStore((s) => s.can);

  const canProducts = can("catalog.products.view");
  const canStock = can("catalog.view");

  const visibleSegments = useMemo<CatalogSegment[]>(() => {
    const out: CatalogSegment[] = [];
    if (canProducts) out.push("products");
    if (canStock) out.push("stock");
    return out;
  }, [canProducts, canStock]);

  // ── Segment resolution (URL → stored → first visible) ──────────────────
  const segmentParam = searchParams.get("segment") as CatalogSegment | null;
  const [storedSegment, setStoredSegment] = useState<CatalogSegment | null>(null);
  useEffect(() => {
    const s = window.localStorage.getItem(SEGMENT_STORAGE_KEY) as CatalogSegment | null;
    if (s === "products" || s === "stock") setStoredSegment(s);
  }, []);

  const activeSegment: CatalogSegment | null = useMemo(() => {
    if (segmentParam && visibleSegments.includes(segmentParam)) return segmentParam;
    if (storedSegment && visibleSegments.includes(storedSegment)) return storedSegment;
    return visibleSegments[0] ?? null;
  }, [segmentParam, storedSegment, visibleSegments]);

  useEffect(() => {
    if (activeSegment) window.localStorage.setItem(SEGMENT_STORAGE_KEY, activeSegment);
  }, [activeSegment]);

  const updateParams = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null) params.delete(k);
        else params.set(k, v);
      }
      const qs = params.toString();
      router.replace(qs ? `/catalog?${qs}` : "/catalog", { scroll: false });
    },
    [router, searchParams],
  );

  // ── Data ────────────────────────────────────────────────────────────────
  const { data: stockRows = [], isLoading: stockLoading } = useCatalogStock();
  const health = useStockHealth(stockRows);
  const onHand = useOnHand(stockRows);
  const { data: products = [], isLoading: productsLoading } = useProducts(false);
  const { data: configCounts } = useProductConfigCounts();
  const { data: snapshots = [] } = useCatalogSnapshots();

  // First-run: a 0/0 catalog invites (never blocks) the setup wizard instead of
  // the empty segment tables (spec §6). Suppressed once setup is completed
  // (company-scoped flag) or dismissed this session — a one-time setup is never
  // re-imposed. The launcher self-gates on catalog.run_setup (crew see the plain
  // empty catalog).
  const { data: setupStatus } = useCatalogSetupStatus();
  const [setupDismissed, setSetupDismissed] = useState(false);

  const lastCountDate = useMemo(() => {
    const latest = snapshots[0]?.createdAt;
    if (!latest) return null;
    return latest.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  }, [snapshots]);

  const productAgg = useMemo<ProductAggregate>(() => {
    const active = products.filter((p) => !p.deletedAt);
    const withMargin = active
      .map((p) => productMargin(p.defaultPrice, p.unitCost))
      .filter((m): m is number => m != null);
    const avgMargin =
      withMargin.length > 0
        ? withMargin.reduce((s, m) => s + m, 0) / withMargin.length
        : null;
    const missingCost = active.filter((p) => p.unitCost == null).length;
    const configured = configCounts
      ? active.filter((p) => (configCounts.get(p.id)?.options ?? 0) > 0).length
      : 0;
    return {
      avgMargin,
      missingCost,
      active: active.filter((p) => p.isActive).length,
      configured,
      total: active.length,
    };
  }, [products, configCounts]);

  // ── Segment-control + URL handlers ────────────────────────────────────────
  const handleSegmentChange = useCallback(
    (segment: CatalogSegment) => {
      updateParams({ segment, filter: null, view: null, drill: null });
    },
    [updateParams],
  );

  const drillBelowThreshold = useCallback(() => {
    updateParams({ segment: "stock", drill: "threshold", view: null, filter: null });
  }, [updateParams]);

  const openCounts = useCallback(() => {
    updateParams({ segment: "stock", view: "counts", drill: null });
  }, [updateParams]);

  const fixCosts = useCallback(() => {
    updateParams({ segment: "products", filter: "nocost", drill: null, view: null });
  }, [updateParams]);

  const filterParam = searchParams.get("filter");
  const viewParam = searchParams.get("view");
  const drillParam = searchParams.get("drill");
  const actionParam = searchParams.get("action");

  const segmentCounts = useMemo(
    () => ({
      products: products.filter((p) => !p.deletedAt).length,
      stock: stockRows.length,
    }),
    [products, stockRows],
  );

  // First-run takeover: a 0/0 catalog (after data settles) invites the setup
  // wizard in place of the empty supply strip + segment tables. Gated on
  // catalog.run_setup so crew see the plain empty catalog, not a dead CTA;
  // suppressed once completed (company flag) or dismissed this session.
  const catalogIsEmpty = productAgg.total === 0 && stockRows.length === 0;
  const showFirstRun =
    catalogIsEmpty &&
    !productsLoading &&
    !stockLoading &&
    !setupStatus?.completedAt &&
    !setupDismissed &&
    can("catalog.run_setup");

  if (showFirstRun) {
    return (
      <div className="flex justify-start pt-6">
        <CatalogSetupLauncher onDismiss={() => setSetupDismissed(true)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SupplyStrip
        loading={stockLoading}
        health={health}
        onHand={onHand}
        lastCountDate={lastCountDate}
        product={canProducts ? productAgg : null}
        showStock={canStock}
        showProducts={canProducts}
        onDrillBelowThreshold={canStock ? drillBelowThreshold : undefined}
        onOpenCounts={canStock ? openCounts : undefined}
        onFixCosts={canProducts ? fixCosts : undefined}
      />

      {activeSegment === "stock" && canStock && (
        <StockSegment
          visibleSegments={visibleSegments}
          activeSegment={activeSegment}
          segmentCounts={segmentCounts}
          onSegmentChange={handleSegmentChange}
          drilled={drillParam === "threshold"}
          view={viewParam === "counts" ? "counts" : "list"}
          onClearDrill={() => updateParams({ drill: null })}
          onCloseCounts={() => updateParams({ view: null })}
          openCreate={actionParam === "new"}
          onCreateHandled={() => updateParams({ action: null })}
          rows={stockRows}
          loading={stockLoading}
        />
      )}

      {activeSegment === "products" && canProducts && (
        <ProductsSegment
          visibleSegments={visibleSegments}
          activeSegment={activeSegment}
          segmentCounts={segmentCounts}
          onSegmentChange={handleSegmentChange}
          initialFilter={filterParam}
          configCounts={configCounts}
        />
      )}

      {!activeSegment && (
        <div className="flex flex-col items-start py-8">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
            <span className="text-text-mute">{"// "}</span>
            {t("stock.empty.title", "NO ACCESS")}
          </span>
        </div>
      )}
    </div>
  );
}
