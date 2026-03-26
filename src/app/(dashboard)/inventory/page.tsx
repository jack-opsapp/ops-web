"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useInventoryItems,
  useInventoryTags,
  useInventoryItemTags,
} from "@/lib/hooks/use-inventory";
import { useInventoryMetrics } from "@/lib/hooks";
import { MetricsHeader } from "@/components/metrics";
import {
  getEffectiveThresholds,
  getThresholdStatus,
} from "@/lib/types/inventory";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { OverviewTab } from "@/components/inventory/overview-tab";
import { ItemsTab } from "@/components/inventory/items-tab";
import { TagsUnitsTab } from "@/components/inventory/tags-units-tab";
import { SnapshotsTab } from "@/components/inventory/snapshots-tab";
import { ImportTab } from "@/components/inventory/import-tab";

// ─── Permission Gate Wrapper ────────────────────────────────────────────────

export default function InventoryPage() {
  usePageTitle("Inventory");
  const router = useRouter();
  const { currentUser } = useAuthStore();

  useEffect(() => {
    if (currentUser && !currentUser.inventoryAccess) {
      router.replace("/dashboard");
    }
  }, [currentUser, router]);

  if (!currentUser || !currentUser.inventoryAccess) {
    return null;
  }

  return <InventoryContent />;
}

// ─── Content (only mounts when user has access) ─────────────────────────────

function InventoryContent() {
  const searchParams = useSearchParams();

  // Data hooks — only called when user has inventoryAccess
  const { data: items = [] } = useInventoryItems();
  const { data: tags = [] } = useInventoryTags();
  const { data: itemTags = [] } = useInventoryItemTags();

  // ── Metrics header data ────────────────────────────────────────────
  const { data: inventoryMetrics = [] } = useInventoryMetrics();

  // FAB ?action=new handling
  const action = searchParams.get("action");
  const [activeTab, setActiveTab] = useState(
    action === "new" ? "items" : "overview"
  );
  const [showCreateForm, setShowCreateForm] = useState(action === "new");

  useEffect(() => {
    if (action === "new") {
      setActiveTab("items");
      setShowCreateForm(true);
    }
  }, [action]);

  // Stats
  const stats = useMemo(() => {
    let warningCount = 0;
    let criticalCount = 0;

    for (const item of items) {
      const itemTagIds = itemTags
        .filter((jt) => jt.itemId === item.id)
        .map((jt) => jt.tagId);
      const itemTagRecords = tags.filter((t) => itemTagIds.includes(t.id));

      const effective = getEffectiveThresholds(item, itemTagRecords);
      const status = getThresholdStatus(
        item.quantity,
        effective.warningThreshold,
        effective.criticalThreshold
      );

      if (status === "warning") warningCount++;
      if (status === "critical") criticalCount++;
    }

    return {
      total: items.length,
      warning: warningCount,
      critical: criticalCount,
    };
  }, [items, tags, itemTags]);

  return (
    <div className="space-y-3 pb-6">
      {/* Metrics Header */}
      <MetricsHeader variant="full" tabId="inventory" title="Inventory" metrics={inventoryMetrics} />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">OVERVIEW</TabsTrigger>
          <TabsTrigger value="items">ITEMS</TabsTrigger>
          <TabsTrigger value="tags-units">TAGS & UNITS</TabsTrigger>
          <TabsTrigger value="snapshots">SNAPSHOTS</TabsTrigger>
          <TabsTrigger value="import">IMPORT</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>

        <TabsContent value="items">
          <ItemsTab
            showCreateForm={showCreateForm}
            onCreateFormOpen={() => setShowCreateForm(true)}
            onCreateFormClose={() => setShowCreateForm(false)}
          />
        </TabsContent>

        <TabsContent value="tags-units">
          <TagsUnitsTab />
        </TabsContent>

        <TabsContent value="snapshots">
          <SnapshotsTab />
        </TabsContent>

        <TabsContent value="import">
          <ImportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
