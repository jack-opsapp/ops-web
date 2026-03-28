"use client";

import { useMemo } from "react";
import { Camera, Plus, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useInventoryItems,
  useInventoryTags,
  useInventoryItemTags,
  useInventoryUnits,
  useInventorySnapshots,
} from "@/lib/hooks/use-inventory";
import {
  getEffectiveThresholds,
  getThresholdStatus,
} from "@/lib/types/inventory";
import type {
  InventoryItem,
  InventoryTag,
  ThresholdStatus,
} from "@/lib/types/inventory";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ItemWithStatus {
  item: InventoryItem;
  status: ThresholdStatus;
  tagIds: string[];
  unitDisplay: string | null;
}

interface TagSummary {
  tag: InventoryTag;
  itemCount: number;
  okCount: number;
  warningCount: number;
  criticalCount: number;
}

interface OverviewTabProps {
  onSwitchToItems?: (tagFilter?: string) => void;
  onCreateSnapshot?: () => void;
  onAddItem?: () => void;
  onImport?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function OverviewTab({
  onSwitchToItems,
  onCreateSnapshot,
  onAddItem,
  onImport,
}: OverviewTabProps) {
  // ─── Data ───────────────────────────────────────────────────────────────────
  const { data: items = [] } = useInventoryItems();
  const { data: tags = [] } = useInventoryTags();
  const { data: itemTags = [] } = useInventoryItemTags();
  const { data: units = [] } = useInventoryUnits();
  const { data: snapshots = [] } = useInventorySnapshots();

  // ─── Unit map ─────────────────────────────────────────────────────────────
  const unitMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of units) {
      map.set(u.id, u.display);
    }
    return map;
  }, [units]);

  // ─── Tag map ──────────────────────────────────────────────────────────────
  const tagMap = useMemo(() => {
    const map = new Map<string, InventoryTag>();
    for (const t of tags) {
      if (!t.deletedAt) map.set(t.id, t);
    }
    return map;
  }, [tags]);

  // ─── Items with resolved status ──────────────────────────────────────────
  const itemsWithStatus = useMemo<ItemWithStatus[]>(() => {
    const activeItems = items.filter((i) => !i.deletedAt);

    return activeItems.map((item) => {
      const tagIds = itemTags
        .filter((jt) => jt.itemId === item.id)
        .map((jt) => jt.tagId);
      const itemTagRecords = tagIds
        .map((id) => tagMap.get(id))
        .filter((t): t is InventoryTag => t !== undefined);

      const effective = getEffectiveThresholds(item, itemTagRecords);
      const status = getThresholdStatus(
        item.quantity,
        effective.warningThreshold,
        effective.criticalThreshold
      );

      const unitDisplay = item.unitId ? (unitMap.get(item.unitId) ?? null) : null;

      return { item, status, tagIds, unitDisplay };
    });
  }, [items, itemTags, tagMap, unitMap]);

  // ─── Summary counts ──────────────────────────────────────────────────────
  const summary = useMemo(() => {
    let warningCount = 0;
    let criticalCount = 0;

    for (const { status } of itemsWithStatus) {
      if (status === "warning") warningCount++;
      if (status === "critical") criticalCount++;
    }

    const activeTags = tags.filter((t) => !t.deletedAt);

    return {
      total: itemsWithStatus.length,
      warning: warningCount,
      critical: criticalCount,
      tagCount: activeTags.length,
    };
  }, [itemsWithStatus, tags]);

  // ─── Needs attention items (critical first, then warning, max 10) ─────
  const attentionItems = useMemo(() => {
    const filtered = itemsWithStatus.filter(
      (iws) => iws.status === "critical" || iws.status === "warning"
    );

    // Sort critical-first
    filtered.sort((a, b) => {
      if (a.status === "critical" && b.status !== "critical") return -1;
      if (a.status !== "critical" && b.status === "critical") return 1;
      return 0;
    });

    return filtered;
  }, [itemsWithStatus]);

  const attentionDisplay = attentionItems.slice(0, 10);
  const hasMoreAttention = attentionItems.length > 10;

  // ─── By-tag summaries ─────────────────────────────────────────────────────
  const tagSummaries = useMemo<TagSummary[]>(() => {
    const activeTags = tags.filter((t) => !t.deletedAt);

    return activeTags.map((tag) => {
      // Find all items associated with this tag
      const itemIdsForTag = itemTags
        .filter((jt) => jt.tagId === tag.id)
        .map((jt) => jt.itemId);

      const tagItems = itemsWithStatus.filter((iws) =>
        itemIdsForTag.includes(iws.item.id)
      );

      let okCount = 0;
      let warnCount = 0;
      let critCount = 0;

      for (const { status } of tagItems) {
        if (status === "normal") okCount++;
        else if (status === "warning") warnCount++;
        else if (status === "critical") critCount++;
      }

      return {
        tag,
        itemCount: tagItems.length,
        okCount: okCount,
        warningCount: warnCount,
        criticalCount: critCount,
      };
    });
  }, [tags, itemTags, itemsWithStatus]);

  // ─── Recent snapshots (last 3) ────────────────────────────────────────────
  const recentSnapshots = useMemo(() => {
    const sorted = [...snapshots].sort((a, b) => {
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bDate - aDate;
    });
    return sorted.slice(0, 3);
  }, [snapshots]);

  // ─── Delta text (compare current count to last snapshot) ──────────────────
  const deltaText = useMemo(() => {
    if (recentSnapshots.length === 0) return null;
    const lastSnapshot = recentSnapshots[0];
    const diff = summary.total - lastSnapshot.itemCount;
    if (diff === 0) return "No change since last snapshot";
    const sign = diff > 0 ? "+" : "";
    return `${sign}${diff} since last snapshot`;
  }, [summary.total, recentSnapshots]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── 1. Summary Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Items */}
        <Card>
          <CardContent className="py-3 px-3">
            <span className="font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary block mb-1">
              Total Items
            </span>
            <span className="font-mono text-data-lg text-text-primary block">
              {summary.total}
            </span>
            {deltaText && (
              <span className="font-kosugi text-[10px] text-text-disabled block mt-1">
                {deltaText}
              </span>
            )}
          </CardContent>
        </Card>

        {/* Low Stock */}
        <Card className="border-l-2 border-l-status-warning">
          <CardContent className="py-3 px-3">
            <span className="font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary block mb-1">
              Low Stock
            </span>
            <span className="font-mono text-data-lg text-status-warning block">
              {summary.warning}
            </span>
          </CardContent>
        </Card>

        {/* Critical */}
        <Card className="border-l-2 border-l-status-error">
          <CardContent className="py-3 px-3">
            <span className="font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary block mb-1">
              Critical
            </span>
            <span className="font-mono text-data-lg text-status-error block">
              {summary.critical}
            </span>
            {summary.critical > 0 && (
              <Badge variant="error" pulse className="mt-1">
                {summary.critical} CRITICAL
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Tags */}
        <Card>
          <CardContent className="py-3 px-3">
            <span className="font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary block mb-1">
              Tags
            </span>
            <span className="font-mono text-data-lg text-text-primary block">
              {summary.tagCount}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* ── 2. Needs Attention ────────────────────────────────────────────────── */}
      {attentionItems.length > 0 && (
        <div className="space-y-2">
          <span className="font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
            [ NEEDS ATTENTION ]
          </span>

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-[rgba(255,255,255,0.02)]">
                  <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                    Name
                  </th>
                  <th className="text-right px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                    Quantity
                  </th>
                  <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">
                    Status
                  </th>
                  <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden md:table-cell">
                    Tags
                  </th>
                </tr>
              </thead>
              <tbody>
                {attentionDisplay.map(({ item, status, tagIds, unitDisplay }) => (
                  <tr
                    key={item.id}
                    className="border-b border-border last:border-b-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                  >
                    <td className="px-2 py-1.5">
                      <span className="font-mohave text-body text-text-primary">
                        {item.name}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <span className="font-mono text-data-sm text-text-primary">
                        {item.quantity}
                      </span>
                      {unitDisplay && (
                        <span className="font-kosugi text-[10px] text-text-disabled ml-1">
                          {unitDisplay}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 hidden sm:table-cell">
                      <Badge
                        variant={status === "critical" ? "error" : "warning"}
                        pulse={status === "critical"}
                      >
                        {status === "critical" ? "CRITICAL" : "LOW"}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {tagIds.map((tagId) => {
                          const tag = tagMap.get(tagId);
                          if (!tag) return null;
                          return (
                            <span
                              key={tagId}
                              className="font-kosugi text-[10px] text-text-disabled bg-[rgba(255,255,255,0.05)] px-1 py-0.5 rounded"
                            >
                              {tag.name}
                            </span>
                          );
                        })}
                        {tagIds.length === 0 && (
                          <span className="font-kosugi text-[10px] text-text-disabled">
                            ---
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMoreAttention && (
            <button
              onClick={() => onSwitchToItems?.()}
              className="font-kosugi text-caption-sm text-ops-accent hover:text-ops-accent-hover transition-colors cursor-pointer"
            >
              View all in Items tab
            </button>
          )}
        </div>
      )}

      {/* ── 3. By Tag ────────────────────────────────────────────────────────── */}
      {tagSummaries.length > 0 && (
        <div className="space-y-2">
          <span className="font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
            [ BY TAG ]
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tagSummaries.map(({ tag, itemCount, okCount, warningCount, criticalCount }) => (
              <Card
                key={tag.id}
                variant="interactive"
                onClick={() => onSwitchToItems?.(tag.id)}
              >
                <CardContent className="py-3 px-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mohave text-body text-text-primary">
                      {tag.name}
                    </span>
                    <span className="font-mono text-data-sm text-text-secondary">
                      {itemCount} {itemCount === 1 ? "item" : "items"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {okCount > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-[6px] h-[6px] rounded-full bg-status-success" />
                        <span className="font-kosugi text-[10px] text-text-disabled">
                          {okCount} ok
                        </span>
                      </span>
                    )}
                    {warningCount > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-[6px] h-[6px] rounded-full bg-status-warning" />
                        <span className="font-kosugi text-[10px] text-text-disabled">
                          {warningCount} low
                        </span>
                      </span>
                    )}
                    {criticalCount > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-[6px] h-[6px] rounded-full bg-status-error" />
                        <span className="font-kosugi text-[10px] text-text-disabled">
                          {criticalCount} critical
                        </span>
                      </span>
                    )}
                    {itemCount === 0 && (
                      <span className="font-kosugi text-[10px] text-text-disabled">
                        No items
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── 4. Recent Snapshots ───────────────────────────────────────────────── */}
      {recentSnapshots.length > 0 && (
        <div className="space-y-2">
          <span className="font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary">
            [ RECENT SNAPSHOTS ]
          </span>

          <div className="space-y-2">
            {recentSnapshots.map((snapshot) => (
              <Card key={snapshot.id}>
                <CardContent className="py-2 px-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mohave text-body text-text-primary">
                      {snapshot.createdAt
                        ? new Date(snapshot.createdAt).toLocaleDateString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            }
                          )
                        : "Unknown date"}
                    </span>
                    <span className="font-mono text-data-sm text-text-secondary">
                      {snapshot.itemCount} {snapshot.itemCount === 1 ? "item" : "items"}
                    </span>
                  </div>
                  <Badge variant={snapshot.isAutomatic ? "info" : "success"}>
                    {snapshot.isAutomatic ? "AUTO" : "MANUAL"}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── 5. Quick Actions ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 pt-2">
        <Button variant="default" onClick={onCreateSnapshot} className="gap-1">
          <Camera className="w-[14px] h-[14px]" />
          Create Snapshot
        </Button>
        <Button variant="primary" onClick={onAddItem} className="gap-1">
          <Plus className="w-[14px] h-[14px]" />
          Add Item
        </Button>
        <Button variant="default" onClick={onImport} className="gap-1">
          <Upload className="w-[14px] h-[14px]" />
          Import Items
        </Button>
      </div>
    </div>
  );
}
