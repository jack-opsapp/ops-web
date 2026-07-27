"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { authedFetch } from "@/lib/utils/authed-fetch";
import { useDictionary } from "@/i18n/client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { SourceRegister } from "./website-integration/source-register";
import { CredentialRegister } from "./website-integration/credential-register";
import { SourceDialog } from "./website-integration/source-dialog";
import { CredentialDialog } from "./website-integration/credential-dialog";
import { SecretRevealDialog } from "./website-integration/secret-reveal-dialog";

export interface WebsiteForm {
  formId: string;
  key: string;
  label: string;
  isDefault: boolean;
  active: boolean;
}

export interface WebsiteSource {
  sourceId: string;
  integrationType: string;
  siteLabel: string;
  canonicalHost: string;
  defaultPhoneRegion: string;
  allowedBrowserOrigins: string[];
  defaultCoarseSource: string;
  defaultIntakeOwnerId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  forms: WebsiteForm[];
  lastAcceptedAt?: string | null;
  pendingFileCount?: number;
  rejectedFileCount?: number;
}

export type WebsiteCredentialClass = "intake" | "analytics";

export type WebsiteCredentialScope =
  "intake.write" | "analytics.leads.read" | "analytics.financial.read";

export interface WebsiteCredential {
  credentialId: string;
  replacesCredentialId?: string;
  name: string;
  class: WebsiteCredentialClass;
  scopes: WebsiteCredentialScope[];
  sourceIds: string[];
  prefix: string;
  status: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  overlapUntil: string | null;
  priorCredentialOverlapUntil?: string | null;
  rejectionCount: number;
  recentRejectionCount: number;
}

interface WebsiteSettings {
  featureEnabled: true;
  sources: WebsiteSource[];
  credentials: WebsiteCredential[];
}

export interface CredentialSecret {
  credential: WebsiteCredential;
  secret: string;
}

type ViewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; settings: WebsiteSettings };

const SETTINGS_PATH = "/api/settings/external-api";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error("safe_request_failed");
  return response.json() as Promise<T>;
}

async function settingsRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await authedFetch(path, init);
  return readJson<T>(response);
}

