"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  useInventoryItems,
  useInventoryTags,
  useInventoryItemTags,
} from "@/lib/hooks/use-inventory";
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

export default function InventoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser } = useAuthStore();

  // ─── Permission Gate ────────────────────────────────────────────────────────
  useEffect(() => {
    if (currentUser && !currentUser.inventoryAccess) {
      router.replace("/dashboard");
    }
  }, [currentUser, router]);

  // ─── Data ───────────────────────────────────────────────────────────────────
  const { data: items = [] } = useInventoryItems();
  const { data: tags = [] } = useInventoryTags();
  const { data: itemTags = [] } = useInventoryItemTags();

  // ─── FAB ?action=new handling ───────────────────────────────────────────────
  const action = searchParams.get("action");
  const [activeTab, setActiveTab] = useState(
    action === "new" ? "items" : "overview"
  );
  const [showCreateForm, setShowCreateForm] = useState(action === "new");

  // If the URL param changes after mount (e.g. FAB pressed while on page)
  useEffect(() => {
    if (action === "new") {
      setActiveTab("items");
      setShowCreateForm(true);
    }
  }, [action]);

  // ─── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const activeItems = items.filter((i) => !i.deletedAt);
    let warningCount = 0;
    let criticalCount = 0;

    for (const item of activeItems) {
      // Find tags for this item via the junction table
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
      total: activeItems.length,
      warning: warningCount,
      critical: criticalCount,
    };
  }, [items, tags, itemTags]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  // Don't render until we know the user has access
  if (!currentUser || !currentUser.inventoryAccess) {
    return null;
  }

  return (
    <div className="space-y-3 pb-6">
      {/* Header */}
      <div>
        <h1 className="font-mohave text-heading font-semibold uppercase tracking-wider text-text-primary">
          INVENTORY
        </h1>
        <p className="font-mohave text-body-sm text-text-tertiary">
          {stats.total} items
          {(stats.warning > 0 || stats.critical > 0) && (
            <>
              {" \u2014 "}
              {stats.warning > 0 && <>{stats.warning} low</>}
              {stats.warning > 0 && stats.critical > 0 && ", "}
              {stats.critical > 0 && <>{stats.critical} critical</>}
            </>
          )}
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="tags-units">Tags & Units</TabsTrigger>
          <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>

        <TabsContent value="items">
          <ItemsTab
            showCreateForm={showCreateForm}
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
