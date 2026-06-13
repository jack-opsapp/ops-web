/**
 * OPS Web — Catalog Meta + Snapshot Hooks
 *
 * Categories, tags, units (kebab "// MANAGE") and snapshots (kebab "// VIEWS"
 * / ON-HAND tile drill). WEB OVERHAUL P3.2.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import {
  CatalogMetaService,
  CatalogCategoryService,
  CatalogUnitService,
  CatalogSnapshotService,
  CATALOG_UNIT_DIMENSIONS,
} from "../api/services";
import type { CatalogUnitDimension } from "../api/services";
import { useAuthStore } from "../store/auth-store";
import type { CatalogStockRow } from "../types/catalog";

export { CATALOG_UNIT_DIMENSIONS };
export type { CatalogUnitDimension };

// ─── Categories ────────────────────────────────────────────────────────────────

export function useCatalogCategories() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useQuery({
    queryKey: queryKeys.catalog.categories(companyId),
    queryFn: () => CatalogMetaService.fetchCategories(companyId),
    enabled: !!companyId,
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useMutation({
    mutationFn: (input: { name: string; parentId?: string | null }) =>
      CatalogCategoryService.create({ companyId, ...input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.categories(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.stock(companyId) });
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Parameters<typeof CatalogMetaService.updateCategory>[1];
    }) => CatalogMetaService.updateCategory(id, patch),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.categories(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.stock(companyId) });
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useMutation({
    mutationFn: (id: string) => CatalogMetaService.deleteCategory(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.categories(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.stock(companyId) });
    },
  });
}

// ─── Tags ──────────────────────────────────────────────────────────────────────

export function useCatalogTags() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useQuery({
    queryKey: queryKeys.catalog.tags(companyId),
    queryFn: () => CatalogMetaService.fetchTags(companyId),
    enabled: !!companyId,
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useMutation({
    mutationFn: (name: string) => CatalogMetaService.createTag(companyId, name),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.tags(companyId) });
    },
  });
}

export function useRenameTag() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      CatalogMetaService.renameTag(id, name),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.tags(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.stock(companyId) });
    },
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useMutation({
    mutationFn: (id: string) => CatalogMetaService.deleteTag(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.tags(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.stock(companyId) });
    },
  });
}

// ─── Units ───────────────────────────────────────────────────────────────────

export function useCatalogUnits() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useQuery({
    queryKey: queryKeys.catalog.units(companyId),
    queryFn: () => CatalogMetaService.fetchUnits(companyId),
    enabled: !!companyId,
  });
}

export function useCreateUnit() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useMutation({
    mutationFn: (input: { display: string; dimension: CatalogUnitDimension; abbreviation?: string | null }) =>
      CatalogUnitService.create({ companyId, ...input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.units(companyId) });
    },
  });
}

export function useDeleteUnit() {
  const queryClient = useQueryClient();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useMutation({
    mutationFn: (id: string) => CatalogMetaService.deleteUnit(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.units(companyId) });
    },
  });
}

// ─── Snapshots ─────────────────────────────────────────────────────────────────

export function useCatalogSnapshots() {
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  return useQuery({
    queryKey: queryKeys.catalog.snapshots(companyId),
    queryFn: () => CatalogSnapshotService.fetchSnapshots(companyId),
    enabled: !!companyId,
  });
}

export function useSnapshotItems(snapshotId: string | null) {
  return useQuery({
    queryKey: queryKeys.catalog.snapshotItems(snapshotId ?? ""),
    queryFn: () => CatalogSnapshotService.fetchSnapshotItems(snapshotId!),
    enabled: !!snapshotId,
  });
}

export function useCreateSnapshot() {
  const queryClient = useQueryClient();
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  const userId = currentUser?.id ?? null;
  return useMutation({
    mutationFn: ({ notes, rows }: { notes: string | null; rows: CatalogStockRow[] }) =>
      CatalogSnapshotService.createSnapshot({
        companyId,
        createdById: userId,
        notes,
        rows,
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.snapshots(companyId) });
    },
  });
}
