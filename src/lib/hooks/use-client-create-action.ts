"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useCreateClient } from "@/lib/hooks/use-clients";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { useDictionary } from "@/i18n/client";

/**
 * Shared "+ New client" affordance for the {@link EntityPicker} `createAction`
 * — the one-tap create-and-link the pipeline board card has always had, now
 * offered from every client picker (project form, legacy create form, both
 * table cells) so the interaction is identical everywhere (Jackson 2026-07-02).
 *
 * Returns a ready `createAction` object, or `undefined` when the operator can't
 * create clients (so the picker footer simply doesn't render). The label reads
 * back the typed query (`Create client "Foo"`); `onCreate` creates the client
 * by name and hands the new id + name to the caller, which links it however its
 * own commit contract expects. Table cells that create by name only prefill
 * nothing else — the board card, which has the deal's contact fields, is the
 * one path that seeds email/phone/address.
 */
export function useClientCreateAction(
  onCreated: (id: string, name: string) => void,
): { label: (query: string) => string; onCreate: (query: string) => void } | undefined {
  const { t } = useDictionary("picker");
  const can = usePermissionStore((s) => s.can);
  const companyId = useAuthStore((s) => s.company?.id ?? "");
  const createClient = useCreateClient();
  const canCreate = can("clients.create");

  const onCreate = useCallback(
    async (query: string) => {
      const name = query.trim();
      if (!name || !companyId) return;
      try {
        const client = await createClient.mutateAsync({ name, companyId });
        onCreated(client.id, client.name);
      } catch (error) {
        toast.error(t("client.createFailed"), {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
    [companyId, createClient, onCreated, t],
  );

  if (!canCreate) return undefined;

  return {
    label: (query: string) => {
      const name = query.trim();
      return name ? t("client.createNamed", { name }) : t("client.createNew");
    },
    onCreate,
  };
}
