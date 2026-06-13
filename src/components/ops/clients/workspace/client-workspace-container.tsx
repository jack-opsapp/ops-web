"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  useWindowStore,
  consumeClientCreatedCallback,
  type ClientWorkspaceMode,
  type ClientWorkspaceWindowMeta,
} from "@/stores/window-store";
import {
  useClient,
  useCreateClient,
  useUpdateClient,
  useDeleteClient,
  useClientFinancials,
} from "@/lib/hooks";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useDictionary } from "@/i18n/client";
import { formatCurrency } from "@/lib/utils/format";
import { ProjectWorkspaceWindow } from "@/components/ops/projects/workspace/shell/project-workspace-window";
import { ConfirmModal } from "@/components/ops/projects/workspace/confirm-modal";
import type { ModeFooterConfig } from "@/components/ops/projects/workspace/shell/mode-footer";
import type { ChipVariant } from "@/components/ops/projects/workspace/atoms/chip";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { ClientViewingBody } from "./viewing/client-viewing-body";
import {
  ClientEditCreateBody,
  type ClientEditCreateBodyHandle,
} from "./edit-create/client-edit-create-body";

// `<ClientWorkspaceContainer>` — mirrors `<ProjectWorkspaceContainer>` for
// the client entity (WEB OVERHAUL P3.3). Mediates the slim window-store
// state (id + meta) and the rich `ProjectWorkspaceWindow` shell (reused as
// the generic, entity-agnostic shell). Owns mode (viewing/editing/creating),
// the form-id wiring for the footer SAVE/CREATE, the delete confirm gate,
// and the created→viewing meta swap. One instance per client-workspace
// window, mounted by `<FloatingWindows>`.

export function ClientWorkspaceContainer({ windowId }: { windowId: string }) {
  const { t } = useDictionary("clients");
  const win = useWindowStore((s) =>
    s.windows.find((w) => w.id === windowId && w.type === "client-workspace"),
  );
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const updateWindowMeta = useWindowStore((s) => s.updateWindowMeta);

  // Window type is narrowed above, so meta is the client variant.
  const meta = win?.meta as ClientWorkspaceWindowMeta | undefined;
  const clientId = meta?.clientId ?? null;
  const initialMode: ClientWorkspaceMode = meta?.initialMode ?? "viewing";

  const [mode, setMode] = React.useState<ClientWorkspaceMode>(initialMode);
  React.useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const reactId = React.useId();
  const formId = `client-workspace-form-${reactId}`;
  const composerRef = React.useRef<ClientEditCreateBodyHandle | null>(null);

  const isViewing = mode === "viewing";
  const isCreating = mode === "creating";

  const { data: client, isLoading: clientLoading } = useClient(
    clientId && !isCreating ? clientId : undefined,
  );
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const fin = useClientFinancials(isCreating ? null : clientId);

  const can = usePermissionStore((s) => s.can);
  const canEdit = can("clients.edit");
  const canDelete = can("clients.delete");

  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);

  const handleSaved = React.useCallback(
    (savedId: string) => {
      if (mode === "creating") {
        try {
          consumeClientCreatedCallback(windowId, savedId);
        } catch (err) {
          console.error("onClientCreated callback threw", err);
        }
        updateWindowMeta(windowId, { clientId: savedId, initialMode: "viewing" });
      }
      setMode("viewing");
    },
    [mode, updateWindowMeta, windowId],
  );

  const handleConfirmDelete = React.useCallback(() => {
    if (!clientId) return;
    deleteClient.mutate(clientId, {
      onSuccess: () => {
        toast.success(t("toast.deleted"));
        setConfirmDeleteOpen(false);
        closeWindow(windowId);
      },
      onError: () => toast.error(t("form.saveFailed")),
    });
  }, [clientId, deleteClient, t, closeWindow, windowId]);

  if (!win) return null;

  const title = isCreating ? t("newClient") : client?.name ?? "—";
  const crumbLabel = t("window.crumb");
  const clientIdLabel = clientId ? clientId.slice(0, 8).toUpperCase() : "—";
  const owes = fin.canView && fin.outstanding > 0;
  const statusLabel = owes
    ? t("window.owes", { amount: formatCurrency(fin.outstanding) })
    : "—";
  const statusTone: ChipVariant = owes ? "rose" : "neutral";

  let footerConfig: ModeFooterConfig;
  if (isViewing) {
    // EDIT is the only viewing action; hide it entirely for operators
    // without clients.edit (read-only viewer) rather than show a dead button.
    footerConfig = {
      secondary: [],
      primary: canEdit
        ? {
            label: t("footer.edit"),
            onClick: () => setMode("editing"),
            disabled: !client,
          }
        : undefined,
    };
  } else if (mode === "editing") {
    footerConfig = {
      destructive: canDelete
        ? {
            label: t("footer.delete"),
            onClick: () => setConfirmDeleteOpen(true),
            disabled: !client || deleteClient.isPending,
          }
        : undefined,
      secondary: [
        {
          label: t("footer.discard"),
          onClick: () => composerRef.current?.discard(),
        },
      ],
      ghost: { label: t("footer.cancel"), onClick: () => setMode("viewing") },
      primary: {
        label: t("footer.save"),
        type: "submit",
        form: formId,
        onClick: () => {},
        disabled: updateClient.isPending,
      },
    };
  } else {
    footerConfig = {
      secondary: [],
      ghost: { label: t("footer.cancel"), onClick: () => closeWindow(windowId) },
      primary: {
        label: t("footer.create"),
        type: "submit",
        form: formId,
        onClick: () => {},
        disabled: createClient.isPending,
      },
    };
  }

  return (
    <>
      <ProjectWorkspaceWindow
        id={windowId}
        title={title}
        crumbLabel={crumbLabel}
        projectIdLabel={clientIdLabel}
        statusLabel={statusLabel}
        statusTone={statusTone}
        mode={mode}
        position={win.position}
        size={win.size}
        zIndex={win.zIndex}
        footerConfig={footerConfig}
      >
        {isViewing ? (
          client && clientId ? (
            <ClientViewingBody client={client} clientId={clientId} />
          ) : clientLoading ? (
            <div className="p-5">
              <Mono size={11} color="mute">
                —
              </Mono>
            </div>
          ) : (
            // Settled with no row — either no id, or RLS scoped this client
            // out of reach for this operator. Show a clear not-found, not a
            // permanent dash that reads as a stuck loader.
            <div className="flex h-full items-center justify-center p-6">
              <Mono size={11} color="text-3">
                {t("window.notFound")}
              </Mono>
            </div>
          )
        ) : (
          <ClientEditCreateBody
            ref={composerRef}
            mode={isCreating ? "creating" : "editing"}
            clientId={isCreating ? null : clientId}
            formId={formId}
            onSaved={handleSaved}
            createClient={createClient}
            updateClient={updateClient}
          />
        )}
      </ProjectWorkspaceWindow>

      <ConfirmModal
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={t("confirm.delete.title")}
        body={t("confirm.delete.body", { name: client?.name ?? "" })}
        confirmLabel={t("confirm.delete.confirm")}
        cancelLabel={t("footer.cancel")}
        onConfirm={handleConfirmDelete}
        isConfirming={deleteClient.isPending}
      />
    </>
  );
}

ClientWorkspaceContainer.displayName = "ClientWorkspaceContainer";
