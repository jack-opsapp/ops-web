"use client";

import { KeyRound, Pencil, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  RegisterEmpty,
  RegisterTable,
  TableMeta,
  TableMono,
  TablePrimary,
  Tag,
  type RegisterTableColumn,
} from "@/components/ui/register-table";
import type {
  WebsiteCredential,
  WebsiteCredentialClass,
} from "../website-integration-tab";

interface CredentialRegisterProps {
  credentials: WebsiteCredential[];
  busyCredentialId: string | null;
  onCreate: (kind: WebsiteCredentialClass, trigger: HTMLButtonElement) => void;
  onEdit: (credential: WebsiteCredential, trigger: HTMLButtonElement) => void;
  onRotate: (credential: WebsiteCredential) => void | Promise<void>;
  onRevoke: (credential: WebsiteCredential) => void | Promise<void>;
}

function displayDate(value: string | null | undefined, never = "—"): string {
  if (!value) return never;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusTone(
  credential: WebsiteCredential
): "olive" | "tan" | "rose" | "dim" {
  if (credential.status === "revoked") return "dim";
  if (
    credential.status === "expired" ||
    (credential.expiresAt &&
      new Date(credential.expiresAt).getTime() <= Date.now())
  ) {
    return "rose";
  }
  if (
    (credential.overlapUntil &&
      new Date(credential.overlapUntil).getTime() > Date.now()) ||
    (credential.priorCredentialOverlapUntil &&
      new Date(credential.priorCredentialOverlapUntil).getTime() > Date.now())
  ) {
    return "tan";
  }
  return "olive";
}

function visibleStatus(
  credential: WebsiteCredential,
  labels: {
    active: string;
    revoked: string;
    expired: string;
    rotating: string;
  }
): string {
  if (
    credential.status !== "revoked" &&
    credential.expiresAt &&
    new Date(credential.expiresAt).getTime() <= Date.now()
  ) {
    return labels.expired;
  }
  if (
    (credential.overlapUntil &&
      new Date(credential.overlapUntil).getTime() > Date.now()) ||
    (credential.priorCredentialOverlapUntil &&
      new Date(credential.priorCredentialOverlapUntil).getTime() > Date.now())
  ) {
    return labels.rotating;
  }
  if (credential.status === "active") return labels.active;
  if (credential.status === "revoked") return labels.revoked;
  return credential.status.toUpperCase();
}

function CredentialActions({
  credential,
  onEdit,
  onRotate,
  onRevoke,
  busy,
}: {
  credential: WebsiteCredential;
  onEdit: CredentialRegisterProps["onEdit"];
  onRotate: CredentialRegisterProps["onRotate"];
  onRevoke: CredentialRegisterProps["onRevoke"];
  busy: boolean;
}) {
  const { t } = useDictionary("settings");
  const canMutate = credential.status === "active" && !busy;

  return (
    <div className="flex justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`${t("website.key.edit", "EDIT")} ${credential.name.toUpperCase()}`}
        onClick={(event) => onEdit(credential, event.currentTarget)}
        disabled={!canMutate}
      >
        <Pencil className="size-4" aria-hidden />
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`${t("website.key.rotate", "ROTATE")} ${credential.name.toUpperCase()}`}
            disabled={!canMutate}
          >
            <RefreshCw className="size-4" aria-hidden />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("website.key.rotateTitle", "ROTATE ACCESS KEY")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "website.key.rotateDetail",
                "The current key will remain valid for one hour while you update the website."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("website.key.keepCurrent", "KEEP CURRENT KEY")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void onRotate(credential)}>
              {t("website.key.rotateConfirm", "ROTATE KEY")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`${t("website.key.revoke", "REVOKE")} ${credential.name.toUpperCase()}`}
            disabled={!canMutate}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("website.key.revokeTitle", "REVOKE ACCESS KEY")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "website.key.revokeDetail",
                "Website access using this key will stop immediately."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("website.key.keep", "KEEP KEY")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="border-rose-line bg-rose-soft text-rose hover:border-rose"
              onClick={() => void onRevoke(credential)}
            >
              {t("website.key.revokeConfirm", "REVOKE KEY")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function CredentialRegister({
  credentials,
  busyCredentialId,
  onCreate,
  onEdit,
  onRotate,
  onRevoke,
}: CredentialRegisterProps) {
  const { t } = useDictionary("settings");

  const columns: RegisterTableColumn<WebsiteCredential>[] = [
    {
      id: "name",
      header: t("website.key.columnKey", "KEY"),
      cell: (credential) => (
        <div>
          <TablePrimary>{credential.name}</TablePrimary>
          <TableMeta>{credential.prefix}</TableMeta>
        </div>
      ),
    },
    {
      id: "access",
      header: t("website.key.columnAccess", "ACCESS"),
      cell: (credential) => (
        <div className="flex items-center gap-1">
          {credential.class === "intake" ? (
            <KeyRound className="size-4 text-text-3" aria-hidden />
          ) : (
            <ShieldCheck className="size-4 text-text-3" aria-hidden />
          )}
          <TableMeta>
            {credential.class === "intake"
              ? t("website.key.intake", "INTAKE")
              : credential.scopes.includes("analytics.financial.read")
                ? t("website.key.analyticsFinancial", "ANALYTICS + MONEY")
                : t("website.key.analytics", "ANALYTICS")}
          </TableMeta>
        </div>
      ),
    },
    {
      id: "status",
      header: t("website.key.columnStatus", "STATUS"),
      cell: (credential) => (
        <Tag variant={statusTone(credential)}>
          {visibleStatus(credential, {
            active: t("website.status.active", "ACTIVE"),
            revoked: t("website.status.revoked", "REVOKED"),
            expired: t("website.status.expired", "EXPIRED"),
            rotating: t("website.status.rotating", "ROTATING"),
          })}
        </Tag>
      ),
    },
    {
      id: "lastUse",
      header: t("website.key.columnLastUse", "LAST USE"),
      cell: (credential) => (
        <TableMono>{displayDate(credential.lastUsedAt)}</TableMono>
      ),
    },
    {
      id: "rejections",
      header: t("website.key.columnRejections", "REJECTIONS"),
      align: "right",
      cell: (credential) => (
        <TableMono tone={credential.recentRejectionCount ? "rose" : "muted"}>
          {credential.recentRejectionCount}
        </TableMono>
      ),
    },
    {
      id: "expires",
      header: t("website.key.columnExpires", "EXPIRES"),
      cell: (credential) => (
        <TableMono>
          {displayDate(credential.expiresAt, t("website.key.never", "NEVER"))}
        </TableMono>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (credential) => (
        <CredentialActions
          credential={credential}
          onEdit={onEdit}
          onRotate={onRotate}
          onRevoke={onRevoke}
          busy={busyCredentialId === credential.credentialId}
        />
      ),
    },
  ];

  return (
    <section
      aria-labelledby="website-access-keys-heading"
      className="space-y-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2
            id="website-access-keys-heading"
            className="font-mohave text-heading text-text"
          >
            {t("website.key.title", "ACCESS KEYS")}
          </h2>
          <p className="font-mohave text-body-sm text-text-2">
            {t(
              "website.key.detail",
              "Issue separate keys for lead intake and website analytics."
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={(event) => onCreate("intake", event.currentTarget)}
          >
            {t("website.key.createIntake", "CREATE INTAKE KEY")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={(event) => onCreate("analytics", event.currentTarget)}
          >
            {t("website.key.createAnalytics", "CREATE ANALYTICS KEY")}
          </Button>
        </div>
      </div>

      {credentials.length ? (
        <RegisterTable
          rows={credentials}
          columns={columns}
          getRowId={(credential) => credential.credentialId}
          ariaLabel={t("website.key.tableLabel", "WEBSITE ACCESS KEYS")}
        />
      ) : (
        <div className="glass-surface">
          <RegisterEmpty
            noun={t("website.key.emptyNoun", "ACCESS KEYS")}
            hint={t("website.key.emptyHint", "[NO KEYS ISSUED]")}
          />
        </div>
      )}
    </section>
  );
}
