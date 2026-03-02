/**
 * OPS Web - Inventory Hooks
 *
 * TanStack Query hooks for inventory items, units, tags, item-tag
 * associations, and snapshots.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { InventoryService } from "../api/services";
import { useAuthStore } from "../store/auth-store";
import type {
  CreateInventoryItem,
  UpdateInventoryItem,
  CreateInventoryUnit,
  CreateInventoryTag,
  UpdateInventoryTag,
  InventoryItem,
  InventoryUnit,
  InventoryItemTag,
  InventoryTag,
} from "../types/inventory";

// ─── Items ────────────────────────────────────────────────────────────────────

export function useInventoryItems() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.inventory.items.list(companyId),
    queryFn: () => InventoryService.fetchItems(companyId),
    enabled: !!companyId,
  });
}

export function useInventoryItem(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.inventory.items.detail(id ?? ""),
    queryFn: () => InventoryService.fetchItem(id!),
    enabled: !!id,
  });
}

export function useCreateInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateInventoryItem) =>
      InventoryService.createItem(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.items.lists(),
      });
    },
  });
}

export function useUpdateInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateInventoryItem }) =>
      InventoryService.updateItem(id, data),
    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.items.detail(id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.items.lists(),
      });
    },
  });
}

export function useDeleteInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => InventoryService.deleteItem(id),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.items.all,
      });
    },
  });
}

export function useBulkDeleteItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => InventoryService.bulkDeleteItems(ids),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.items.all,
      });
    },
  });
}

export function useBulkAdjustQuantity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, delta }: { ids: string[]; delta: number }) =>
      InventoryService.bulkAdjustQuantity(ids, delta),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.items.all,
      });
    },
  });
}

// ─── Units ────────────────────────────────────────────────────────────────────

export function useInventoryUnits() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.inventory.units.list(companyId),
    queryFn: () => InventoryService.fetchUnits(companyId),
    enabled: !!companyId,
  });
}

export function useCreateInventoryUnit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateInventoryUnit) =>
      InventoryService.createUnit(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.units.lists(),
      });
    },
  });
}

export function useDeleteInventoryUnit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => InventoryService.deleteUnit(id),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.units.all,
      });
    },
  });
}

export function useCreateDefaultUnits() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (companyId: string) =>
      InventoryService.createDefaultUnits(companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.units.lists(),
      });
    },
  });
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

export function useInventoryTags() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.inventory.tags.list(companyId),
    queryFn: () => InventoryService.fetchTags(companyId),
    enabled: !!companyId,
  });
}

export function useCreateInventoryTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateInventoryTag) =>
      InventoryService.createTag(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.tags.lists(),
      });
    },
  });
}

export function useUpdateInventoryTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateInventoryTag }) =>
      InventoryService.updateTag(id, data),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.tags.all,
      });
    },
  });
}

export function useDeleteInventoryTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => InventoryService.deleteTag(id),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.tags.all,
      });
    },
  });
}

// ─── Item-Tag Junction ────────────────────────────────────────────────────────

export function useInventoryItemTags() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.inventory.itemTags.list(companyId),
    queryFn: () => InventoryService.fetchItemTags(companyId),
    enabled: !!companyId,
  });
}

export function useSetItemTags() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      itemId,
      tagIds,
    }: {
      itemId: string;
      tagIds: string[];
    }) => InventoryService.setItemTags(itemId, tagIds),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.itemTags.all,
      });
    },
  });
}

export function useBulkSetTags() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      itemIds,
      tagIds,
    }: {
      itemIds: string[];
      tagIds: string[];
    }) => InventoryService.bulkSetTags(itemIds, tagIds),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.itemTags.all,
      });
    },
  });
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

export function useInventorySnapshots() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  return useQuery({
    queryKey: queryKeys.inventory.snapshots.list(companyId),
    queryFn: () => InventoryService.fetchSnapshots(companyId),
    enabled: !!companyId,
  });
}

export function useSnapshotItems(snapshotId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.inventory.snapshots.items(snapshotId ?? ""),
    queryFn: () => InventoryService.fetchSnapshotItems(snapshotId!),
    enabled: !!snapshotId,
  });
}

export function useCreateSnapshot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      companyId,
      userId,
      isAutomatic,
      items,
      units,
      itemTags,
      tags,
      notes,
    }: {
      companyId: string;
      userId: string;
      isAutomatic: boolean;
      items: InventoryItem[];
      units: InventoryUnit[];
      itemTags: InventoryItemTag[];
      tags: InventoryTag[];
      notes?: string;
    }) =>
      InventoryService.createFullSnapshot(
        companyId,
        userId,
        isAutomatic,
        items,
        units,
        itemTags,
        tags,
        notes
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inventory.snapshots.lists(),
      });
    },
  });
}
