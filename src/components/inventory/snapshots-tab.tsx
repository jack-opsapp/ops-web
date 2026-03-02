"use client";

import { useState } from "react";
import { Camera, ChevronRight, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ops/empty-state";
import {
  useInventorySnapshots,
  useSnapshotItems,
} from "@/lib/hooks/use-inventory";
import { useAuthStore } from "@/lib/store/auth-store";
import { SnapshotCreateDialog } from "./snapshot-create-dialog";
import type { InventorySnapshot } from "@/lib/types/inventory";

// ─── Sub-table for expanded snapshot items (lazy-loaded) ─────────────────────

function SnapshotItemsSubTable({ snapshotId }: { snapshotId: string }) {
  const { data: snapshotItems = [], isLoading } = useSnapshotItems(snapshotId);

  if (isLoading) {
    return (
      <tr>
        <td colSpan={6} className="pl-8 py-2">
          <span className="font-kosugi text-caption text-text-disabled">
            Loading snapshot items...
          </span>
        </td>
      </tr>
    );
  }

  if (snapshotItems.length === 0) {
    return (
      <tr>
        <td colSpan={6} className="pl-8 py-2">
          <span className="font-kosugi text-caption text-text-disabled">
            No items in this snapshot.
          </span>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={6} className="p-0">
        <div className="pl-8 pr-2 py-2 bg-[rgba(255,255,255,0.02)]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-1 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Item Name
                </th>
                <th className="text-right px-2 py-1 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Quantity
                </th>
                <th className="text-left px-2 py-1 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">
                  Unit
                </th>
                <th className="text-left px-2 py-1 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden md:table-cell">
                  SKU
                </th>
                <th className="text-left px-2 py-1 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden lg:table-cell">
                  Tags
                </th>
              </tr>
            </thead>
            <tbody>
              {snapshotItems.map((si) => (
                <tr
                  key={si.id}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-2 py-1">
                    <span className="font-mohave text-body text-text-primary">
                      {si.name}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right">
                    <span className="font-mono text-data-sm text-text-primary">
                      {si.quantity}
                    </span>
                  </td>
                  <td className="px-2 py-1 hidden sm:table-cell">
                    <span className="font-kosugi text-caption-sm text-text-secondary">
                      {si.unitDisplay || "\u2014"}
                    </span>
                  </td>
                  <td className="px-2 py-1 hidden md:table-cell">
                    <span className="font-kosugi text-caption-sm text-text-tertiary">
                      {si.sku || "\u2014"}
                    </span>
                  </td>
                  <td className="px-2 py-1 hidden lg:table-cell">
                    <span className="font-kosugi text-caption-sm text-text-tertiary truncate block max-w-[200px]">
                      {si.tagsString || "\u2014"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSnapshotDate(date: Date | null): string {
  if (!date) return "\u2014";
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getCreatedByLabel(
  snapshot: InventorySnapshot,
  currentUserId: string | null,
  currentUserName: string | null
): string {
  if (snapshot.isAutomatic) return "System";
  if (snapshot.createdById && snapshot.createdById === currentUserId && currentUserName) {
    return currentUserName;
  }
  if (snapshot.createdById) return "User";
  return "System";
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function SnapshotsTab() {
  const { currentUser } = useAuthStore();
  const { data: snapshots = [], isLoading } = useInventorySnapshots();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const currentUserId = currentUser?.id ?? null;
  const currentUserName = currentUser
    ? `${currentUser.firstName} ${currentUser.lastName}`.trim() || null
    : null;

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Sort snapshots by date descending (newest first)
  const sorted = [...snapshots].sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return db - da;
  });

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <span className="font-mohave text-body-sm text-text-tertiary uppercase tracking-widest">
          [ SNAPSHOTS ]
        </span>
        <Button
          variant="default"
          size="sm"
          onClick={() => setShowCreateDialog(true)}
          className="gap-1"
        >
          <Camera className="w-[14px] h-[14px]" />
          Create Snapshot
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <span className="font-kosugi text-caption text-text-disabled">
            Loading snapshots...
          </span>
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Archive className="w-[32px] h-[32px]" />}
          title="No snapshots yet"
          description="Create a snapshot to capture a point-in-time record of your inventory."
          action={{
            label: "Create Snapshot",
            onClick: () => setShowCreateDialog(true),
          }}
        />
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-[rgba(255,255,255,0.02)]">
                <th className="w-[32px] px-1 py-1.5" />
                <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Date
                </th>
                <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">
                  Created By
                </th>
                <th className="text-right px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Items
                </th>
                <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden md:table-cell">
                  Type
                </th>
                <th className="text-left px-2 py-1.5 font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden lg:table-cell">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((snapshot) => {
                const isExpanded = expandedIds.has(snapshot.id);

                return (
                  <SnapshotRow
                    key={snapshot.id}
                    snapshot={snapshot}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpanded(snapshot.id)}
                    createdByLabel={getCreatedByLabel(
                      snapshot,
                      currentUserId,
                      currentUserName
                    )}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create dialog */}
      <SnapshotCreateDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
    </div>
  );
}

// ─── Snapshot Row ─────────────────────────────────────────────────────────────

function SnapshotRow({
  snapshot,
  isExpanded,
  onToggle,
  createdByLabel,
}: {
  snapshot: InventorySnapshot;
  isExpanded: boolean;
  onToggle: () => void;
  createdByLabel: string;
}) {
  return (
    <>
      <tr
        className="border-b border-border last:border-b-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors cursor-pointer"
        onClick={onToggle}
      >
        {/* Chevron */}
        <td className="px-1 py-1.5 text-center">
          <ChevronRight
            className={`w-[14px] h-[14px] text-text-tertiary transition-transform duration-150 ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
        </td>

        {/* Date */}
        <td className="px-2 py-1.5">
          <span className="font-mohave text-body text-text-primary">
            {formatSnapshotDate(snapshot.createdAt)}
          </span>
        </td>

        {/* Created By */}
        <td className="px-2 py-1.5 hidden sm:table-cell">
          <span className="font-kosugi text-caption-sm text-text-secondary">
            {createdByLabel}
          </span>
        </td>

        {/* Items */}
        <td className="px-2 py-1.5 text-right">
          <span className="font-mono text-data-sm text-text-primary">
            {snapshot.itemCount}
          </span>
        </td>

        {/* Type */}
        <td className="px-2 py-1.5 hidden md:table-cell">
          {snapshot.isAutomatic ? (
            <Badge variant="info">Auto</Badge>
          ) : (
            <Badge>Manual</Badge>
          )}
        </td>

        {/* Notes */}
        <td className="px-2 py-1.5 hidden lg:table-cell">
          <span className="font-kosugi text-caption-sm text-text-tertiary truncate block max-w-[200px]">
            {snapshot.notes || "\u2014"}
          </span>
        </td>
      </tr>

      {/* Expanded sub-table */}
      {isExpanded && <SnapshotItemsSubTable snapshotId={snapshot.id} />}
    </>
  );
}
