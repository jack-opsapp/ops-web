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

// ─── Permission Gate Wrapper ────────────────────────────────────────────────

export default function InventoryPage() {
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
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-mohave text-heading font-semibold uppercase tracking-wider text-text-primary">
            INVENTORY
          </h1>
          <span className="font-mono text-[11px] text-text-disabled bg-background-elevated px-1.5 py-[2px] rounded-sm">
            {stats.total}
          </span>
        </div>
        {(stats.warning > 0 || stats.critical > 0) && (
          <div className="flex items-center gap-2 mt-[4px]">
            {stats.warning > 0 && (
              <span className="font-mono text-[11px] text-ops-amber">
                {stats.warning} low stock
              </span>
            )}
            {stats.critical > 0 && (
              <span className="font-mono text-[11px] text-ops-error">
                {stats.critical} critical
              </span>
            )}
          </div>
        )}
      </div>

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