function jsonMutation(method: "POST" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function WebsiteIntegrationTab() {
  const { t } = useDictionary("settings");
  const [view, setView] = useState<ViewState>({ status: "loading" });
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<WebsiteSource | null>(
    null
  );
  const [credentialDialog, setCredentialDialog] = useState<{
    open: boolean;
    kind: WebsiteCredentialClass;
    credential: WebsiteCredential | null;
  }>({ open: false, kind: "intake", credential: null });
  const [revealedSecret, setRevealedSecret] = useState<CredentialSecret | null>(
    null
  );
  const [busyCredentialId, setBusyCredentialId] = useState<string | null>(null);
  const sourceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const credentialTriggerRef = useRef<HTMLButtonElement | null>(null);

  const loadSettings = useCallback(async (signal?: AbortSignal) => {
    setView({ status: "loading" });
    try {
      const settings = await settingsRequest<WebsiteSettings>(SETTINGS_PATH, {
        cache: "no-store",
        signal,
      });
      setView({ status: "ready", settings });
    } catch {
      if (signal?.aborted) return;
      setView({ status: "error" });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSettings(controller.signal);
    return () => controller.abort();
  }, [loadSettings]);

  const updateReadySettings = useCallback(
    (update: (settings: WebsiteSettings) => WebsiteSettings) => {
      setView((current) =>
        current.status === "ready"
          ? { status: "ready", settings: update(current.settings) }
          : current
      );
    },
    []
  );

  const copyValue = useCallback(
    async (value: string, label: string) => {
      try {
        await navigator.clipboard.writeText(value);
        toast.success(
          t("website.toast.copied", `${label.toUpperCase()} COPIED`)
        );
      } catch {
        toast.error(t("website.toast.copyFailed", "COPY FAILED"));
      }
    },
    [t]
  );

  const createSource = useCallback(
    async (payload: {
      siteLabel: string;
      canonicalHost: string;
      defaultPhoneRegion: string;
      allowedBrowserOrigins: string[];
      defaultCoarseSource: "website";
      defaultIntakeOwnerId: null;
      forms: [];
    }) => {
      const source = await settingsRequest<WebsiteSource>(
        `${SETTINGS_PATH}/sources`,
        jsonMutation("POST", payload)
      );
      updateReadySettings((settings) => ({
        ...settings,
        sources: [...settings.sources, source],
      }));
      toast.success(t("website.toast.sourceConnected", "WEBSITE CONNECTED"));
      return source;
    },
    [t, updateReadySettings]
  );

  const updateSource = useCallback(
    async (
      source: WebsiteSource,
      payload: {
        siteLabel: string;
        canonicalHost: string;
        defaultPhoneRegion: string;
        allowedBrowserOrigins: string[];
        defaultCoarseSource: "website";
        defaultIntakeOwnerId: string | null;
        active: boolean;
        forms: null;
      }
    ) => {
      const updated = await settingsRequest<WebsiteSource>(
        `${SETTINGS_PATH}/sources/${source.sourceId}`,
        jsonMutation("PATCH", {
          expectedUpdatedAt: source.updatedAt,
          ...payload,
        })
      );
      updateReadySettings((settings) => ({
        ...settings,
        sources: settings.sources.map((item) =>
          item.sourceId === updated.sourceId ? updated : item
        ),
      }));
      toast.success(t("website.toast.sourceUpdated", "WEBSITE UPDATED"));
      return updated;
    },
    [t, updateReadySettings]
  );

  const createCredential = useCallback(
    async (payload: {
      name: string;
      class: WebsiteCredentialClass;
      scopes: WebsiteCredentialScope[];
      sourceIds: string[];
      expiresAt: string | null;
    }) => {
      const result = await settingsRequest<CredentialSecret>(
        `${SETTINGS_PATH}/credentials`,
        jsonMutation("POST", payload)
      );
      updateReadySettings((settings) => ({
        ...settings,
        credentials: [result.credential, ...settings.credentials],
      }));
      setRevealedSecret(result);
      return result;
    },
    [updateReadySettings]
  );

  const updateCredential = useCallback(
    async (
      credential: WebsiteCredential,
      payload: { name: string; expiresAt: string | null }
    ) => {
      const updated = await settingsRequest<WebsiteCredential>(
        `${SETTINGS_PATH}/credentials/${credential.credentialId}`,
        jsonMutation("PATCH", {
          expectedUpdatedAt: credential.updatedAt,
          ...payload,
        })
      );
      updateReadySettings((settings) => ({
        ...settings,
        credentials: settings.credentials.map((item) =>
          item.credentialId === updated.credentialId ? updated : item
        ),
      }));
      toast.success(t("website.toast.keyUpdated", "ACCESS KEY UPDATED"));
      return updated;
    },
    [t, updateReadySettings]
  );

  const rotateCredential = useCallback(
    async (credential: WebsiteCredential) => {
      setBusyCredentialId(credential.credentialId);
      try {
        const result = await settingsRequest<CredentialSecret>(
          `${SETTINGS_PATH}/credentials/${credential.credentialId}/rotate`,
          jsonMutation("POST", {
            expectedUpdatedAt: credential.updatedAt,
            overlapSeconds: 3600,
            expiresAt: credential.expiresAt,
          })
        );
        updateReadySettings((settings) => ({
          ...settings,
          credentials: [
            result.credential,
            ...settings.credentials.filter(
              (item) => item.credentialId !== credential.credentialId
            ),
          ],
        }));
        setRevealedSecret(result);
      } catch {
        toast.error(t("website.toast.rotateFailed", "KEY ROTATION FAILED"));
      } finally {
        setBusyCredentialId(null);
      }
    },
    [t, updateReadySettings]
  );

  const revokeCredential = useCallback(
    async (credential: WebsiteCredential) => {
      setBusyCredentialId(credential.credentialId);
      try {
        await settingsRequest(
          `${SETTINGS_PATH}/credentials/${credential.credentialId}/revoke`,
          jsonMutation("POST", { reasonCode: "owner_revoked" })
        );
        updateReadySettings((settings) => ({
          ...settings,
          credentials: settings.credentials.map((item) =>
            item.credentialId === credential.credentialId
              ? { ...item, status: "revoked" }
              : item
          ),
        }));
        toast.success(t("website.toast.keyRevoked", "ACCESS KEY REVOKED"));
      } catch {
        toast.error(t("website.toast.revokeFailed", "KEY REVOCATION FAILED"));
      } finally {
        setBusyCredentialId(null);
      }
    },
    [t, updateReadySettings]
  );

  if (view.status === "loading") {
    return (
      <Surface className="flex items-center justify-center p-4" aria-busy>
        <Loader2
          className="size-4 animate-spin text-text-3 motion-reduce:animate-none"
          aria-hidden
        />
        <span className="sr-only">
          {t("website.loading", "LOADING WEBSITE SETTINGS")}
        </span>
      </Surface>
    );
  }

  if (view.status === "error") {
    return (
      <Surface className="p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 text-tan" aria-hidden />
          <div className="space-y-2">
            <div>
              <h2 className="font-mono text-micro uppercase tracking-widest text-text">
                {t(
                  "website.error.settingsUnavailable",
                  "WEBSITE SETTINGS UNAVAILABLE"
                )}
              </h2>
              <p className="font-mohave text-body-sm text-text-2">
                {t(
                  "website.error.settingsUnavailableDetail",
                  "Your settings are unchanged. Try again."
                )}
              </p>
            </div>
            <Button size="sm" onClick={() => void loadSettings()}>
              {t("website.retry", "TRY AGAIN")}
            </Button>
          </div>
        </div>
      </Surface>
    );
  }

  const { sources, credentials } = view.settings;
  const hasSource = sources.length > 0;

  return (
    <div className="space-y-3">
      {!hasSource ? (
        <Surface className="p-3">
          <div className="flex flex-col items-start gap-3">
            <div className="space-y-1">
              <h2 className="font-mohave text-heading text-text">
                {t("website.empty.title", "WEBSITE INTAKE")}
              </h2>
              <p className="max-w-prose font-mohave text-body-sm text-text-2">
                {t(
                  "website.empty.detail",
                  "Connect your website to send new inquiries, photos, and files into OPS."
                )}
              </p>
            </div>
            <Button
              variant="primary"
              onClick={(event) => {
                sourceTriggerRef.current = event.currentTarget;
                setEditingSource(null);
                setSourceDialogOpen(true);
              }}
            >
              {t("website.connect", "CONNECT WEBSITE")}
            </Button>
          </div>
        </Surface>
      ) : (
        <>
          <SourceRegister
            sources={sources}
            onAdd={(trigger) => {
              sourceTriggerRef.current = trigger;
              setEditingSource(null);
              setSourceDialogOpen(true);
            }}
            onEdit={(source, trigger) => {
              sourceTriggerRef.current = trigger;
              setEditingSource(source);
              setSourceDialogOpen(true);
            }}
            onCopy={copyValue}
          />
          <CredentialRegister
            credentials={credentials}
            busyCredentialId={busyCredentialId}
            onCreate={(kind, trigger) => {
              credentialTriggerRef.current = trigger;
              setCredentialDialog({ open: true, kind, credential: null });
            }}
            onEdit={(credential, trigger) => {
              credentialTriggerRef.current = trigger;
              setCredentialDialog({
                open: true,
                kind: credential.class,
                credential,
              });
            }}
            onRotate={rotateCredential}
            onRevoke={revokeCredential}
          />
        </>
      )}

      <SourceDialog
        open={sourceDialogOpen}
        source={editingSource}
        returnFocusTo={sourceTriggerRef.current}
        onOpenChange={(open) => {
          setSourceDialogOpen(open);
          if (!open) setEditingSource(null);
        }}
        onCreate={createSource}
        onUpdate={updateSource}
      />

      <CredentialDialog
        open={credentialDialog.open}
        kind={credentialDialog.kind}
        credential={credentialDialog.credential}
        returnFocusTo={credentialTriggerRef.current}
        sources={sources.filter((source) => source.status === "active")}
        onOpenChange={(open) =>
          setCredentialDialog((current) => ({ ...current, open }))
        }
        onCreate={createCredential}
        onUpdate={updateCredential}
      />

      <SecretRevealDialog
        secret={revealedSecret}
        returnFocusTo={credentialTriggerRef.current}
        onCopy={(secret) => copyValue(secret, "ACCESS KEY")}
        onDismiss={() => setRevealedSecret(null)}
      />
    </div>
  );
}
