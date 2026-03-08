"use client";

import { useState } from "react";
import { Download, Trash2, Database, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

export function DataPrivacyTab() {
  const { t } = useDictionary("settings");
  const { company } = useAuthStore();
  const [exporting, setExporting] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleExportData() {
    if (!company) return;
    setExporting(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();

      const res = await fetch("/api/data/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, companyId: company.id }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        throw new Error(err.error || "Export failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ops-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t("dataPrivacy.toast.exported"));
    } catch (err) {
      toast.error(t("dataPrivacy.toast.exportFailed"), {
        description: err instanceof Error ? err.message : t("dataPrivacy.toast.unknownError"),
      });
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAccount() {
    if (confirmText !== "DELETE") {
      toast.error(t("dataPrivacy.toast.typeDelete"));
      return;
    }
    if (!company) return;

    setDeleting(true);
    try {
      const { getIdToken } = await import("@/lib/firebase/auth");
      const idToken = await getIdToken();

      const res = await fetch("/api/data/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, companyId: company.id, confirmText }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Deletion failed" }));
        throw new Error(err.error || "Deletion failed");
      }

      toast.success(t("dataPrivacy.toast.deleted"));

      // Sign out and redirect
      const { signOut } = await import("@/lib/firebase/auth");
      await signOut();
      window.location.href = "/login";
    } catch (err) {
      toast.error(t("dataPrivacy.toast.deleteFailed"), {
        description: err instanceof Error ? err.message : t("dataPrivacy.toast.unknownError"),
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Card>
        <CardHeader>
          <CardTitle>{t("dataPrivacy.exportTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            {t("dataPrivacy.exportDesc")}
          </p>
          <Button
            variant="secondary"
            className="gap-[6px]"
            onClick={handleExportData}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="w-[16px] h-[16px] animate-spin" />
            ) : (
              <Download className="w-[16px] h-[16px]" />
            )}
            {exporting ? t("dataPrivacy.exporting") : t("dataPrivacy.downloadExport")}
          </Button>
          <p className="font-kosugi text-[11px] text-text-disabled">
            {t("dataPrivacy.exportHelper")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("dataPrivacy.retentionTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 py-[6px]">
              <Database className="w-[16px] h-[16px] text-ops-accent shrink-0" />
              <div>
                <p className="font-mohave text-body-sm text-text-secondary">{t("dataPrivacy.activeData")}</p>
                <p className="font-kosugi text-[11px] text-text-disabled">
                  {t("dataPrivacy.activeDataDesc")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 py-[6px]">
              <Clock className="w-[16px] h-[16px] text-ops-amber shrink-0" />
              <div>
                <p className="font-mohave text-body-sm text-text-secondary">{t("dataPrivacy.deletedData")}</p>
                <p className="font-kosugi text-[11px] text-text-disabled">
                  {t("dataPrivacy.deletedDataDesc")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 py-[6px]">
              <Trash2 className="w-[16px] h-[16px] text-text-disabled shrink-0" />
              <div>
                <p className="font-mohave text-body-sm text-text-secondary">{t("dataPrivacy.closedAccounts")}</p>
                <p className="font-kosugi text-[11px] text-text-disabled">
                  {t("dataPrivacy.closedAccountsDesc")}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("dataPrivacy.deleteTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            {t("dataPrivacy.deleteDesc")}
          </p>
          <Button
            variant="destructive"
            className="gap-[6px]"
            onClick={() => setDeleteAccountOpen(true)}
          >
            <Trash2 className="w-[16px] h-[16px]" />
            Delete Account
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteAccountOpen}
        onOpenChange={(open) => {
          setDeleteAccountOpen(open);
          if (!open) setConfirmText("");
        }}
        title={t("dataPrivacy.deleteConfirmTitle")}
        description={t("dataPrivacy.deleteConfirmDesc")}
        confirmLabel={t("dataPrivacy.deleteTitle")}
        variant="destructive"
        onConfirm={handleDeleteAccount}
        loading={deleting}
      />
    </div>
  );
}
