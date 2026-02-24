"use client";

import { useState } from "react";
import { Download, Trash2, Database, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { useAuthStore } from "@/lib/store/auth-store";
import { toast } from "sonner";

export function DataPrivacyTab() {
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
      toast.success("Data exported successfully");
    } catch (err) {
      toast.error("Export failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAccount() {
    if (confirmText !== "DELETE") {
      toast.error("Please type DELETE to confirm");
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

      toast.success("Account deleted");

      // Sign out and redirect
      const { signOut } = await import("@/lib/firebase/auth");
      await signOut();
      window.location.href = "/login";
    } catch (err) {
      toast.error("Deletion failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3 max-w-[600px]">
      <Card>
        <CardHeader>
          <CardTitle>Export Your Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            Download a copy of all your data including projects, clients, tasks, and team information.
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
            {exporting ? "Exporting..." : "Download Data Export"}
          </Button>
          <p className="font-kosugi text-[11px] text-text-disabled">
            Export is generated as a JSON file containing all your company data.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Retention</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 py-[6px]">
              <Database className="w-[16px] h-[16px] text-ops-accent shrink-0" />
              <div>
                <p className="font-mohave text-body-sm text-text-secondary">Active Data</p>
                <p className="font-kosugi text-[11px] text-text-disabled">
                  Retained as long as your account is active
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 py-[6px]">
              <Clock className="w-[16px] h-[16px] text-ops-amber shrink-0" />
              <div>
                <p className="font-mohave text-body-sm text-text-secondary">Deleted Data</p>
                <p className="font-kosugi text-[11px] text-text-disabled">
                  Permanently removed within 30 days of deletion
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 py-[6px]">
              <Trash2 className="w-[16px] h-[16px] text-text-disabled shrink-0" />
              <div>
                <p className="font-mohave text-body-sm text-text-secondary">Closed Accounts</p>
                <p className="font-kosugi text-[11px] text-text-disabled">
                  All data removed within 90 days of account closure
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p className="font-mohave text-body-sm text-text-secondary">
            Permanently delete your account and all associated data. This action cannot be undone.
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
        title="Delete your account?"
        description="This will permanently delete your account, all projects, clients, tasks, and team data. This action cannot be undone. Type DELETE to confirm."
        confirmLabel="Delete Account"
        variant="destructive"
        onConfirm={handleDeleteAccount}
        loading={deleting}
      />
    </div>
  );
}
